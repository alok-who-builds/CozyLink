// server/games/obstacle-survival.js
//
// Game #2: Obstacle Survival.
//
// Everything in here is a RULE, not a connection. Like tic-tac-toe.js, this
// file never touches Socket.IO, rooms, or sockets — server.js calls into it
// and broadcasts whatever comes back. The server is authoritative for every
// single thing that matters: positions, collisions, spike timing, who got
// hit, HP, death, score and round state. The client only draws what it's told.
//
// The file is organised top-to-bottom as:
//   1. Config + arena layouts
//   2. Small geometry helpers
//   3. State creation / round reset
//   4. Input handling (applyMove)
//   5. The hazard (spike) state machine
//   6. Movement + collision
//   7. tick() — the per-frame entry point that drives all of the above
//
// NOTE on the field name `entities`: server.js's broadcastGameState() always
// injects its own top-level `players` field into every broadcast, so calling
// this game's per-player data `players` would get silently overwritten.

const { OBSTACLE_SURVIVAL } = require('../../shared/constants');

const {
  ARENA_WIDTH: W,
  ARENA_HEIGHT: H,
  PLAYER_SIZE,
  PLAYER_SPEED,
  MAX_HP,
  POINTS_TO_WIN,
  LANE_COUNT,
  ROW_COUNT,
  HORIZONTAL_ATTACK_CHANCE,
  TIMING
} = OBSTACLE_SURVIVAL;

const HALF = PLAYER_SIZE / 2;
const LANE_W = W / LANE_COUNT;
const ROW_H = H / ROW_COUNT;

// ---------------------------------------------------------------------------
// 1. ARENA LAYOUTS
// ---------------------------------------------------------------------------
// A few hand-placed obstacle sets. One is picked per round so rounds don't
// feel identical. Every layout deliberately keeps the far-left and far-right
// columns clear, because that's where the two players spawn.
// IMPORTANT: at most ONE obstacle per vertical lane. dangerRect() stops a
// vertical spike at the nearest obstacle in its lane, so if two obstacles
// stacked in the SAME lane, the gap between them could never be reached by
// a top OR a bottom attack — a permanent, unkillable safe pocket. Spreading
// obstacles one-per-lane guarantees a top+bottom attack pair can always
// eventually sweep the entire lane except the block's own footprint.
const LAYOUTS = [
  [
    { x: 155, y: 80,  w: 90, h: 90 },
    { x: 288, y: 300, w: 90, h: 90 },
    { x: 422, y: 80,  w: 90, h: 90 },
    { x: 555, y: 300, w: 90, h: 90 }
  ],
  [
    { x: 155, y: 300, w: 90, h: 90 },
    { x: 288, y: 80,  w: 90, h: 90 },
    { x: 422, y: 300, w: 90, h: 90 },
    { x: 555, y: 80,  w: 90, h: 90 }
  ],
  [
    { x: 155, y: 165, w: 90, h: 170 },
    { x: 422, y: 60,  w: 90, h: 110 },
    { x: 555, y: 290, w: 90, h: 110 }
  ],
  [
    { x: 288, y: 110, w: 90, h: 260 },
    { x: 555, y: 110, w: 90, h: 260 },
    { x: 422, y: 205, w: 90, h: 70 }
  ]
];

function spawnPosition(playerNumber) {
  // Far left / far right, vertically centred — always outside every layout.
  return {
    x: playerNumber === 1 ? 60 : W - 60,
    y: H / 2
  };
}

// ---------------------------------------------------------------------------
// 2. GEOMETRY HELPERS
// ---------------------------------------------------------------------------
function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

// A player is stored as a centre point but collides as a square box.
function playerBox(entity) {
  return { x: entity.x - HALF, y: entity.y - HALF, w: PLAYER_SIZE, h: PLAYER_SIZE };
}

function randomInt(max) {
  return Math.floor(Math.random() * max);
}

// Picks `count` distinct numbers from 0..max-1.
function pickDistinct(count, max) {
  const pool = [];
  for (let i = 0; i < max; i++) pool.push(i);
  const chosen = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    chosen.push(pool.splice(randomInt(pool.length), 1)[0]);
  }
  return chosen;
}

