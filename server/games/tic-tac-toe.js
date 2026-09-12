// server/games/tic-tac-toe.js
//
// All the RULES of a single Tic-Tac-Toe match live in this one file,
// completely separate from Socket.IO / rooms / connections.
//
// This is the pattern every future game in the library should follow:
// a small, self-contained "rules" module that server.js calls into.
// server.js doesn't need to know anything about how Tic-Tac-Toe works —
// it just calls applyMove() and broadcasts whatever comes back.

const WINNING_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // columns
  [0, 4, 8], [2, 4, 6]             // diagonals
];

// Called once when a match starts (or restarts via "Play Again").
function createInitialState() {
  return {
    board: Array(9).fill(null), // null = empty cell, otherwise 'X' or 'O'
    turn: 'X',                  // X always moves first
    winner: null,               // 'X', 'O', 'draw', or null while still playing
    winningLine: null           // the 3 winning cell indexes, once there's a winner
  };
}

function checkWinner(board) {
  for (const line of WINNING_LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], winningLine: line };
    }
  }
  if (board.every((cell) => cell !== null)) {
    return { winner: 'draw', winningLine: null };
  }
  return { winner: null, winningLine: null };
}

// Tries to apply a move. Returns { success: true, state } or
// { success: false, error }. SECURITY NOTE: this is where we make sure
// a client can't cheat — e.g. play on someone else's turn, play twice,
// or play on a cell that's already taken.
function applyMove(state, symbol, cellIndex) {
  if (state.winner) {
    return { success: false, error: 'Game is already over.' };
  }
  if (state.turn !== symbol) {
    return { success: false, error: 'Not your turn.' };
  }
  if (
    typeof cellIndex !== 'number' ||
    cellIndex < 0 ||
    cellIndex > 8 ||
    state.board[cellIndex] !== null
  ) {
    return { success: false, error: 'Invalid move.' };
  }

  const newBoard = state.board.slice();
  newBoard[cellIndex] = symbol;

  const { winner, winningLine } = checkWinner(newBoard);

  const newState = {
    board: newBoard,
    turn: symbol === 'X' ? 'O' : 'X',
    winner,
    winningLine
  };

  return { success: true, state: newState };
}

module.exports = { createInitialState, applyMove };
