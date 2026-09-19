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
    TIC_TAC_TOE: 'tic-tac-toe',
    OBSTACLE_SURVIVAL: 'obstacle-survival'
  },

  // Config specific to Obstacle Survival (Game #2). Kept in its own
  // namespace rather than mixed into the top-level constants, since these
  // numbers are meaningless to Tic-Tac-Toe or any other future game —
  // this is exactly why each game gets to define its own shape of things.
  // Client and server both read from here so they can never disagree
  // about arena size or speed.
  OBSTACLE_SURVIVAL: {
    ARENA_WIDTH: 800,
    ARENA_HEIGHT: 500,
    PLAYER_SIZE: 32,
    PLAYER_SPEED: 220, // pixels per second
    TICK_RATE: 30, // server simulation steps per second, for this game only

    // --- Match / health rules (kept separate from movement + hazards so
    // --- these can be re-tuned later without touching gameplay code) ---
    MAX_HP: 3,
    POINTS_TO_WIN: 5,

    // --- Hazard lanes ---
    // The arena is sliced into vertical LANES (for spikes attacking from
    // the top/bottom edges) and horizontal ROWS (for the left/right edges).
    // An attack always leaves most of the arena safe, so there is always
    // somewhere to run to.
    LANE_COUNT: 6,
    ROW_COUNT: 4,
    HORIZONTAL_ATTACK_CHANCE: 0.35, // mostly top/bottom, occasionally sideways

    // --- Timings, in seconds ---
    TIMING: {
      COUNTDOWN: 3,      // "3 - 2 - 1" before a round starts
      WARNING_MAX: 1.5,  // reaction time given by the red warning at round start
      WARNING_MIN: 0.85, // reaction time after the round has ramped up
      WARNING_STEP: 0.07,// how much shorter each successive warning gets
      ATTACK: 0.45,      // how long the spikes stay extended
      RECOVER: 1.0,      // calm gap before the next warning begins
      ROUND_END: 2.6,    // how long the round result stays on screen
      HURT: 0.45,        // hurt/flash animation length
      INVULN: 0.9        // damage cooldown — can't be hit again during this
    }
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
