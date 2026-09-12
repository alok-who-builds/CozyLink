# Co-op Multiplayer Foundation

A small, reusable foundation for building **2-player online co-op browser games**.
This project is *not* a finished game — it's a tested skeleton that handles the
hard parts (connecting two players over the internet, rooms, and real-time
movement syncing) so you can build actual games on top of it later.

---

## 1. What this project is

Two people, on two different devices anywhere in the world, can:

1. Open the same website.
2. One player clicks **CREATE ROOM** and gets a short code (like `482913`).
3. The other player types that code and clicks **JOIN**.
4. Both players land in the same room and see each other move in real time.

Right now the "game" is just a blue circle (Player 1) and a red circle
(Player 2) moving around a plain canvas — this exists purely to prove the
networking works, so you can build a real game on top of it with confidence.

---

## 2. How multiplayer works (the big idea)

The most important rule in this project:

> **The server decides where players actually are. The client only reports
> what keys are being pressed.**

Flow for movement:

```
CLIENT (keys held down)
     ↓ sends input (e.g. {up:false, down:false, left:false, right:true})
SERVER
     ↓ moves the player based on that input, 20 times per second
     ↓ this becomes the "authoritative" state — the one true version of reality
SERVER broadcasts the new positions
     ↓
BOTH CLIENTS render whatever the server says
```

Why not just have each browser send its own x/y position directly? Because:
- A buggy or malicious client could send a fake position (teleporting, cheating).
- If both clients decide movement independently, they can drift out of sync.

By keeping the server in charge, both players always see the exact same
world, and this pattern scales cleanly to more complex games later.

---

## 3. How the client talks to the server

All real-time communication uses **Socket.IO**, a library built on top of
WebSockets. The client never touches Socket.IO directly except inside
`client/network.js` — every other file (like `game.js`) just calls simple
functions like `network.createRoom()` or `network.sendInput()`.

This separation means a *future game* can reuse `network.js` unchanged and
just write its own rendering/input code, similar to `game.js`.

---

## 4. How to install dependencies

You need [Node.js](https://nodejs.org) installed (version 18+ recommended).

In the project's root folder, run:

```
npm install
```

This installs the server dependencies (`express` and `socket.io`).

---

## 5. How to start the server

```
npm start
```

You should see:

```
Server listening on port 3000
```

Leave this running in a terminal while you test.

---

## 6. How to open two local players

The `client/` folder is plain HTML/CSS/JS — no build step needed.

**Easiest way:** open `client/index.html` directly in two separate browser
windows (or one normal window + one incognito window, so they don't share
browser storage).

**Recommended way** (avoids some browser quirks with `file://` URLs): serve
the client folder with a simple local server. For example, from inside the
`client/` folder:

```
npx serve .
```

Then open the printed local URL (e.g. `http://localhost:3000` — if that
clashes with your Node server's port, `serve` will offer a different one) in
two separate browser windows.

Make sure `client/config.js` points at `http://localhost:3000` (the Node
server), which it does by default.

---

## 7. How to test room creation

1. In browser window #1, click **CREATE ROOM**.
2. You should see a message like: `Room created! Your room code: 482913`
   (shown as the room heading in the lobby screen).
3. In browser window #2, click **JOIN ROOM**, type the same code, and click **JOIN**.
4. Both windows should now show the lobby with:
   ```
   Player 1   ● Connected
   Player 2   ● Connected
   Both players ready!
   ```
5. Try a wrong code — you should see `Room does not exist.`
6. Try joining a room that already has 2 players — you should see `Room is full.`

---

## 8. How to test Game #1: Tic-Tac-Toe

1. From the lobby, click **START** (only enabled once both players are in).
2. Player 1 (who created the room) is always **X**; Player 2 is always **O**.
3. Take turns tapping/clicking cells. You'll see:
   - "Your turn" / "Waiting for O..." (or X) depending on whose turn it is
   - Attempting to move out of turn, or on a taken cell, does nothing but a
     small shake — the server rejects it
4. When someone gets 3 in a row, the winning line highlights green and a
   **PLAY AGAIN** button appears (resets the board, same room, same players).
5. Close one browser window mid-game — the other should show
   `Player X disconnected. Game paused.` and the board stops accepting moves.

Because this game only needs taps/clicks (no keyboard), it already works
identically on a phone and a laptop with zero extra code — a good sign the
foundation is set up the way you want it.

---

## 9. How deployment will eventually work

This project is split so the two halves can live on different hosts:

- **Frontend (`client/`)** → deploy as static files to **GitHub Pages**.
- **Backend (`server/` + `shared/`)** → deploy to a Node.js host that keeps a
  process running (e.g. Render, Railway, Fly.io — anywhere that supports
  long-running WebSocket connections; GitHub Pages cannot run your server
  because it only serves static files).

Once your backend is deployed, you'll get a public URL like
`https://your-app.onrender.com`. Update **one line** in
`client/config.js`:

```js
const CONFIG = {
  SERVER_URL: 'https://your-app.onrender.com'
};
```

Then push `client/` to GitHub Pages. No other code changes should be needed
— this is the entire point of centralizing the server URL in one config file.

---

## 10. Which files are responsible for which parts

```
coop-multiplayer/
│
├── client/                  ← everything that runs in the browser
│   ├── index.html            → page structure (all 4 screens + the board)
│   ├── style.css              → visual styling
│   ├── config.js                → the ONE place with the server URL
│   ├── network.js                 → the ONLY file that talks to Socket.IO;
│   │                                 exposes createRoom(), joinRoom(),
│   │                                 sendInput(), onGameState(), etc.
│   └── game.js                    → screen switching, board rendering, and
│                                     click handling — uses network.js only
│
├── server/                  ← everything that runs on Node.js
│   ├── server.js              → sets up Express + Socket.IO, wires up all
│   │                             event handlers
│   ├── rooms.js                → creates/finds/removes rooms, generates codes
│   └── games/
│       └── tic-tac-toe.js       → ALL Tic-Tac-Toe rules (board, turns, win
│                                   checking, move validation) — completely
│                                   separate from connection/room handling.
│                                   Future games get their own file here.
│
├── shared/
│   └── constants.js         ← event names & room settings used by BOTH
│                               the client and server, so they can't drift
│                               out of sync with each other
│
├── package.json             ← server dependencies & npm start script
├── .gitignore
└── README.md                ← this file
```

---

## What's next

Tic-Tac-Toe is Game #1 in the library. When you're ready to add Game #2
(puzzle, survival, rhythm, casual, etc.), the pattern is:

- Keep `server/rooms.js`, `client/network.js`, and `shared/constants.js`
  exactly as they are — they don't know or care which game is being played.
- Add a new rules file under `server/games/` (copy the shape of
  `tic-tac-toe.js`: `createInitialState()` + a function that validates and
  applies one action).
- Write a new `game.js` (and matching HTML/CSS) for that game's screen and
  rendering — it should only ever call `network.js` functions, never
  `socket.io` directly.
- Wire the new game's rules file into `server.js`'s `PLAYER_INPUT` handler.

Since every game shares the same room/connection code, players will always
join the same way (create room → share code → join → lobby) no matter which
game they're about to play.
