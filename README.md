# Chess Screen Coach

Local chess practice and analysis with **Python, python-chess, and Stockfish 19**.
The Chrome extension, web dashboard, training page, and sparring page share one local Python server. The extension does not need screen sharing.

## Current capabilities

- **Chrome extension (`extension/`):** Reads compatible Chess.com chessboards from page elements, verifies move tracking, and displays a move. It can reconstruct a midgame position only if a matching full FEN or complete legal move history is available. Supports H to hide/show and pause analysis.
- **Main coach (`server.py`):** Stockfish 19 with `UCI_LimitStrength=true` and approximate `UCI_Elo=1400` by default; one thread, 16 MiB hash, and **one-second searches** by default. The extension can select 0.2, 0.5, 1, or 2 seconds, with previously saved choices preserved.
- **Web dashboard (`http://127.0.0.1:8765/`):** Optional screen sharing or image upload for board recognition, manual FEN analysis, and a small movable Document Picture-in-Picture display. Screen frames stay in the browser; only FEN and other chess data are sent to the local server.
- **Training (`/training.html`):** Up to 100 timed positions in a session, unrestricted engine scoring, and locally saved weakness/review progress. The main coach's 1400 setting is restored after training evaluations.
- **Sparring (`/sparring.html`):** Play White against a separate Stockfish 19 process as Black. Select an approximate 1400–3000 UCI Elo, including **1650 (+250 relative to the main coach’s 1400 target)**; the standalone opponent initially selects **2000**, independently of the main coach. This preset changes only offline sparring, not the Chrome extension or main move-recommendation service.

The numerical UCI Elo setting is **not** an official FIDE, CCRL, or Chess.com rating. Engine recommendations in live games against human opponents can violate platform fair-play rules.

## Chromebook install

Enable the **Linux development environment** in ChromeOS settings, then open Linux Terminal:

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git
git clone https://github.com/lafaillejeremiah7-droid/chess-screen-coach.git
cd chess-screen-coach
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/check_stockfish19_ready.py --install
.venv/bin/python server.py
```

If you already have the repository, **skip the clone step** and use the update instructions below. The server listens on `127.0.0.1:8765`. Keep the terminal running while using the app.

### Install the no-screen-share Chrome extension

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's `extension` directory.
3. Open a compatible Chess.com practice or analysis board; the move overlay appears when the board is recognized and your side is to move.
4. Press **H** on that tab to hide and pause the coach; press **H** again to resume. The shortcut does not shut down the Python server, and it is ignored while typing.

Use **Extension options** to choose White/Black explicitly when automatic orientation inference is incorrect. The extension reads Chess.com board markup, not arbitrary applications, and cannot repair blacked-out browser rendering or unsupported canvas-only boards.

### Update an existing installation

Stop the running Python server with `Ctrl+C`, then:

```bash
cd ~/chess-screen-coach
git pull --ff-only
.venv/bin/python scripts/check_stockfish19_ready.py
.venv/bin/python server.py
```

Reload the unpacked extension in `chrome://extensions`; the manifest version should read **0.6.5**. If the extension is loaded from a *separate extracted ZIP directory*, update that directory too: pulling the Linux checkout does not update a distinct Chrome extension folder.

## Tests and verification

```bash
.venv/bin/python -m unittest discover -s tests -p 'test_*.py'
npm test
.venv/bin/python scripts/audit_main_1400.py --positions 24 --seconds 1
```

`npm test` needs Node.js 22 or newer but **does not require `npm install`**. JavaScript tests use Node's built-in test runner; the obsolete browser Stockfish worker, Vite build, and old npm runtime dependencies have been removed.

The 24-position audit checks whether the 1400-limited bot chooses different moves from stronger engine configurations. **It does not establish an official playing Elo.** GitHub Actions also runs Python/API/extension tests and a real Stockfish 19 integration check.

For installing Stockfish, the engine's executable SHA-256 verification, and manual A/B tests, see [Stockfish 19 notes](docs/stockfish19.md). The separate million-game self-play experiment remains on its own branch and is not part of the main coach.

## Known limitations

- Midgame reconstruction requires a complete move history or valid FEN; board pieces alone do not reveal turn, castling, or en-passant rights.
- Dashboard image recognition depends on the supported piece theme and board appearance. ChromeOS capture and current Chess.com markup require testing on your actual device.
- A hidden coach can leave the local Python server running; stop that process with `Ctrl+C` to shut it down.

Python API access is restricted to loopback with Host/Origin checks. No screen images are uploaded by the extension or Python server.
