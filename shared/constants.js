// shared/constants.js
//
// This file is loaded by BOTH the server (via require) and the client
// (via a plain <script> tag). Keeping these values in one place means
// the client and server can never accidentally disagree about event
// names or game rules.

const GAME_CONSTANTS = {
  MAX_PLAYERS_PER_ROOM: 2,
  ROOM_CODE_LENGTH: 6,

  // Every game type the library currently supports. A room is created
  // "as" one of these. Adding a new game means adding one line here,
  // plus one line in server/games/index.js — nothing else needs to change.
  GAME_TYPES: {
    TIC_TAC_TOE: 'tic-tac-toe'
  },

  // Names of every Socket.IO event used in this project.
  // These are intentionally GENERIC (not tied to Tic-Tac-Toe specifically),
  // so future games in the library can reuse the exact same event names —
  // e.g. PLAYER_INPUT can carry a Tic-Tac-Toe move today and a joystick
  // direction in a different game tomorrow.
  // Using constants instead of raw strings avoids typos causing silent bugs.
  EVENTS: {
    CREATE_ROOM: 'create-room',
    JOIN_ROOM: 'join-room',
    LEAVE_ROOM: 'leave-room',
    START_GAME: 'start-game',
    GAME_STARTED: 'game-started',
    PLAYER_JOINED: 'player-joined',
    PLAYER_LEFT: 'player-left',
    PLAYER_INPUT: 'player-input',
    GAME_STATE: 'game-state'
  }
};

// In Node.js, export it normally.
// In the browser, this block is skipped and GAME_CONSTANTS just becomes
// a global variable (because there's no module system loading this file).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GAME_CONSTANTS;
}
