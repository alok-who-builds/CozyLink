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
// Sound — synthesized with the Web Audio API, no sound files needed.
// AudioContext must start after a real user gesture (browser autoplay
// rules), so it's created lazily on the first click/keydown/touch.
// ---------------------------------------------------------------------------
const Sound = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('os-muted') === '1'; } catch (e) { /* ignore */ }

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // A single short tone. `type` is an oscillator waveform, `sweep` optionally
  // slides the frequency across the note for whooshes/impacts.
  function tone({ freq = 440, duration = 0.12, type = 'sine', volume = 0.18, sweep = null }) {
    if (muted) return;
    const audio = ensureCtx();
    if (!audio) return;

    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audio.currentTime);
    if (sweep) osc.frequency.exponentialRampToValueAtTime(sweep, audio.currentTime + duration);

    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);

    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + duration + 0.02);
  }

  // Short burst of noise — used for the spike slam, which reads as an
  // impact rather than a musical note.
  function noiseHit({ duration = 0.18, volume = 0.35 } = {}) {
    if (muted) return;
    const audio = ensureCtx();
    if (!audio) return;

    const bufferSize = Math.floor(audio.sampleRate * duration);
    const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // fade out
    }

    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(volume, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + duration);

    source.connect(filter).connect(gain).connect(audio.destination);
    source.start();
  }

  return {
    unlock: ensureCtx,
    countdownTick: () => tone({ freq: 440, duration: 0.09, type: 'square', volume: 0.15 }),
    warningStart: () => tone({ freq: 620, duration: 0.22, type: 'sawtooth', volume: 0.12, sweep: 340 }),
    spikeSlam: () => noiseHit({ duration: 0.22, volume: 0.4 }),
    hurt: () => tone({ freq: 180, duration: 0.28, type: 'square', volume: 0.22, sweep: 60 }),
    roundWon: () => tone({ freq: 523, duration: 0.28, type: 'triangle', volume: 0.2, sweep: 784 }),
    roundLost: () => tone({ freq: 300, duration: 0.35, type: 'triangle', volume: 0.2, sweep: 140 }),
    matchWon: () => { tone({ freq: 523, duration: 0.4, type: 'triangle', volume: 0.22, sweep: 1046 }); },
    click: () => tone({ freq: 500, duration: 0.05, type: 'square', volume: 0.1 }),
    isMuted: () => muted,
    toggleMute: () => {
      muted = !muted;
      try { localStorage.setItem('os-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      return muted;
    }
  };
})();

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
  Sound.unlock(); // first real user gesture on this page — safe to start audio now
  Sound.click();
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
  Sound.unlock();
  Sound.click();
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

// Mute toggle. Reflects the saved preference from Sound's own localStorage
// check immediately, so it doesn't flash the wrong icon on load.
const btnMute = document.getElementById('btn-mute');
function refreshMuteIcon() {
  btnMute.textContent = Sound.isMuted() ? '\uD83D\uDD07' : '\uD83D\uDD0A';
}
refreshMuteIcon();
btnMute.addEventListener('click', () => {
  Sound.unlock();
  Sound.toggleMute();
  refreshMuteIcon();
  if (!Sound.isMuted()) Sound.click();
});

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

// ---------------------------------------------------------------------------
// Particles + screen shake — purely cosmetic, client-side only. The server
// never sends "spawn a particle"; this code watches for state CHANGES
// (a hazard entering ATTACK, a player's hurtTimer starting) and reacts.
// ---------------------------------------------------------------------------
let particles = [];
let shakeTime = 0;
let shakeMagnitude = 0;
let prevHazardPhase = null;
const prevHurt = {}; // entity id -> was hurtTimer > 0 last update?

function spawnHitParticles(x, y, color) {
  for (let i = 0; i < 14; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 160;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.3,
      age: 0,
      size: 3 + Math.random() * 4,
      color
    });
  }
}

function triggerShake(magnitude) {
  shakeMagnitude = magnitude;
  shakeTime = 0.22;
}

