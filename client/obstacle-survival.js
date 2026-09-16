// client/obstacle-survival.js
//
// Game #2: Obstacle Survival — client side.
//
// Same rule as game.js (Tic-Tac-Toe): this file NEVER calls socket.emit or
// socket.on directly, only network.js. Its whole job is:
//   1. swap between screens
//   2. collect keyboard / joystick input and send it as intent
//   3. draw whatever authoritative state the server last sent
//
// It never decides who got hit, who died, or who scored. Those all arrive
// from the server already decided.

const OS = GAME_CONSTANTS.OBSTACLE_SURVIVAL;

// ---------------------------------------------------------------------------
// Screen management (identical pattern to Tic-Tac-Toe)
// ---------------------------------------------------------------------------
const screens = {
  landing: document.getElementById('screen-landing'),
  join: document.getElementById('screen-join'),
  lobby: document.getElementById('screen-lobby'),
  game: document.getElementById('screen-game')
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Connection status
// ---------------------------------------------------------------------------
const statusEl = document.getElementById('connection-status');

network.onConnected(() => {
  statusEl.textContent = 'Connected to multiplayer server';
  statusEl.classList.remove('offline');
});

network.onDisconnected(() => {
  statusEl.textContent = 'Disconnected';
  statusEl.classList.add('offline');
});

// ---------------------------------------------------------------------------
// Landing / join screens
// ---------------------------------------------------------------------------
document.getElementById('btn-create-room').addEventListener('click', () => {
  // The only line that differs from Tic-Tac-Toe: name the game type, so the
  // server knows this room runs Obstacle Survival's rules module.
  network.createRoom(GAME_CONSTANTS.GAME_TYPES.OBSTACLE_SURVIVAL, (response) => {
    if (!response.success) {
      alert(response.message || 'Could not create room.');
      return;
    }
    knownPlayers = response.players;
    enterLobby(response.roomCode);
  });
});

document.getElementById('btn-show-join').addEventListener('click', () => {
  document.getElementById('join-error').textContent = '';
  showScreen('join');
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  const code = document.getElementById('join-code-input').value.trim();
  if (!code) return;

  network.joinRoom(code, (response) => {
    if (!response.success) {
      document.getElementById('join-error').textContent = response.message;
      return;
    }
    knownPlayers = response.players;
    enterLobby(response.roomCode);
  });
});

document.getElementById('btn-back-to-landing').addEventListener('click', () => {
  showScreen('landing');
});

// ---------------------------------------------------------------------------
// Lobby
// ---------------------------------------------------------------------------
const lobbyRoomCodeEl = document.getElementById('lobby-room-code');
const lobbyPlayerListEl = document.getElementById('lobby-player-list');
const lobbyStatusEl = document.getElementById('lobby-status');
const btnStart = document.getElementById('btn-start');

let knownPlayers = [];

function enterLobby(roomCode) {
  showScreen('lobby');
  lobbyRoomCodeEl.textContent = roomCode;
  updateLobbyDisplay();
}

function updateLobbyDisplay() {
  lobbyPlayerListEl.innerHTML = '';

  for (let i = 1; i <= 2; i++) {
    const present = knownPlayers.some((p) => p.number === i);
    const li = document.createElement('li');
    li.textContent = `Player ${i}   ${present ? '\u25CF Connected' : '\u25CB Waiting...'}`;
    lobbyPlayerListEl.appendChild(li);
  }

  const bothPresent = knownPlayers.length >= 2;
  lobbyStatusEl.textContent = bothPresent
    ? 'Both players ready!'
    : 'Waiting for another player to join...';
  btnStart.disabled = !bothPresent;
}

network.onPlayerJoin((data) => {
  knownPlayers = data.players;
  updateLobbyDisplay();
});

btnStart.addEventListener('click', () => {
  network.startGame();
});

// ---------------------------------------------------------------------------
// Game screen setup
// ---------------------------------------------------------------------------
const canvas = document.getElementById('arena-canvas');
const ctx = canvas.getContext('2d');
const disconnectNoticeEl = document.getElementById('disconnect-notice');
const overlayEl = document.getElementById('overlay');
const overlayTitleEl = document.getElementById('overlay-title');
const overlaySubEl = document.getElementById('overlay-sub');
const btnPlayAgain = document.getElementById('btn-play-again');

const ARENA_W = OS.ARENA_WIDTH;
const ARENA_H = OS.ARENA_HEIGHT;
const PLAYER_SIZE = OS.PLAYER_SIZE;

let latestState = null;
let renderStarted = false;

// Crisp rendering on high-DPI phones/laptops: draw at device resolution but
// keep using plain 800x500 arena coordinates everywhere else in this file.
function setupCanvasResolution() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = ARENA_W * dpr;
  canvas.height = ARENA_H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

network.onGameStarted(() => {
  showScreen('game');
  setupCanvasResolution();
  hideOverlay();
  disconnectNoticeEl.classList.add('hidden');

  // Guard against double-registering listeners when "Play Again" fires
  // GAME_STARTED a second time.
  if (!renderStarted) {
    renderStarted = true;
    startInputCapture();
    setupJoystick();
    requestAnimationFrame(renderLoop);
  }
});

network.onGameState((data) => {
  latestState = data;
});

network.onPlayerLeave(() => {
  disconnectNoticeEl.textContent = 'The other player disconnected. Waiting for them to rejoin...';
  disconnectNoticeEl.classList.remove('hidden');
});

btnPlayAgain.addEventListener('click', () => {
  // Reuses the existing START_GAME event and the SAME room — the server just
  // builds a fresh match state. No new room, no new connection.
  network.startGame();
});

window.addEventListener('resize', setupCanvasResolution);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const hudEls = {
  1: {
    card: document.getElementById('hud-p1'),
    hearts: document.getElementById('hearts-p1'),
    score: document.getElementById('score-p1')
  },
  2: {
    card: document.getElementById('hud-p2'),
    hearts: document.getElementById('hearts-p2'),
    score: document.getElementById('score-p2')
  }
};
const hudRoundEl = document.getElementById('hud-round');
const hudTargetEl = document.getElementById('hud-target');

function heartsText(entity, maxHp) {
  if (!entity) return '';
  if (!entity.alive) return '\uD83D\uDC80'; // skull
  let out = '';
  for (let i = 0; i < maxHp; i++) {
    out += i < entity.hp ? '\u2764\uFE0F' : '\uD83D\uDDA4'; // red heart / black heart
  }
  return out;
}

function updateHud(state) {
  const myNumber = network.getPlayerInfo().playerNumber;
  const entities = Object.values(state.entities || {});

  [1, 2].forEach((num) => {
    const entity = entities.find((e) => e.number === num);
    hudEls[num].hearts.textContent = heartsText(entity, state.maxHp);
    hudEls[num].score.textContent = (state.scores && state.scores[num]) || 0;
    hudEls[num].card.classList.toggle('is-you', num === myNumber);
  });

  hudRoundEl.textContent = `Round ${state.round || 1}`;
  hudTargetEl.textContent = `first to ${state.pointsToWin}`;
}

// ---------------------------------------------------------------------------
// Overlay (countdown, round result, match result)
// ---------------------------------------------------------------------------
let lastOverlayTitle = null;

function showOverlay(title, sub, tone) {
  overlayEl.classList.remove('hidden');
  overlaySubEl.textContent = sub || '';
  overlayTitleEl.className = tone || '';

  // Only re-trigger the pop animation when the text actually changes, so the
  // countdown pops once per number instead of every single frame.
  if (title !== lastOverlayTitle) {
    overlayTitleEl.textContent = title;
    overlayTitleEl.classList.remove('pop');
    void overlayTitleEl.offsetWidth; // forces the browser to restart the animation
    overlayTitleEl.classList.add('pop');
    lastOverlayTitle = title;
  }
}

function hideOverlay() {
  overlayEl.classList.add('hidden');
  btnPlayAgain.classList.add('hidden');
  lastOverlayTitle = null;
}

function updateOverlay(state) {
  const myNumber = network.getPlayerInfo().playerNumber;

  if (state.phase === 'COUNTDOWN') {
    const count = Math.max(1, Math.ceil(state.phaseTimer));
    showOverlay(String(count), 'Get ready...', '');
    btnPlayAgain.classList.add('hidden');
    return;
  }

  if (state.phase === 'ROUND_END') {
    if (state.roundResult && state.roundResult.draw) {
      showOverlay('DRAW', 'Both players went down.', '');
    } else if (state.roundResult) {
      const won = state.roundResult.winnerNumber === myNumber;
      showOverlay(
        won ? 'ROUND WON' : 'ROUND LOST',
        `Player ${state.roundResult.winnerNumber} takes the point`,
        won ? 'good' : 'danger'
      );
    }
    btnPlayAgain.classList.add('hidden');
    return;
  }

  if (state.phase === 'MATCH_END') {
    const won = state.matchWinner === myNumber;
    showOverlay(
      `PLAYER ${state.matchWinner} WINS`,
      `${state.scores[1]} — ${state.scores[2]}${won ? '   that is you!' : ''}`,
      won ? 'good' : 'danger'
    );
    btnPlayAgain.classList.remove('hidden');
    return;
  }

  if (state.phase === 'WAITING') {
    // A player left mid-match. Offer the restart button so that once someone
    // rejoins with the same room code, the match can be picked back up —
    // without this the remaining player would be stuck on a frozen arena.
    showOverlay('PAUSED', 'A player left. Once they rejoin, press Play again.', '');
    btnPlayAgain.classList.remove('hidden');
    return;
  }

  hideOverlay();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
// The server sends positions 30x/second; the screen refreshes ~60x/second.
// Drawing the raw server position would look slightly steppy, so each player
// is drawn at a position that eases toward the authoritative one. The server
// still owns the truth — this only smooths how it's displayed.
// Red belongs to the spikes and nothing else, so Player 2 is amber rather
// than red — a red player standing inside a red warning lane is genuinely
// hard to see, which is the one thing this game can't afford.
const PLAYER_1_COLOR = '#35C2E3';
const PLAYER_2_COLOR = '#F0B429';

const renderPositions = {};

function smoothPositions(state, dt) {
  Object.values(state.entities || {}).forEach((entity) => {
    const current = renderPositions[entity.id];
    if (!current) {
      renderPositions[entity.id] = { x: entity.x, y: entity.y };
      return;
    }
    // Frame-rate independent easing.
    const k = 1 - Math.pow(0.0001, dt);
    current.x += (entity.x - current.x) * k;
    current.y += (entity.y - current.y) * k;

    // If the server teleported them (respawn), snap instead of sliding.
    if (Math.abs(entity.x - current.x) > 120 || Math.abs(entity.y - current.y) > 120) {
      current.x = entity.x;
      current.y = entity.y;
    }
  });
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFloor() {
  ctx.fillStyle = '#1C191F';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Faint checkerboard — gives a sense of distance/speed while moving.
  const tile = 50;
  ctx.fillStyle = '#221E27';
  for (let row = 0; row * tile < ARENA_H; row++) {
    for (let col = 0; col * tile < ARENA_W; col++) {
      if ((row + col) % 2 === 0) continue;
      ctx.fillRect(col * tile, row * tile, tile, tile);
    }
  }
}

function drawObstacles(state) {
  (state.obstacles || []).forEach((o) => {
    // Drop shadow first, then the block, for a chunky raised look.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundedRect(o.x + 4, o.y + 6, o.w, o.h, 12);
    ctx.fill();

    ctx.fillStyle = '#3A3242';
    roundedRect(o.x, o.y, o.w, o.h, 12);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#4C4356';
    ctx.stroke();
  });
}

// One row of spike teeth pointing into the arena from a given edge.
function drawTeeth(rect, side, color) {
  const toothSize = 18;
  ctx.fillStyle = color;

  if (side === 'top' || side === 'bottom') {
    const tipY = side === 'top' ? rect.y + rect.h : rect.y;
    const baseY = side === 'top' ? tipY - toothSize : tipY + toothSize;
    const count = Math.max(1, Math.round(rect.w / toothSize));
    const step = rect.w / count;

    for (let i = 0; i < count; i++) {
      const x0 = rect.x + i * step;
      ctx.beginPath();
      ctx.moveTo(x0, baseY);
      ctx.lineTo(x0 + step, baseY);
      ctx.lineTo(x0 + step / 2, tipY);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }

  const tipX = side === 'left' ? rect.x + rect.w : rect.x;
  const baseX = side === 'left' ? tipX - toothSize : tipX + toothSize;
  const count = Math.max(1, Math.round(rect.h / toothSize));
  const step = rect.h / count;

  for (let i = 0; i < count; i++) {
    const y0 = rect.y + i * step;
    ctx.beginPath();
    ctx.moveTo(baseX, y0);
    ctx.lineTo(baseX, y0 + step);
    ctx.lineTo(tipX, y0 + step / 2);
    ctx.closePath();
    ctx.fill();
  }
}

// The idle spike mechanisms parked around the arena edge, so players can see
// where attacks can physically come from before anything happens.
function drawIdleMechanisms(state) {
  const laneW = ARENA_W / state.laneCount;
  const rowH = ARENA_H / state.rowCount;
  const depth = 12;

  // Housings: chunky enough that a player can see at a glance which edges
  // can fire at them, before anything is actually happening.
  function housing(x, y, w, h) {
    ctx.fillStyle = '#4A4150';
    roundedRect(x, y, w, h, 4);
    ctx.fill();
    ctx.fillStyle = '#5C5266';
    if (w > h) ctx.fillRect(x + 2, y + 2, w - 4, 2);
    else ctx.fillRect(x + 2, y + 2, 2, h - 4);
  }

  for (let i = 0; i < state.laneCount; i++) {
    housing(i * laneW + 3, 0, laneW - 6, depth);
    housing(i * laneW + 3, ARENA_H - depth, laneW - 6, depth);
    // Resting spike tips, just poking out of the housing.
    drawTeeth({ x: i * laneW + 3, y: 0, w: laneW - 6, h: depth + 5 }, 'top', '#6E6478');
    drawTeeth({ x: i * laneW + 3, y: ARENA_H - depth - 5, w: laneW - 6, h: depth + 5 }, 'bottom', '#6E6478');
  }
  for (let i = 0; i < state.rowCount; i++) {
    housing(0, i * rowH + 3, depth, rowH - 6);
    housing(ARENA_W - depth, i * rowH + 3, depth, rowH - 6);
    drawTeeth({ x: 0, y: i * rowH + 3, w: depth + 5, h: rowH - 6 }, 'left', '#6E6478');
    drawTeeth({ x: ARENA_W - depth - 5, y: i * rowH + 3, w: depth + 5, h: rowH - 6 }, 'right', '#6E6478');
  }
}

// WARNING phase: the whole danger area glows red and a hard blinking strip
// sits on the edge the spikes will come from. This is the single most
// important thing on screen, so it is deliberately loud.
function drawWarning(state, time) {
  const hazard = state.hazard;
  const progress = 1 - hazard.timer / hazard.duration; // 0 -> 1 as impact nears
  const blinkSpeed = 6 + progress * 10;
  const blink = 0.5 + 0.5 * Math.sin(time * blinkSpeed);

  hazard.rects.forEach((rect) => {
    ctx.fillStyle = `rgba(226, 59, 59, ${0.16 + 0.22 * blink + 0.12 * progress})`;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgba(226, 59, 59, ${0.5 + 0.5 * blink})`;
    ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);

    // Chunky dashes along the edge the spikes emerge from.
    const stripe = 14;
    ctx.fillStyle = blink > 0.5 ? '#E23B3B' : '#7A1F1F';
    if (rect.side === 'top' || rect.side === 'bottom') {
      const y = rect.side === 'top' ? 0 : ARENA_H - stripe;
      for (let x = rect.x; x < rect.x + rect.w; x += stripe * 2) {
        ctx.fillRect(x, y, stripe, stripe);
      }
    } else {
      const x = rect.side === 'left' ? 0 : ARENA_W - stripe;
      for (let y = rect.y; y < rect.y + rect.h; y += stripe * 2) {
        ctx.fillRect(x, y, stripe, stripe);
      }
    }
  });
}

// ATTACK phase: the spike body slams across the danger area. It punches out
// fast, then eases back, which is what makes the hit feel like it lands.
function drawAttack(state) {
  const hazard = state.hazard;
  const t = 1 - hazard.timer / hazard.duration; // 0 -> 1 across the attack
  const extend = t < 0.25 ? t / 0.25 : 1 - (t - 0.25) / 0.75 * 0.25;

  hazard.rects.forEach((rect) => {
    const body = { ...rect };

    // Grow the shaft out of its edge rather than just appearing.
    if (rect.side === 'top') {
      body.h = rect.h * extend;
    } else if (rect.side === 'bottom') {
      body.h = rect.h * extend;
      body.y = rect.y + rect.h - body.h;
    } else if (rect.side === 'left') {
      body.w = rect.w * extend;
    } else {
      body.w = rect.w * extend;
      body.x = rect.x + rect.w - body.w;
    }

    ctx.fillStyle = '#6B4A2A'; // shaft
    ctx.fillRect(body.x, body.y, body.w, body.h);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    if (rect.side === 'top' || rect.side === 'bottom') {
      ctx.fillRect(body.x + body.w * 0.18, body.y, body.w * 0.14, body.h);
    } else {
      ctx.fillRect(body.x, body.y + body.h * 0.18, body.w, body.h * 0.14);
    }

    drawTeeth(body, rect.side, '#D9D4CC'); // the metal spike head
  });
}

function drawPlayers(state, time) {
  const myId = network.getPlayerInfo().playerId;

  Object.values(state.entities || {}).forEach((entity) => {
    const pos = renderPositions[entity.id] || { x: entity.x, y: entity.y };
    const half = PLAYER_SIZE / 2;
    const baseColor = entity.number === 1 ? PLAYER_1_COLOR : PLAYER_2_COLOR;

    // Dead players stay on screen as a faded marker so you can see what
    // happened, but they're clearly out.
    if (!entity.alive) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = baseColor;
      roundedRect(pos.x - half, pos.y - half, PLAYER_SIZE, PLAYER_SIZE, 8);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = '#F2ECE4';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(pos.x - 8, pos.y - 8);
      ctx.lineTo(pos.x + 8, pos.y + 8);
      ctx.moveTo(pos.x + 8, pos.y - 8);
      ctx.lineTo(pos.x - 8, pos.y + 8);
      ctx.stroke();
      return;
    }

    // Hurt: shake sideways and flash white. Movement is never blocked by this.
    let shakeX = 0;
    if (entity.hurtTimer > 0) {
      shakeX = Math.sin(time * 60) * 4 * (entity.hurtTimer / OS.TIMING.HURT);
    }

    // After the flash, blink gently for the rest of the invulnerability window
    // so the damage cooldown is something the player can actually see.
    let alpha = 1;
    if (entity.invulnTimer > 0 && entity.hurtTimer <= 0) {
      alpha = 0.45 + 0.55 * Math.abs(Math.sin(time * 18));
    }

    const x = pos.x + shakeX;

    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    roundedRect(x - half, pos.y - half + 5, PLAYER_SIZE, PLAYER_SIZE, 8);
    ctx.fill();

    ctx.fillStyle = entity.hurtTimer > 0 ? '#FFFFFF' : baseColor;
    roundedRect(x - half, pos.y - half, PLAYER_SIZE, PLAYER_SIZE, 8);
    ctx.fill();

    // Your own character gets a bright ring so you never lose track of it.
    ctx.lineWidth = entity.id === myId ? 3.5 : 2;
    ctx.strokeStyle = entity.id === myId ? '#F2ECE4' : 'rgba(0, 0, 0, 0.55)';
    ctx.stroke();

    // Two little eyes, so it reads as a character rather than a box.
    ctx.fillStyle = '#14121A';
    ctx.fillRect(x - 7, pos.y - 5, 4, 7);
    ctx.fillRect(x + 3, pos.y - 5, 4, 7);

    ctx.globalAlpha = 1;
  });
}

// A red vignette over the whole arena the instant YOU take a hit.
function drawHurtVignette(state) {
  const myId = network.getPlayerInfo().playerId;
  const me = (state.entities || {})[myId];
  if (!me || me.hurtTimer <= 0) return;

  const strength = me.hurtTimer / OS.TIMING.HURT;

  // Darkens/reddens the EDGES only, so the middle of the arena stays
  // readable while you're recovering from a hit.
  const gradient = ctx.createRadialGradient(
    ARENA_W / 2, ARENA_H / 2, ARENA_H * 0.25,
    ARENA_W / 2, ARENA_H / 2, ARENA_W * 0.62
  );
  gradient.addColorStop(0, 'rgba(226, 59, 59, 0)');
  gradient.addColorStop(1, `rgba(226, 59, 59, ${0.55 * strength})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
}

let lastFrameTime = performance.now();

function renderLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  const time = now / 1000;

  ctx.clearRect(0, 0, ARENA_W, ARENA_H);

  if (latestState) {
    smoothPositions(latestState, dt);

    drawFloor();
    drawIdleMechanisms(latestState);
    drawObstacles(latestState);

    if (latestState.hazard) {
      if (latestState.hazard.phase === 'WARNING') drawWarning(latestState, time);
      if (latestState.hazard.phase === 'ATTACK') drawAttack(latestState);
    }

    drawPlayers(latestState, time);
    drawHurtVignette(latestState);

    updateHud(latestState);
    updateOverlay(latestState);
  }

  requestAnimationFrame(renderLoop);
}

// ---------------------------------------------------------------------------
// Keyboard input
// ---------------------------------------------------------------------------
// Both WASD and the arrow keys control YOUR OWN character — there's no split
// by player number, since each person is on their own device.
//
// Input is sent only when it CHANGES, not on a timer. Holding W sends one
// message, not thirty a second, and the server keeps moving you until you
// let go. That keeps traffic tiny without making movement any less smooth.
const heldKeys = { up: false, down: false, left: false, right: false };
let joystickVector = { dx: 0, dy: 0 };

const KEY_MAP = {
  w: 'up', W: 'up', ArrowUp: 'up',
  s: 'down', S: 'down', ArrowDown: 'down',
  a: 'left', A: 'left', ArrowLeft: 'left',
  d: 'right', D: 'right', ArrowRight: 'right'
};

function sendInput() {
  network.sendInput({
    up: heldKeys.up,
    down: heldKeys.down,
    left: heldKeys.left,
    right: heldKeys.right,
    dx: joystickVector.dx,
    dy: joystickVector.dy
  });
}

function startInputCapture() {
  window.addEventListener('keydown', (e) => {
    const direction = KEY_MAP[e.key];
    if (!direction) return;
    e.preventDefault(); // stop arrow keys scrolling the page
    if (heldKeys[direction]) return; // already down — nothing changed
    heldKeys[direction] = true;
    sendInput();
  });

  window.addEventListener('keyup', (e) => {
    const direction = KEY_MAP[e.key];
    if (!direction) return;
    if (!heldKeys[direction]) return;
    heldKeys[direction] = false;
    sendInput();
  });

  // Switching tabs can swallow a keyup and leave a key "stuck down" forever.
  window.addEventListener('blur', () => {
    let changed = false;
    Object.keys(heldKeys).forEach((k) => {
      if (heldKeys[k]) { heldKeys[k] = false; changed = true; }
    });
    if (changed) sendInput();
  });
}

// ---------------------------------------------------------------------------
// Mobile joystick
// ---------------------------------------------------------------------------
// Shown only on devices that actually report touch support — a narrow desktop
// window does NOT get a joystick stuck over the arena.
function isTouchDevice() {
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

function setupJoystick() {
  const joystick = document.getElementById('joystick');
  const thumb = document.getElementById('joystick-thumb');

  if (!isTouchDevice()) return;

  joystick.classList.remove('hidden');
  document.getElementById('controls-hint').textContent = 'Drag the joystick to move.';

  let activeTouchId = null;
  let lastSent = 0;

  function vectorFromTouch(touch) {
    const rect = joystick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxDistance = rect.width / 2;

    let dx = (touch.clientX - cx) / maxDistance;
    let dy = (touch.clientY - cy) / maxDistance;

    const length = Math.sqrt(dx * dx + dy * dy);
    if (length > 1) { dx /= length; dy /= length; }
    return { dx, dy };
  }

  function moveThumb(dx, dy) {
    const offset = 50; // percentage of the base's radius
    thumb.style.left = `${50 + dx * offset}%`;
    thumb.style.top = `${50 + dy * offset}%`;
  }

  function handleMove(touch) {
    joystickVector = vectorFromTouch(touch);
    moveThumb(joystickVector.dx, joystickVector.dy);

    // The stick moves continuously, so throttle to ~20 messages/second.
    const now = performance.now();
    if (now - lastSent < 50) return;
    lastSent = now;
    sendInput();
  }

  function release() {
    activeTouchId = null;
    joystickVector = { dx: 0, dy: 0 };
    moveThumb(0, 0);
    sendInput();
  }

  joystick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    activeTouchId = touch.identifier;
    handleMove(touch);
  }, { passive: false });

  joystick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const touch of e.changedTouches) {
      if (touch.identifier === activeTouchId) handleMove(touch);
    }
  }, { passive: false });

  ['touchend', 'touchcancel'].forEach((eventName) => {
    joystick.addEventListener(eventName, (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier === activeTouchId) release();
      }
    }, { passive: false });
  });
}