// ---------------------------------------------------------------------------
// 3. STATE CREATION
// ---------------------------------------------------------------------------
// Called by rooms.startGame() — both for a brand new match and for "Play
// Again", which is why scores are reset here.
function createInitialState(players) {
  const entities = {};
  const scores = { 1: 0, 2: 0 };

  (players || []).forEach((p) => {
    entities[p.id] = {
      id: p.id,
      number: p.number,
      x: 0,
      y: 0,
      hp: MAX_HP,
      alive: true,
      hurtTimer: 0,
      invulnTimer: 0,
      input: { up: false, down: false, left: false, right: false, dx: 0, dy: 0 }
    };
  });

  const state = {
    // Static info the client needs in order to draw the arena at all.
    arena: { width: W, height: H, playerSize: PLAYER_SIZE },
    laneCount: LANE_COUNT,
    rowCount: ROW_COUNT,
    maxHp: MAX_HP,
    pointsToWin: POINTS_TO_WIN,

    entities,
    scores,
    round: 0,
    phase: 'COUNTDOWN', // COUNTDOWN | PLAYING | ROUND_END | MATCH_END | WAITING
    phaseTimer: TIMING.COUNTDOWN,
    obstacles: [],
    hazard: null,
    attacksThisRound: 0,
    roundResult: null, // { winnerNumber } or { draw: true } during ROUND_END
    matchWinner: null  // player number once someone reaches POINTS_TO_WIN
  };

  startRound(state);
  return state;
}

// Resets everything that is per-round: health, positions, layout, hazards.
// Scores and match state deliberately survive this.
function startRound(state) {
  state.round += 1;
  state.phase = 'COUNTDOWN';
  state.phaseTimer = TIMING.COUNTDOWN;
  state.roundResult = null;
  state.obstacles = LAYOUTS[randomInt(LAYOUTS.length)].map((o) => ({ ...o }));
  state.hazard = null;
  state.attacksThisRound = 0;

  Object.values(state.entities).forEach((entity) => {
    const spawn = spawnPosition(entity.number);
    entity.x = spawn.x;
    entity.y = spawn.y;
    entity.hp = MAX_HP;
    entity.alive = true;
    entity.hurtTimer = 0;
    entity.invulnTimer = 0;
    entity.input = { up: false, down: false, left: false, right: false, dx: 0, dy: 0 };
  });
}

// ---------------------------------------------------------------------------
// 4. INPUT
// ---------------------------------------------------------------------------
// Never trust the raw object a client sends. We accept either four booleans
// (keyboard) or an analog dx/dy vector (mobile joystick), and nothing else.
function sanitizeInput(raw) {
  const safe = { up: false, down: false, left: false, right: false, dx: 0, dy: 0 };
  if (!raw || typeof raw !== 'object') return safe;

  safe.up = !!raw.up;
  safe.down = !!raw.down;
  safe.left = !!raw.left;
  safe.right = !!raw.right;

  if (typeof raw.dx === 'number' && isFinite(raw.dx)) safe.dx = Math.max(-1, Math.min(1, raw.dx));
  if (typeof raw.dy === 'number' && isFinite(raw.dy)) safe.dy = Math.max(-1, Math.min(1, raw.dy));

  return safe;
}

// This does NOT move anybody — it only records intent. Movement happens in
// tick(), on a fixed clock, which is what makes holding a key feel smooth
// instead of depending on how often the browser fires key events.
function applyMove(state, player, action) {
  const entity = state.entities[player.id];
  if (!entity) return { success: false, error: 'Unknown player.' };

  entity.input = sanitizeInput(action);
  return { success: true, state };
}

// ---------------------------------------------------------------------------
// 5. HAZARD (SPIKE) STATE MACHINE
// ---------------------------------------------------------------------------
// How far a spike coming from `side` can reach into a lane before an obstacle
// stops it. This is what makes hiding behind a block actually work: the area
// in a block's shadow never becomes part of the danger rectangle.
function dangerRect(state, side, index) {
  if (side === 'top' || side === 'bottom') {
    const x = index * LANE_W;
    const lane = { x, y: 0, w: LANE_W, h: H };
    const blockers = state.obstacles.filter((o) => rectsOverlap(lane, o));

    if (side === 'top') {
      let depth = H;
      blockers.forEach((o) => { depth = Math.min(depth, o.y); });
      return { x, y: 0, w: LANE_W, h: Math.max(0, depth), side };
    }

    let startY = 0;
    blockers.forEach((o) => { startY = Math.max(startY, o.y + o.h); });
    return { x, y: startY, w: LANE_W, h: Math.max(0, H - startY), side };
  }

  const y = index * ROW_H;
  const row = { x: 0, y, w: W, h: ROW_H };
  const blockers = state.obstacles.filter((o) => rectsOverlap(row, o));

  if (side === 'left') {
    let depth = W;
    blockers.forEach((o) => { depth = Math.min(depth, o.x); });
    return { x: 0, y, w: Math.max(0, depth), h: ROW_H, side };
  }

  let startX = 0;
  blockers.forEach((o) => { startX = Math.max(startX, o.x + o.w); });
  return { x: startX, y, w: Math.max(0, W - startX), h: ROW_H, side };
}

