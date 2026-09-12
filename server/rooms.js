// server/rooms.js
//
// Manages every active room in memory. A "room" here is just a small
// group of up to 2 players, plus whatever game state that room's game
// currently has (room.game — set once START_GAME happens).
//
// NOTE: rooms live in a plain JavaScript object in memory. That's fine
// for a prototype — if the server restarts, all rooms are lost, which
// is an acceptable trade-off at this stage.

const { MAX_PLAYERS_PER_ROOM, ROOM_CODE_LENGTH } = require('../shared/constants');
const ticTacToe = require('./games/tic-tac-toe');

// { roomCode: { code, players: { socketId: playerObject }, started, game } }
const rooms = {};

function generateRoomCode() {
  let code;
  do {
    code = Math.floor(Math.random() * Math.pow(10, ROOM_CODE_LENGTH))
      .toString()
      .padStart(ROOM_CODE_LENGTH, '0');
  } while (rooms[code]); // regenerate on the rare chance of a collision
  return code;
}

function createRoom(hostSocketId) {
  const code = generateRoomCode();

  rooms[code] = {
    code,
    players: {
      // Whoever creates the room is always Player 1 / 'X'.
      [hostSocketId]: { id: hostSocketId, number: 1, symbol: 'X' }
    },
    started: false,
    game: null // populated by startGame() once both players are ready
  };

  return rooms[code];
}

function joinRoom(rawCode, socketId) {
  const room = rooms[rawCode];

  if (!room) {
    return { error: 'Room does not exist.' };
  }

  const playerCount = Object.keys(room.players).length;
  if (playerCount >= MAX_PLAYERS_PER_ROOM) {
    return { error: 'Room is full.' };
  }

  // Whoever joins second is always Player 2 / 'O'.
  room.players[socketId] = { id: socketId, number: 2, symbol: 'O' };

  return { room };
}

function getRoom(code) {
  return rooms[code];
}

function findRoomBySocket(socketId) {
  return Object.values(rooms).find((room) => room.players[socketId]);
}

// Removes a player (e.g. on disconnect) and cleans up the room if it's
// now empty, so we don't leak memory by keeping abandoned rooms forever.
function removePlayerFromRoom(socketId) {
  const room = findRoomBySocket(socketId);
  if (!room) return null;

  delete room.players[socketId];

  if (Object.keys(room.players).length === 0) {
    delete rooms[room.code];
    return { room: null, roomCode: room.code, roomDeleted: true };
  }

  return { room, roomCode: room.code, roomDeleted: false };
}

// Starts (or restarts, for "Play Again") a fresh Tic-Tac-Toe match.
function startGame(code) {
  const room = rooms[code];
  if (!room) return null;
  room.started = true;
  room.game = ticTacToe.createInitialState();
  return room;
}

function getAllRooms() {
  return rooms;
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
  findRoomBySocket,
  removePlayerFromRoom,
  startGame,
  getAllRooms
};