network.onGameState((data) => {
  const prev = latestState;
  latestState = data;
  if (!prev) { prevHazardPhase = data.hazard ? data.hazard.phase : null; return; }

  // A fresh attack just landed — impact sound + a jolt of screen shake.
  const wasWarning = prev.hazard && prev.hazard.phase === 'WARNING';
  const nowAttacking = data.hazard && data.hazard.phase === 'ATTACK';
  if (wasWarning && nowAttacking) {
    Sound.spikeSlam();
    triggerShake(7);
  }
  // A brand new warning began — a short alarm cue.
  const hazardPhase = data.hazard ? data.hazard.phase : null;
  if (hazardPhase === 'WARNING' && prevHazardPhase !== 'WARNING') {
    Sound.warningStart();
  }
  prevHazardPhase = hazardPhase;

  // Anyone whose hurtTimer just started (0 -> >0) took a hit this instant.
  Object.values(data.entities || {}).forEach((entity) => {
    const wasHurt = prevHurt[entity.id];
    if (entity.hurtTimer > 0 && !wasHurt) {
      const color = entity.number === 1 ? '#35C2E3' : '#F0B429';
      spawnHitParticles(entity.x, entity.y, color);
      if (entity.id === network.getPlayerInfo().playerId) {
        Sound.hurt();
        if (navigator.vibrate) navigator.vibrate(80); // mobile haptic feedback
      }
    }
    prevHurt[entity.id] = entity.hurtTimer > 0;
  });
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
    if (String(count) !== lastOverlayTitle) Sound.countdownTick();
    showOverlay(String(count), 'Get ready...', '');
    btnPlayAgain.classList.add('hidden');
    return;
  }

  if (state.phase === 'ROUND_END') {
    if (state.roundResult && state.roundResult.draw) {
      if (lastOverlayTitle !== 'DRAW') Sound.roundLost();
      showOverlay('DRAW', 'Both players went down.', '');
    } else if (state.roundResult) {
      const won = state.roundResult.winnerNumber === myNumber;
      if (lastOverlayTitle === null || !lastOverlayTitle.startsWith('ROUND')) {
        won ? Sound.roundWon() : Sound.roundLost();
      }
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
    if (lastOverlayTitle === null || !lastOverlayTitle.includes('WINS')) {
      if (won) Sound.matchWon(); else Sound.roundLost();
    }
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
const prevRenderPositions = {};
const lookDirections = {}; // entity id -> last facing direction, for eyes // one frame behind, used to measure actual on-screen speed for animation

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

// Lightens (positive amount) or darkens (negative) a "#rrggbb" colour —
// used everywhere below to build gradients from a single base colour
// instead of hand-picking a second hex value for every shaded surface.
function shade(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + amount;
  let g = ((num >> 8) & 0xff) + amount;
  let b = (num & 0xff) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
}

function drawFloor() {
  ctx.fillStyle = '#1C191F';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);

  // Checkerboard for a sense of scale/movement...
  const tile = 50;
  ctx.fillStyle = '#221E27';
  for (let row = 0; row * tile < ARENA_H; row++) {
    for (let col = 0; col * tile < ARENA_W; col++) {
      if ((row + col) % 2 === 0) continue;
      ctx.fillRect(col * tile, row * tile, tile, tile);
    }
  }

  // ...a faint structural grid on top of it, so the floor reads as an
  // engineered arena rather than flat wallpaper...
  ctx.strokeStyle = 'rgba(242, 236, 228, 0.035)';
  ctx.lineWidth = 1;
  for (let x = tile; x < ARENA_W; x += tile) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ARENA_H); ctx.stroke();
  }
  for (let y = tile; y < ARENA_H; y += tile) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(ARENA_W, y); ctx.stroke();
  }

  // ...and a soft vignette so the centre of the arena — where the action
  // usually is — stays the brightest part of the frame.
  const vignette = ctx.createRadialGradient(
    ARENA_W / 2, ARENA_H / 2, ARENA_H * 0.15,
    ARENA_W / 2, ARENA_H / 2, ARENA_W * 0.65
  );
  vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
  vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
}