// Chooses the next attack pattern and puts the hazard into its WARNING phase.
function scheduleAttack(state) {
  // Every 4th attack is a PINCER SWEEP: both axes fire at once, so the
  // pocket a block shields from one side is not shielded from the other.
  // Without this, a player can park permanently in an obstacle's shadow —
  // the whole point of the shadow is a brief hiding spot, not a home base.
  const sweep = state.attacksThisRound > 0 && state.attacksThisRound % 4 === 3;

  const rects = [];
  const sidesUsed = [];

  function fireAxis(horizontal) {
    const laneTotal = horizontal ? ROW_COUNT : LANE_COUNT;
    const maxLanes = Math.max(1, Math.floor(laneTotal / 2) - 1);
    const wanted = state.attacksThisRound < 4 ? 2 : 3;
    const laneCount = Math.min(wanted, maxLanes);
    const indexes = pickDistinct(laneCount, laneTotal);

    // Both opposite edges fire together often — that's what seals a lane
    // completely (no shadow survives it at all), which is what stops camping.
    const roll = Math.random();
    const sides = horizontal
      ? (roll < 0.3 ? ['left'] : roll < 0.6 ? ['right'] : ['left', 'right'])
      : (roll < 0.3 ? ['top'] : roll < 0.6 ? ['bottom'] : ['top', 'bottom']);

    sides.forEach((side) => {
      indexes.forEach((index) => {
        const rect = dangerRect(state, side, index);
        if (rect.w > 0 && rect.h > 0) rects.push(rect);
      });
    });
    sidesUsed.push(...sides);
  }

  if (sweep) {
    fireAxis(false);
    fireAxis(true);
  } else {
    fireAxis(Math.random() < HORIZONTAL_ATTACK_CHANCE);
  }
  const horizontal = sweep ? true : sidesUsed[0] === 'left' || sidesUsed[0] === 'right';
  const sides = sidesUsed;

  // Reaction time shrinks slightly with each attack, so rounds build tension.
  const warning = Math.max(
    TIMING.WARNING_MIN,
    TIMING.WARNING_MAX - state.attacksThisRound * TIMING.WARNING_STEP
  );

  state.hazard = {
    phase: 'WARNING', // WARNING -> ATTACK -> RECOVER
    timer: warning,
    duration: warning,
    horizontal,
    sides,
    rects,
    hitIds: [] // who has already taken damage from THIS attack
  };
  state.attacksThisRound += 1;
}

// Damage is applied here, during the ATTACK phase only. Two separate guards
// stop a single attack from draining all 3 HP: `hitIds` (one damage event per
// attack per player) and `invulnTimer` (a cooldown that outlives the attack).
function applyHazardDamage(state) {
  const hazard = state.hazard;

  Object.values(state.entities).forEach((entity) => {
    if (!entity.alive) return;
    if (entity.invulnTimer > 0) return;
    if (hazard.hitIds.indexOf(entity.id) !== -1) return;

    const box = playerBox(entity);
    const hit = hazard.rects.some((rect) => rectsOverlap(box, rect));
    if (!hit) return;

    hazard.hitIds.push(entity.id);
    entity.hp -= 1;
    entity.hurtTimer = TIMING.HURT;
    entity.invulnTimer = TIMING.INVULN;

    if (entity.hp <= 0) {
      entity.hp = 0;
      entity.alive = false;
    }
  });
}

function updateHazard(state, dt) {
  if (!state.hazard) {
    scheduleAttack(state);
    return;
  }

  const hazard = state.hazard;
  hazard.timer -= dt;

  if (hazard.phase === 'ATTACK') {
    // Checked every tick so that walking INTO an extended spike still hurts.
    applyHazardDamage(state);
  }

  if (hazard.timer > 0) return;

  if (hazard.phase === 'WARNING') {
    hazard.phase = 'ATTACK';
    hazard.timer = TIMING.ATTACK;
    hazard.duration = TIMING.ATTACK;
    applyHazardDamage(state); // the moment of impact
  } else if (hazard.phase === 'ATTACK') {
    hazard.phase = 'RECOVER';
    hazard.timer = TIMING.RECOVER;
    hazard.duration = TIMING.RECOVER;
  } else {
    scheduleAttack(state);
  }
}

// ---------------------------------------------------------------------------
// 6. MOVEMENT + COLLISION
// ---------------------------------------------------------------------------
// Turns held keys or a joystick vector into a direction of at most length 1,
// so diagonal movement isn't faster than straight movement.
function inputVector(input) {
  let vx = input.dx || 0;
  let vy = input.dy || 0;

  // If the joystick isn't meaningfully pushed, fall back to the keyboard.
  if (Math.sqrt(vx * vx + vy * vy) < 0.15) {
    vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  }

  const length = Math.sqrt(vx * vx + vy * vy);
  if (length > 1) {
    vx /= length;
    vy /= length;
  }
  return { vx, vy };
}

