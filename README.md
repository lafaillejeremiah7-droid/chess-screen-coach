# Chess Study Sidecar

A privacy-focused, browser-based chess analysis sidecar for **permitted study**: bot games, puzzles, personal analysis, and post-game review. It accepts a desktop screen share or screenshot, recognizes pieces using local image templates, and asks a locally running Stockfish engine for the strongest moves. Desktop Chrome can show recommendations in an always-on-top Picture-in-Picture window.

> **Fair play:** Do not use engine suggestions in live games against other people on Chess.com or other sites. That violates their fair-play rules and can result in account restrictions.

## What works

- Desktop Chrome screen sharing (`getDisplayMedia`) with user permission; no video is sent to a server.
- Uploading a Chess.com screenshot, including from iPhone.
- Dragging a square around the board, recognizing the 64 squares, and correcting any misread pieces.
- Position input/output via FEN, with explicit side-to-move, castling and en-passant controls.
- Tracking a single legal move between consecutive screenshots to preserve turn, castling rights and en-passant state.
- Local Stockfish analysis (depth 16, MultiPV 3), move notation and evaluation.
- Floating recommendations window via Document Picture-in-Picture in supported desktop Chrome versions.
- Optional auto-read every three seconds, intended for permitted bot/practice sessions.

## Limitations

- **iPhone:** iOS does not let a normal web page float an always-on-top panel over the Chess.com app. Use screenshot uploads, or use desktop Chrome for screen share and floating panel.
- The screenshot recognizer is calibrated to the standard green Chess.com board and the supplied piece style. Other themes and boards can be misread. Always verify the 64-square position before trusting the result.
- A single screenshot does **not** reveal whose turn it is, castling rights, or en-passant rights. Set these explicitly for the first position. Subsequent *single* legal moves can be tracked automatically; missed frames may require manual correction.
- This is not a native Chess.com plugin and does not read game data from Chess.com servers.
- Stockfish WASM can take time to initialize on low-memory devices.

## Run locally

Requirements: Node.js 20+ and npm.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite (usually http://localhost:5173). The first command installs `chess.js`, `stockfish` and Vite. The second copies the browser-compatible Stockfish JS+WASM engine into the public assets directory. If the Stockfish npm package changes its binary filenames, `scripts/copy-engine.mjs` will locate the matching JS+WASM pair or fail with an explicit message.

To build for static hosting:

```bash
npm run build
npm run preview
```

## Deploy on GitHub Pages

1. Create a new GitHub repository named `chess-study-sidecar`.
2. Push this folder's contents to its `main` branch.
3. In **Settings → Pages**, select **GitHub Actions** as the source.
4. The workflow in `.github/workflows/pages.yml` installs dependencies, builds the app, and deploys `dist/`.
5. Open the deployed HTTPS URL in desktop Chrome, share the Chess.com practice tab, and select the board.

The app works on GitHub Pages without a backend. No OpenAI API key is required.

## Testing

```bash
npm test
```

The unit tests cover board orientation, FEN round-trips, and empty-square detection. Full browser, engine, and deployment integration tests require dependencies and a supported browser.

## Privacy

Screenshot recognition and Stockfish evaluation run locally. The app does not upload images or FEN to a server. GitHub Pages still serves the static assets as any website does; it does not receive your screen capture.

## Attribution

Stockfish is free software licensed under GPLv3. The npm `stockfish` package is distributed under its own upstream license and must retain its required notices if redistributed. `chess.js` is licensed under BSD-2-Clause. Consult their upstream licenses before redistribution or modification.