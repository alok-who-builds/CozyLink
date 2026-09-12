// client/game.js
//
// This is Game #1 in the library: Tic-Tac-Toe.
// It does three things:
//   1. Manages which screen is visible (landing / join / lobby / game)
//   2. Renders the 3x3 board based on state from the server
//   3. Sends a move to the server whenever the player taps/clicks a cell
//
// Notice this file NEVER calls `socket.emit` or `socket.on` directly —
// it only talks to `network.js`. A future game (co-op puzzle, survival,
// whatever) can copy this exact pattern with completely different
// rendering and still reuse network.js unchanged.

// ---------- Screen management ----------
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

// ---------- Connection status banner ----------
const statusEl = document.getElementById('connection-status');

network.onConnected(() => {
  statusEl.textContent = 'Connected to multiplayer server';
  statusEl.classList.remove('offline');
});

network.onDisconnected(() => {
  statusEl.textContent = 'Disconnected';
  statusEl.classList.add('offline');
});

// ---------- Landing screen ----------
document.getElementById('btn-create-room').addEventListener('click', () => {
  network.createRoom((response) => {
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

// ---------- Lobby screen ----------
const lobbyRoomCodeEl = document.getElementById('lobby-room-code');
const lobbyPlayerListEl = document.getElementById('lobby-player-list');
const lobbyStatusEl = document.getElementById('lobby-status');
const btnStart = document.getElementById('btn-start');

let knownPlayers = [];
let currentRoomCode = null;

function enterLobby(roomCode) {
  currentRoomCode = roomCode;
  showScreen('lobby');
  lobbyRoomCodeEl.textContent = roomCode;
  updateLobbyDisplay();
}

function updateLobbyDisplay() {
  lobbyPlayerListEl.innerHTML = '';

  for (let i = 1; i <= 2; i++) {
    const present = knownPlayers.some((p) => p.number === i);
    const symbol = i === 1 ? 'X' : 'O';
    const li = document.createElement('li');
    li.textContent = `Player ${i} (${symbol})   ${present ? '\u25CF Connected' : '\u25CB Waiting...'}`;
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

network.onGameStarted(() => {
  document.getElementById('game-room-code').textContent = currentRoomCode;
  document.getElementById('disconnect-notice').classList.add('hidden');
  boardDisabled = false;
  showScreen('game');
});

// ---------- Game screen (Tic-Tac-Toe board) ----------
const cellEls = Array.from(document.querySelectorAll('.cell'));
const turnStatusEl = document.getElementById('turn-status');
const yourSymbolEl = document.getElementById('your-symbol');
const btnPlayAgain = document.getElementById('btn-play-again');
const disconnectNoticeEl = document.getElementById('disconnect-notice');

let boardDisabled = false;

cellEls.forEach((cellEl, index) => {
  cellEl.addEventListener('click', () => {
    if (boardDisabled) return;

    // Send the move. The server is the one that actually decides if
    // this is legal — we just react if it says no.
    network.sendInput({ cell: index }, (result) => {
      if (!result.success) {
        cellEl.classList.add('shake');
        setTimeout(() => cellEl.classList.remove('shake'), 300);
      }
    });
  });
});

network.onGameState((data) => {
  renderBoard(data);
});

function renderBoard(data) {
  const { playerNumber } = network.getPlayerInfo();
  const mySymbol = playerNumber === 1 ? 'X' : 'O';
  yourSymbolEl.textContent = `You are: ${mySymbol}`;

  data.board.forEach((value, index) => {
    cellEls[index].textContent = value || '';
    cellEls[index].classList.toggle('taken', !!value);

    const isWinningCell = data.winningLine && data.winningLine.includes(index);
    cellEls[index].classList.toggle('winning', !!isWinningCell);
  });

  if (data.winner === 'draw') {
    turnStatusEl.textContent = "It's a draw!";
    btnPlayAgain.classList.remove('hidden');
    boardDisabled = true;
  } else if (data.winner) {
    const youWon = data.winner === mySymbol;
    turnStatusEl.textContent = youWon ? 'You win! \uD83C\uDF89' : `${data.winner} wins!`;
    btnPlayAgain.classList.remove('hidden');
    boardDisabled = true;
  } else {
    const isMyTurn = data.turn === mySymbol;
    turnStatusEl.textContent = isMyTurn ? 'Your turn' : `Waiting for ${data.turn}...`;
    btnPlayAgain.classList.add('hidden');
  }
}

btnPlayAgain.addEventListener('click', () => {
  // Reuses the same START_GAME message — the server just resets the board.
  network.startGame();
});

network.onPlayerLeave((data) => {
  // Figure out which player number just left, for a friendly message.
  const leavingPlayer = knownPlayers.find((p) => p.id === data.playerId);
  const number = leavingPlayer ? leavingPlayer.number : '?';

  disconnectNoticeEl.textContent = `Player ${number} disconnected. Game paused.`;
  disconnectNoticeEl.classList.remove('hidden');
  boardDisabled = true; // no point letting the remaining player keep clicking

  knownPlayers = knownPlayers.filter((p) => p.id !== data.playerId);
  updateLobbyDisplay();
});
