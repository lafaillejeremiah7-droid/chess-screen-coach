# Full Stockfish 19 — Minimal Chrome Extension

A single-purpose Chrome extension: read the current visible Chess.com board,
run the **full Stockfish 19 NNUE WASM engine**, and show one move in the top-right corner.

No Python server, dashboard, training mode, popup, settings, Elo cap, or
game-mode filtering. Stockfish searches for **one second per changed position**
at full engine strength. It analyzes the side to move, regardless of player color.
It never reconstructs positions from move history.

## Install on Chromebook

1. Open **Actions** in this GitHub repository and select **Full Stockfish 19 extension**.
2. Download the latest successful artifact named **full-stockfish-19-v0.8.0**.
3. Extract the ZIP. Open Chrome Extensions at chrome://extensions, enable
   Developer mode, then select **Load unpacked** and choose the extracted folder
   containing manifest.json.
4. Refresh the Chess.com tab. A small top-right status shows the move.

Chrome's **Reload** button reloads local extension files, not GitHub changes.
To update, replace the extracted files and reload the extension and Chess.com tab.

## How it works

- extension/board.js: reads the current DOM pieces, turn and FEN metadata.
- extension/content.js: watches the board and displays the move.
- extension/background.js: starts an offscreen engine host.
- standalone/engine-host.mjs: runs the pinned Full Stockfish 19 WASM worker.
- standalone/build.mjs: verifies engine SHA-256 and packages the extension.

The board reader will wait rather than guess if the side to move cannot be
verified. If Chess.com does not expose castling or en-passant rights, those
rights cannot be reconstructed from pieces alone; some special moves may be
missing from analysis. This is a data limitation, not an Elo or game-mode cap.

## Build locally

Requires Node.js 22+.

    npm install --prefix standalone
    npm run build --prefix standalone
    npm test --prefix standalone

Load dist/extension/ as an unpacked extension. The packaged WASM and its
GPL license are included in the GitHub Actions artifact.
