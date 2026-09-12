// client/network.js
//
// THIS IS THE FILE FUTURE GAMES SHOULD USE.
// It's the only file in the client that ever touches `socket.io` directly.
// Every game (this test world, or a future puzzle/survival/beat game)
// should call these functions instead of reaching for Socket.IO itself.
// That's what makes the multiplayer foundation reusable.

const network = (() => {
  let socket = null;
  let roomCode = null;
  let playerId = null;
  let playerNumber = null;

  // "Callback slots" — a game registers interest with network.onXxx(fn),
  // and we call that function whenever the matching server event arrives.
  const callbacks = {
    connected: null,
    disconnected: null,
    playerJoin: null,
    playerLeft: null,
    gameState: null,
    gameStarted: null
  };

  function connect() {
    if (socket) return; // already connected, don't create a second one

    socket = io(CONFIG.SERVER_URL);

    socket.on('connect', () => {
      if (callbacks.connected) callbacks.connected();
    });

    socket.on('disconnect', () => {
      if (callbacks.disconnected) callbacks.disconnected();
    });

    socket.on(GAME_CONSTANTS.EVENTS.PLAYER_JOINED, (data) => {
      if (callbacks.playerJoin) callbacks.playerJoin(data);
    });

    socket.on(GAME_CONSTANTS.EVENTS.PLAYER_LEFT, (data) => {
      if (callbacks.playerLeft) callbacks.playerLeft(data);
    });

    socket.on(GAME_CONSTANTS.EVENTS.GAME_STATE, (data) => {
      if (callbacks.gameState) callbacks.gameState(data);
    });

    socket.on(GAME_CONSTANTS.EVENTS.GAME_STARTED, () => {
      if (callbacks.gameStarted) callbacks.gameStarted();
    });
  }

  function createRoom(callback) {
    connect();
    socket.emit(GAME_CONSTANTS.EVENTS.CREATE_ROOM, (response) => {
      if (response.success) {
        roomCode = response.roomCode;
        playerId = response.playerId;
        playerNumber = response.playerNumber;
      }
      callback(response);
    });
  }

  function joinRoom(code, callback) {
    connect();
    socket.emit(GAME_CONSTANTS.EVENTS.JOIN_ROOM, code, (response) => {
      if (response.success) {
        roomCode = response.roomCode;
        playerId = response.playerId;
        playerNumber = response.playerNumber;
      }
      callback(response);
    });
  }

  function startGame() {
    if (!socket || !roomCode) return;
    socket.emit(GAME_CONSTANTS.EVENTS.START_GAME, roomCode);
  }

  // Sends a game action (e.g. a Tic-Tac-Toe move, or a movement key
  // state in a future game) to the server. The server decides whether
  // it's actually legal. If you pass a callback, it's called with
  // { success, error } (or { success, state }) once the server responds —
  // handy for rejecting an illegal move right where the player clicked.
  function sendInput(inputState, callback) {
    if (!socket) return;
    if (typeof callback === 'function') {
      socket.emit(GAME_CONSTANTS.EVENTS.PLAYER_INPUT, inputState, callback);
    } else {
      socket.emit(GAME_CONSTANTS.EVENTS.PLAYER_INPUT, inputState);
    }
  }

  function leaveRoom() {
    if (!socket) return;
    socket.disconnect();
    socket = null;
    roomCode = null;
    playerId = null;
    playerNumber = null;
  }

  // --- Subscription methods used by game.js (or any future game) ---
  function onConnected(cb) { callbacks.connected = cb; }
  function onDisconnected(cb) { callbacks.disconnected = cb; }
  function onPlayerJoin(cb) { callbacks.playerJoin = cb; }
  function onPlayerLeave(cb) { callbacks.playerLeft = cb; }
  function onGameState(cb) { callbacks.gameState = cb; }
  function onGameStarted(cb) { callbacks.gameStarted = cb; }

  function getPlayerInfo() {
    return { roomCode, playerId, playerNumber };
  }

  return {
    connect,
    createRoom,
    joinRoom,
    startGame,
    sendInput,
    leaveRoom,
    onConnected,
    onDisconnected,
    onPlayerJoin,
    onPlayerLeave,
    onGameState,
    onGameStarted,
    getPlayerInfo
  };
})();