function drawObstacles(state) {
  (state.obstacles || []).forEach((o) => {
    // Drop shadow first, for a chunky raised look.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    roundedRect(o.x + 4, o.y + 6, o.w, o.h, 12);
    ctx.fill();

    // A top-to-bottom gradient body instead of one flat fill gives the
    // block real form — it reads as a lit 3D object, not a coloured tile.
    const body = ctx.createLinearGradient(o.x, o.y, o.x, o.y + o.h);
    body.addColorStop(0, shade('#3A3242', 22));
    body.addColorStop(0.55, '#3A3242');
    body.addColorStop(1, shade('#3A3242', -16));
    ctx.fillStyle = body;
    roundedRect(o.x, o.y, o.w, o.h, 12);
    ctx.fill();

    // A soft highlight band near the top — the "light source" hitting it.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    roundedRect(o.x + 6, o.y + 5, o.w - 12, o.h * 0.24, 7);
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#5C5266';
    roundedRect(o.x, o.y, o.w, o.h, 12);
    ctx.stroke();

    // Four corner rivets — a small industrial detail that sells the "solid
    // machined block" read at a glance.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    const inset = 10;
    [[o.x + inset, o.y + inset], [o.x + o.w - inset, o.y + inset],
     [o.x + inset, o.y + o.h - inset], [o.x + o.w - inset, o.y + o.h - inset]]
      .forEach(([cx, cy]) => {
        ctx.beginPath();
        ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
        ctx.fill();
      });
  });
}

// One row of spike teeth pointing into the arena from a given edge. Each
// tooth is shaded (bright at the tip, darker at the base) with a thin
// centre glint, so it reads as machined metal rather than a flat triangle.
function drawTeeth(rect, side, baseColor) {
  const toothSize = 18;
  const light = shade(baseColor, 35);
  const dark = shade(baseColor, -45);

  function paintTooth(points, tipPoint, basePoints) {
    const grad = ctx.createLinearGradient(basePoints[0].x, basePoints[0].y, tipPoint.x, tipPoint.y);
    grad.addColorStop(0, dark);
    grad.addColorStop(1, light);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // A thin bright glint line from base to tip — the classic "sharp
    // metal" highlight.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.moveTo((basePoints[0].x + basePoints[1].x) / 2, (basePoints[0].y + basePoints[1].y) / 2);
    ctx.lineTo(tipPoint.x, tipPoint.y);
    ctx.stroke();
  }

  if (side === 'top' || side === 'bottom') {
    const tipY = side === 'top' ? rect.y + rect.h : rect.y;
    const baseY = side === 'top' ? tipY - toothSize : tipY + toothSize;
    const count = Math.max(1, Math.round(rect.w / toothSize));
    const step = rect.w / count;

    for (let i = 0; i < count; i++) {
      const x0 = rect.x + i * step;
      const p1 = { x: x0, y: baseY };
      const p2 = { x: x0 + step, y: baseY };
      const tip = { x: x0 + step / 2, y: tipY };
      paintTooth([p1, p2, tip], tip, [p1, p2]);
    }
    return;
  }

  const tipX = side === 'left' ? rect.x + rect.w : rect.x;
  const baseX = side === 'left' ? tipX - toothSize : tipX + toothSize;
  const count = Math.max(1, Math.round(rect.h / toothSize));
  const step = rect.h / count;

  for (let i = 0; i < count; i++) {
    const y0 = rect.y + i * step;
    const p1 = { x: baseX, y: y0 };
    const p2 = { x: baseX, y: y0 + step };
    const tip = { x: tipX, y: y0 + step / 2 };
    paintTooth([p1, p2, tip], tip, [p1, p2]);
  }
}

// The idle spike mechanisms parked around the arena edge, so players can see
// where attacks can physically come from before anything happens.
function drawIdleMechanisms(state) {
  const laneW = ARENA_W / state.laneCount;
  const rowH = ARENA_H / state.rowCount;
  const depth = 13;

  function housing(x, y, w, h) {
    const grad = ctx.createLinearGradient(x, y, x + (w > h ? 0 : w), y + (w > h ? h : 0));
    grad.addColorStop(0, shade('#4A4150', 14));
    grad.addColorStop(1, shade('#4A4150', -18));
    ctx.fillStyle = grad;
    roundedRect(x, y, w, h, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    roundedRect(x, y, w, h, 4);
    ctx.stroke();

    // A row of small rivets along the housing — industrial detail, cheap
    // to draw, reads instantly as "built machinery."
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    const count = Math.max(2, Math.round((w > h ? w : h) / 22));
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const cx = w > h ? x + t * w : x + w / 2;
      const cy = w > h ? y + h / 2 : y + t * h;
      ctx.beginPath();
      ctx.arc(cx, cy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = 0; i < state.laneCount; i++) {
    housing(i * laneW + 3, 0, laneW - 6, depth);
    housing(i * laneW + 3, ARENA_H - depth, laneW - 6, depth);
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

    // Brushed-metal shaft: a gradient across its width/height instead of a
    // flat fill, so it catches the "light" like an actual cylindrical rod.
    const vertical = rect.side === 'top' || rect.side === 'bottom';
    const grad = vertical
      ? ctx.createLinearGradient(body.x, 0, body.x + body.w, 0)
      : ctx.createLinearGradient(0, body.y, 0, body.y + body.h);
    grad.addColorStop(0, '#5A3D22');
    grad.addColorStop(0.28, '#8A5D34');
    grad.addColorStop(0.5, '#6B4A2A');
    grad.addColorStop(0.72, '#8A5D34');
    grad.addColorStop(1, '#4A3119');
    ctx.fillStyle = grad;
    ctx.fillRect(body.x, body.y, body.w, body.h);

    // A crisp glint streak down the middle.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    if (vertical) {
      ctx.fillRect(body.x + body.w * 0.44, body.y, body.w * 0.1, body.h);
    } else {
      ctx.fillRect(body.x, body.y + body.h * 0.44, body.w, body.h * 0.1);
    }

    // Dark edge lines give it a hard, machined silhouette.
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(body.x, body.y, body.w, body.h);

    drawTeeth(body, rect.side, '#D9D4CC'); // the metal spike head
  });
}

