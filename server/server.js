// server/server.js
//
// Entry point for the multiplayer server.
// Sets up Express (basic HTTP, mostly for a health-check page) and
// Socket.IO (real-time communication with each connected browser).

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { EVENTS, MAX_PLAYERS_PER_ROOM } = require('../shared/constants');
const rooms = require('./rooms');
const games = require('./games/index');

const app = express();
const server = http.createServer(app);

// CORS: the frontend (GitHub Pages) and backend (Node host) will live on
// completely different domains, so we have to explicitly allow that.
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.get('/', (req, res) => {
  res.send('Co-op multiplayer server is running.');
});

// Small helper: broadcasts the current game state + player list to
// everyone in a room. Every game in this library can follow this same
// "one object describing everything the client needs to render" pattern.
function broadcastGameState(io, room) {
  io.to(room.code).emit(EVENTS.GAME_STATE, {
    ...room.game,
    players: Object.values(room.players)
  });
}

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // ---------- CREATE ROOM ----------
  socket.on(EVENTS.CREATE_ROOM, (gameType, callback) => {
    if (typeof callback !== 'function') return;

    // rooms.createRoom() defaults to Tic-Tac-Toe if gameType is undefined —
    // this keeps the current client (which doesn't pick a game yet) working.
    const room = rooms.createRoom(socket.id, gameType);
    socket.join(room.code); // Socket.IO's built-in room feature for easy broadcasting

    callback({
      success: true,
      roomCode: room.code,
      gameType: room.gameType,
      playerId: socket.id,
      playerNumber: 1,
      players: Object.values(room.players)
    });
  });

  // ---------- JOIN ROOM ----------
  socket.on(EVENTS.JOIN_ROOM, (rawCode, callback) => {
    if (typeof callback !== 'function') return;

    const code = String(rawCode || '').trim(); // never trust raw client input
    const result = rooms.joinRoom(code, socket.id);

    if (result.error) {
      callback({ success: false, message: result.error });
      return;
    }

    socket.join(code);
    const players = Object.values(result.room.players);

    callback({
      success: true,
      roomCode: code,
      gameType: result.room.gameType,
      playerId: socket.id,
      playerNumber: 2,
      players
    });

    // SERVER -> OTHER CLIENT: tell the player already in the room that
    // someone just joined them.
    socket.to(code).emit(EVENTS.PLAYER_JOINED, { players });
  });

  // ---------- START GAME (also used for "Play Again") ----------
  socket.on(EVENTS.START_GAME, (code) => {
    const room = rooms.getRoom(code);
    if (!room) return;

    const playerCount = Object.keys(room.players).length;
    if (playerCount < MAX_PLAYERS_PER_ROOM) return; // can't start with only 1 player

    const startedRoom = rooms.startGame(code); // creates a fresh board every time this is called
    if (!startedRoom) return; // unknown/misconfigured game type — don't broadcast a fake state

    io.to(code).emit(EVENTS.GAME_STARTED);
    broadcastGameState(io, room);
  });

  // ---------- PLAYER INPUT (a game action) ----------
  // CLIENT -> SERVER. The client just says "here's my action" (shape
  // depends on the game — for Tic-Tac-Toe that's { cell: 4 }). server.js
  // doesn't need to know what that shape means; it hands the action to
  // whichever game module this room is running (via the registry) and
  // that module decides if it's legal. The client never touches the
  // game state directly.
  socket.on(EVENTS.PLAYER_INPUT, (action, callback) => {
    const room = rooms.findRoomBySocket(socket.id);
    const game = room ? games[room.gameType] : null;

    if (!room || !room.game || !game) {
      if (typeof callback === 'function') callback({ success: false, error: 'No active game.' });
      return;
    }

    const player = room.players[socket.id];

    // A player can only ever act as THEIR OWN identity — we look it up
    // from their own socket connection, they can't send someone else's.
    const result = game.applyMove(room.game, player.symbol, action);

    if (result.success) {
      room.game = result.state;
      broadcastGameState(io, room);
    }

    if (typeof callback === 'function') callback(result);
  });

  // ---------- DISCONNECT ----------
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);

    const result = rooms.removePlayerFromRoom(socket.id);
    if (!result || result.roomDeleted) return;

    io.to(result.roomCode).emit(EVENTS.PLAYER_LEFT, { playerId: socket.id });
  });

  // Prevents a single malformed/unexpected message from crashing the server.
  socket.on('error', (err) => {
    console.error('Socket error from', socket.id, err);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
