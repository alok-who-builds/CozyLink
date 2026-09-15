// server/games/index.js
//
// A lookup table: game type string -> that game's rules module.
// This is the ONLY file server.js needs to know about when it comes to
// "which game logic applies to this room". Adding a new game to the
// library later means adding exactly ONE line here — nothing in
// server.js, rooms.js, or network.js needs to change.

const ticTacToe = require('./tic-tac-toe');

module.exports = {
  'tic-tac-toe': ticTacToe

  // When you add Game #2, register it the same way, e.g.:
  // 'rock-paper-scissors': require('./rock-paper-scissors'),
};
