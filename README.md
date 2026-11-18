# Stockfish 19 — Terminal

Native **full-strength Stockfish 19** is the only chess engine. No Elo cap, training engine, browser WASM engine, dashboard, saved move history, or game-mode gating.

## Chromebook setup

1. Enable Linux development environment on your Chromebook.
2. Open **Terminal** and clone this repository, or open your existing checkout:
   ```bash
   git clone https://github.com/lafaillejeremiah7-droid/chess-screen-coach.git
   cd chess-screen-coach
   bash start.sh
   ```
3. In Chrome open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and select the repository's **extension** folder.
4. Open Chess.com in Chrome. A small box at the top right shows the current board's suggested move.

For later updates, run `git pull` in the checkout, then press **Reload** on the extension in `chrome://extensions` and refresh the Chess.com tab. Leave the Terminal running while using the extension.

## Run again

```bash
cd ~/chess-screen-coach
bash start.sh
```

Stockfish is installed as `.stockfish/bin/stockfish` by the checksum-verified installer. The local server listens **only** at `127.0.0.1:8765`; stop it with Ctrl+C. Its default analysis budget is one second per position and it never sets UCI Elo or Skill Level limits.

The board reader needs a visible position **and evidence of whose turn it is** (such as an active clock). Piece placement alone cannot reveal the side to move, castling rights, or en-passant rights. If the page does not expose special-move rights, the reader assumes none; that may affect a suggestion. The extension cannot repair information the page does not provide.

## Current-position synchronization (v0.8.1)

The page script re-reads the live board immediately before displaying a Stockfish
reply. Board replacement, turn changes, hidden tabs and temporary board loss
invalidate old suggestions. Observers detect board and clock-layout updates;
a 300 ms scan handles missed events. Each Chess.com tab cancels its own older
HTTP requests, while the Python server skips queued searches that are already
superseded by a newer position. The native Stockfish 19 engine remains fully
unrestricted (UCI_LimitStrength=false) with a one-second analysis budget.

After updating the checkout, restart the Linux terminal server as well as
reloading the Chrome extension and Chess.com page; both sides contain fixes.