// Moves one axis at a time and undoes that axis if it lands inside a block.
// Doing the axes separately is what lets a player slide along a wall instead
// of sticking to it.
// Two players are NOT allowed to occupy the same space — they can bump
// and jostle each other, which matters a lot right next to a spike lane
// (you can shove someone, or get shoved, at exactly the wrong moment).
function otherPlayerBlocks(state, entity) {
  const box = playerBox(entity);
  return Object.values(state.entities).some((other) => {
    if (other === entity || !other.alive) return false;
    return rectsOverlap(box, playerBox(other));
  });
}

function moveEntity(state, entity, dt) {
  const { vx, vy } = inputVector(entity.input);
  if (vx === 0 && vy === 0) return;

  const distance = PLAYER_SPEED * dt;

  const originalX = entity.x;
  entity.x = Math.max(HALF, Math.min(W - HALF, entity.x + vx * distance));
  if (state.obstacles.some((o) => rectsOverlap(playerBox(entity), o)) || otherPlayerBlocks(state, entity)) {
    entity.x = originalX;
  }

  const originalY = entity.y;
  entity.y = Math.max(HALF, Math.min(H - HALF, entity.y + vy * distance));
  if (state.obstacles.some((o) => rectsOverlap(playerBox(entity), o)) || otherPlayerBlocks(state, entity)) {
    entity.y = originalY;
  }
}

function countdownTimers(entity, dt) {
  if (entity.hurtTimer > 0) entity.hurtTimer = Math.max(0, entity.hurtTimer - dt);
  if (entity.invulnTimer > 0) entity.invulnTimer = Math.max(0, entity.invulnTimer - dt);
}

// Ends the round if anybody has died, awarding a point to the survivor.
function checkRoundOver(state) {
  const entities = Object.values(state.entities);
  if (entities.length === 0) return;

  const dead = entities.filter((e) => !e.alive);
  if (dead.length === 0) return;

  const survivors = entities.filter((e) => e.alive);

  if (survivors.length === 1) {
    const winnerNumber = survivors[0].number;
    state.scores[winnerNumber] += 1;
    state.roundResult = { winnerNumber };
  } else {
    // Both players hit zero on the same attack — nobody scores.
    state.roundResult = { draw: true };
  }

  state.phase = 'ROUND_END';
  state.phaseTimer = TIMING.ROUND_END;
  state.hazard = null;

  const leader = state.scores[1] >= state.scores[2] ? 1 : 2;
  if (state.scores[leader] >= POINTS_TO_WIN) {
    state.matchWinner = leader;
  }
}

// ---------------------------------------------------------------------------
// 7. TICK — called ~30x/second by server.js for every room playing this game
// ---------------------------------------------------------------------------
function tick(state, dt) {
  // Guard against a huge dt (e.g. the host machine slept) teleporting players
  // through walls, since collision is checked per step, not swept.
  const step = Math.min(dt, 0.1);

  if (state.phase === 'WAITING' || state.phase === 'MATCH_END') {
    return state;
  }

  if (state.phase === 'COUNTDOWN') {
    state.phaseTimer -= step;
    if (state.phaseTimer <= 0) {
      state.phase = 'PLAYING';
      state.phaseTimer = 0;
      scheduleAttack(state);
    }
    return state;
  }

  if (state.phase === 'ROUND_END') {
    state.phaseTimer -= step;
    Object.values(state.entities).forEach((e) => countdownTimers(e, step));
    if (state.phaseTimer <= 0) {
      if (state.matchWinner) {
        state.phase = 'MATCH_END';
        state.phaseTimer = 0;
      } else {
        startRound(state);
      }
    }
    return state;
  }

  // ---- PLAYING ----
  Object.values(state.entities).forEach((entity) => {
    countdownTimers(entity, step);
    if (entity.alive) moveEntity(state, entity, step); // dead players can't move
  });

  updateHazard(state, step);
  checkRoundOver(state);

  return state;
}

// ---------------------------------------------------------------------------
// Optional hook: server.js calls this if a player leaves mid-game, so the
// match parks itself in a clear state instead of the remaining player being
// chased by spikes in a game they can no longer win.
// ---------------------------------------------------------------------------
function handlePlayerLeft(state, player) {
  if (state.entities[player.id]) delete state.entities[player.id];
  state.phase = 'WAITING';
  state.hazard = null;
  return state;
}

module.exports = { createInitialState, applyMove, tick, handlePlayerLeft };