function drawPlayers(state, time, dt) {
  const myId = network.getPlayerInfo().playerId;

  Object.values(state.entities || {}).forEach((entity) => {
    const pos = renderPositions[entity.id] || { x: entity.x, y: entity.y };
    const half = PLAYER_SIZE / 2;
    const baseColor = entity.number === 1 ? PLAYER_1_COLOR : PLAYER_2_COLOR;

    // How fast — and in what DIRECTION — this player is actually moving on
    // screen right now. Speed drives the walk animation; direction drives
    // where the character's eyes look, which is what makes it feel alive
    // instead of a shape being dragged around.
    const prevPos = prevRenderPositions[entity.id] || pos;
    const dx = pos.x - prevPos.x;
    const dy = pos.y - prevPos.y;
    const speed = dt > 0 ? Math.hypot(dx, dy) / dt : 0;
    prevRenderPositions[entity.id] = { x: pos.x, y: pos.y };
    const movingRatio = Math.min(1, speed / OS.PLAYER_SPEED);
    const lookDir = movingRatio > 0.08 ? { x: dx / (speed || 1), y: dy / (speed || 1) } : (lookDirections[entity.id] || { x: 0, y: 1 });
    if (movingRatio > 0.08) lookDirections[entity.id] = lookDir;

    // Dead players stay on screen as a faded marker so you can see what
    // happened, but they're clearly out.
    if (!entity.alive) {
      ctx.globalAlpha = 0.32;
      ctx.fillStyle = baseColor;
      ctx.beginPath();
      ctx.ellipse(pos.x, pos.y, half * 1.08, half * 0.95, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.strokeStyle = '#F2ECE4';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
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

    // A gentle idle "breathe" when still; a bouncy squash-and-stretch step
    // cycle when moving, so standing still and running actually look
    // different instead of the shape just sliding around the floor.
    let scaleX = 1, scaleY = 1, bobY = 0;
    if (movingRatio > 0.05) {
      const stepPhase = time * (10 + movingRatio * 6);
      scaleX = 1 + Math.sin(stepPhase) * 0.1 * movingRatio;
      scaleY = 1 - Math.sin(stepPhase) * 0.1 * movingRatio;
      bobY = Math.abs(Math.sin(stepPhase)) * -3 * movingRatio;
    } else {
      bobY = Math.sin(time * 2.4) * 1.5; // idle breathing
    }

    const x = pos.x + shakeX;
    const y = pos.y + bobY;
    const rx = (half * 1.12) * scaleX; // slightly wider than tall: a blob, not a box
    const ry = (half * 0.98) * scaleY;

    ctx.globalAlpha = alpha;

    // Soft ground shadow, squashed into an ellipse under the character.
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.beginPath();
    ctx.ellipse(x, pos.y + half * 0.75, rx * 0.85, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body: a radial gradient standing in for a light source (top-left),
    // so the blob has real volume instead of being a flat fill.
    const bodyColor = entity.hurtTimer > 0 ? '#FFFFFF' : baseColor;
    const bodyGrad = ctx.createRadialGradient(
      x - rx * 0.35, y - ry * 0.4, rx * 0.15,
      x, y, rx * 1.3
    );
    bodyGrad.addColorStop(0, shade(bodyColor, 55));
    bodyGrad.addColorStop(0.55, bodyColor);
    bodyGrad.addColorStop(1, shade(bodyColor, -35));

    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();

    // Your own character gets a bright ring so you never lose track of it.
    ctx.lineWidth = entity.id === myId ? 3.5 : 2;
    ctx.strokeStyle = entity.id === myId ? '#F2ECE4' : 'rgba(0, 0, 0, 0.5)';
    ctx.stroke();

    // A small glossy shine, offset toward the light source — this single
    // highlight does more to sell "cute round character" than anything else.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.38, y - ry * 0.45, rx * 0.26, ry * 0.18, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // Blush cheeks — a small CozyLink-ish touch of warmth on an otherwise
    // simple shape.
    ctx.fillStyle = 'rgba(226, 59, 59, 0.28)';
    ctx.beginPath();
    ctx.ellipse(x - rx * 0.5, y + ry * 0.25, rx * 0.18, ry * 0.13, 0, 0, Math.PI * 2);
    ctx.ellipse(x + rx * 0.5, y + ry * 0.25, rx * 0.18, ry * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // Eyes glance in the direction of actual movement (or the last
    // direction faced, once stopped) — a small detail that makes the
    // character feel aware rather than just decorated.
    const eyeOffsetX = lookDir.x * 2.2;
    const eyeOffsetY = lookDir.y * 1.6;
    const eyeSpacing = rx * 0.42;
    const eyeY = y - ry * 0.08;
    [-1, 1].forEach((side) => {
      const ex = x + side * eyeSpacing;
      ctx.fillStyle = '#14121A';
      ctx.beginPath();
      ctx.ellipse(ex, eyeY, 4.4, 5.4, 0, 0, Math.PI * 2);
      ctx.fill();

      // A tiny highlight dot in each pupil, offset by look direction.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(ex + eyeOffsetX * 0.6 - 1, eyeY + eyeOffsetY * 0.6 - 1.3, 1.3, 0, Math.PI * 2);
      ctx.fill();
    });

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

function updateParticles(dt) {
  particles.forEach((p) => {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 260 * dt; // light gravity
  });
  particles = particles.filter((p) => p.age < p.life);
}

function drawParticles() {
  particles.forEach((p) => {
    const alpha = 1 - p.age / p.life;
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  });
  ctx.globalAlpha = 1;
}

let lastFrameTime = performance.now();

function renderLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
  lastFrameTime = now;
  const time = now / 1000;

  ctx.save();

  // Screen shake decays smoothly rather than cutting off abruptly.
  if (shakeTime > 0) {
    shakeTime = Math.max(0, shakeTime - dt);
    const power = shakeMagnitude * (shakeTime / 0.22);
    ctx.translate((Math.random() - 0.5) * power, (Math.random() - 0.5) * power);
  }

  ctx.clearRect(-20, -20, ARENA_W + 40, ARENA_H + 40);

  if (latestState) {
    smoothPositions(latestState, dt);

    drawFloor();
    drawIdleMechanisms(latestState);
    drawObstacles(latestState);

    if (latestState.hazard) {
      if (latestState.hazard.phase === 'WARNING') drawWarning(latestState, time);
      if (latestState.hazard.phase === 'ATTACK') drawAttack(latestState);
    }

    drawPlayers(latestState, time, dt);
    updateParticles(dt);
    drawParticles();
    drawHurtVignette(latestState);

    updateHud(latestState);
    updateOverlay(latestState);
  }

  ctx.restore();
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

  document.getElementById('joystick-zone').classList.remove('hidden');
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

// ---------------------------------------------------------------------------
// Copy/selection deterrent
// ---------------------------------------------------------------------------
// IMPORTANT HONESTY NOTE: this stops casual right-click-copy / text
// selection in the UI. It is NOT real protection — anyone can still read
// this page's source via view-source, DevTools, or the Network tab; no
// front-end trick can prevent that. The actual security in this game is
// that the SERVER is authoritative for every position, hit, and score, so
// nothing a player copies or edits client-side can let them cheat a result.
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('copy', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Mobile polish
// ---------------------------------------------------------------------------
// Stops the page bouncing/refreshing when someone drags inside the arena or
// joystick on iOS/Android — those gestures are meant to control the game,
// not scroll the page.
document.addEventListener('touchmove', (e) => {
  if (!screens.game.classList.contains('hidden')) e.preventDefault();
}, { passive: false });
