# Python Chess Screen Coach

> **v0.5.0 candidate branch — not yet installed on your Chromebook.** The
> default `main` branch remains at v0.4.2 until device checks are complete.
> The branch adds configurable Stockfish search time, diagnostic output on
> practice/analysis pages, and color selection independent of board orientation.
> This is not a new chess engine; it uses your locally installed Stockfish.

### v0.5.0 evaluation workflow

1. On the candidate branch, open `chrome://extensions` → Chess Study Coach
   → **Details** → **Extension options**. Explicitly choose White or Black
   if the bottom player and your color are not the same. The Auto setting
   remembers the first inferred color and does not switch when the board flips.
   Explicit `data-player-color` metadata takes priority when Auto is chosen.
2. Choose a bounded analysis time: **0.2, 0.5, 1, or 2 seconds**. Default 0.2
   retains the older Chromebook CPU budget. Search time is passed through the
   extension and validated by Python; cached results distinguish budgets.
3. Optionally enable factual analysis details on computer/practice or personal
   analysis pages: check/capture/castle/mate when applicable, reported search
   depth, and a side-to-move evaluation. No invented strategic narrative.
4. Automated tests run on this branch and benchmark at least **110** generated
   positions (40 opening, 40 middlegame, 30 endgame) using Stockfish. The
   report includes match rate and estimated centipawn loss versus longer
   same-engine analysis; it is **not** a playing Elo estimate, proof of optimal
   moves, or a measurement of your Chromebook's performance.
5. Before installing this candidate, verify ChromeOS CPU usage, actual player
   color, board parsing, and analysis results in a fresh **bot** game. Your
   existing 0.4.2 installation is unchanged by changes to this branch.


## Recommended on Chromebook: no-screen-share Chrome extension

**This avoids the screen-sharing video stream.** The extension reads chess piece
classes from the visible Chess.com webpage, converts them to FEN, sends that
text to your local Python server, and displays a single instruction at the
top of the chess tab. No screenshots, video, or microphone permissions.

**Page access (v0.4.2):** The extension can load on Chess.com pages, including
pages with human games. It only analyzes boards whose piece elements match
the existing Chess.com DOM reader, and it still needs the local Python server.
Midgame recovery is automatic only when the board provides a matching full FEN; otherwise a fresh game or verified FEN resync is required.
Using engine suggestions during games against other people violates Chess.com's
fair-play rules; this technical update does not change those rules.

### Install the Chrome extension

1. Download the repository ZIP from GitHub (**Code → Download ZIP**) and extract it
   using the Chromebook Files app. If you have already cloned the repository,
   update it using `git pull`.
2. In Chrome, open `chrome://extensions`.
3. Enable **Developer mode**, select **Load unpacked**, and open the
   **extension** folder inside the extracted repository.
4. Install the local Python dependencies in the Linux Terminal and run
   `python3 server.py` as shown below. Only FEN chess-position text is sent
   to `http://127.0.0.1:8765`.
5. Open Chess.com **Play Bots** at
   `https://www.chess.com/play/computer`. Start a fresh game from its
   standard initial position. A dark top-of-tab overlay appears automatically
   and shows `Move [piece] from [square] to [square]` on your turn.

You **do not** need to open the old dashboard or click Share Screen.
The overlay appears where the reader detects a supported board, without a screen-sharing prompt.
To hide it, turn off the extension in `chrome://extensions`.

The extension reads the board after its pieces change, allowing 180 ms for
animations to settle. An unchanged board causes no repeated board reads or
Python requests. Hidden tabs pause their timers and board observer, and resume
when you return. A lightweight check every four seconds retries after missed mutations and finds newly mounted
boards. Temporary incomplete boards are rechecked, and the largest visible compatible board is preferred. The Python backend tracks up to two legal half-moves between readings.

Stockfish uses **one thread, a 16 MiB hash, and a 0.2-second search budget**, with
no background pondering. The hash is only part of its total memory use.
Recent results are cached; overlapping requests are rejected instead of queued.
Shorter searches reduce CPU work but can produce weaker moves in difficult
positions. Tracking errors stop retrying the same position; temporary server
failures retry after ten seconds. No screen frames or image recognition are
used by the extension. Linux and Stockfish still require memory.

### Update an existing installation

1. Stop the old Python process with **Ctrl+C**. In your cloned project folder,
   run `git pull --ff-only`, then `.venv/bin/python server.py`.
2. If your unpacked extension points to a downloaded ZIP, download and extract
   the new repository ZIP and replace/reload that extension folder too. Updating
   the Linux clone does not update a separate copy in Downloads.
3. Open `chrome://extensions`, reload **Chess Study Coach**, and confirm its
   version is **0.4.2**. Reload the Chess.com tab and start a fresh bot game.
4. Close the old screen-sharing dashboard and keep one coach tab open while
   checking whether Chromebook lag has stopped.

**Limitations:** Start from the initial position. If you open a game already
in progress, the initial turn/castling status is not knowable from pieces
alone; use the manual FEN feature on the existing dashboard or restart a bot
game. If more than two half-moves happen between checks or Chess.com changes
its page structure, tracking stops rather than showing an unverified move.
The extension reads Chess.com DOM boards and compatible piece/data-square markup, **not** your Chromebook
desktop or other applications. It has not been tested on your particular
Chromebook.

### Existing Python setup (needed once)

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip stockfish
cd ~/chess-screen-coach
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 server.py
```

If `cd ~/chess-screen-coach` reports a missing directory, run
`git clone https://github.com/lafaillejeremiah7-droid/chess-screen-coach.git`
from your home folder first. **Do not run `git clone` into a folder that
already exists.**

---


This is a **local Python chess coach** for puzzles, bot games, personal practice, and post-game review. It uses browser screen sharing to observe a chessboard, reads pieces from the captured image with local templates, then asks **Python + Stockfish** for the strongest legal move.

The large display and Chrome floating window show **only** the requested instruction, e.g.:

> Move knight from g8 to f6

**Fair play:** Never use engine assistance in live games against other people where it is prohibited. This tool is meant for permitted analysis.

## Chromebook setup (Linux development environment)

1. On your Chromebook, enable **Settings → Developers → Linux development environment** if it is not already enabled.
2. Open the Linux Terminal.
3. Run:

```bash
sudo apt update
sudo apt install -y python3-venv stockfish git
git clone https://github.com/lafaillejeremiah7-droid/chess-screen-coach.git
cd chess-screen-coach
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

4. Open **http://localhost:8765** in desktop Chrome. Keep the Python terminal running.
5. Click **Share screen** and choose the chess tab/window containing a *permitted practice position*. In the preview, drag a square around the full board.
6. Set **Board bottom**, **My pieces**, and **Whose turn when starting?**. The app will read the selected area and then check every two seconds for a single legal move.
7. Click **Show floating move at top of screen** for a movable always-on-top Chrome Document Picture-in-Picture window. You can drag the panel to the top. This requires a supported desktop Chrome browser and a click to open it.

For a screenshot: select **Upload screenshot**, then select the board area. To correct recognition or missed moves, use **Read / resync board** or the FEN field.

### How it works

- Browser JavaScript requests screen sharing (a browser security requirement) and does local image template recognition.
- The recognized FEN goes to your own `127.0.0.1:8765` Python server.
- Python validates the FEN with `python-chess`; Stockfish runs as a local subprocess. It returns the move in plain English.
- Python also tracks **one legal move between captures**, preserving turn and castling rights.

No screenshots are uploaded. Only chess position text is sent to the Python server on your Chromebook. The Python server binds to loopback and is not public.

### Limitations

- Board recognition is calibrated to the default green Chess.com board/piece style. Errors are possible. Verify positions before relying on suggestions.
- The first image cannot reveal whose turn it is, en passant rights, or whether a king/rook moved. Set initial turn explicitly and choose castling rights if needed.
- A missed pair of moves cannot be safely inferred. Use **Read / resync board** and set the actual turn; manually enter FEN for reliable recovery.
- A webpage cannot open a floating window without your click. Chrome's Picture-in-Picture is browser-dependent; it may not work on mobile.
- This Python app **cannot run on GitHub Pages**, which hosts static sites only. Running `python server.py` locally is required. The old JavaScript-only static-site deployment has been replaced by checks.

### Run tests

```bash
python -m unittest discover -s tests -p 'test_*.py'
npm test
```

If Stockfish is installed in a nonstandard location:

```bash
STOCKFISH_PATH=/absolute/path/to/stockfish python server.py
```

### Board reliability scope (v0.4.2)
- Reads classic Chess.com `square-52` piece classes and alternate `data-piece`, `data-square`, and algebraic `square-e4` markup.
- Prefers the largest visible compatible board when a page contains multiple boards.
- Rechecks temporary animation states and scans periodically for missed DOM updates without repeated Stockfish searches on an unchanged position.
- Keeps legal-move history when a board is flipped; flipping the visual board does not reset the chess position.
- Can resume from a midgame board when a matching complete FEN is provided as a board attribute. If no complete legal FEN or move history is exposed, the reader cannot safely infer side to move, castling or en-passant rights from pieces alone.
- Not a universal OCR system: canvas/WebGL boards, unsupported sites, invisible boards, nonstandard chess variants, or altered chess-piece HTML may still require manual FEN or the legacy screenshot dashboard. No live Chess.com page or Chromebook-specific test has yet been performed.

### Transient black or missing chessboards (v0.4.2)
If Chess.com temporarily removes the board or replaces its DOM element during a redraw, the overlay says the board is unavailable instead of retaining a possibly stale move. It keeps the last verified FEN, then resumes when the replacement board matches the known position or can be legally tracked from it. If the site is truly black due to GPU/browser rendering or screen-sharing capture, the extension cannot repair Chrome's rendering; test without the legacy dashboard, reload the tab, and check ChromeOS graphics/memory. If the returned board is more than two half-moves beyond the last verified position, manual FEN resynchronization may still be needed.

### Screen-share capture blackout protection (v0.4.2)
The legacy dashboard now detects near-black sampled chessboard frames or paused display-capture tracks. It stops recognition without overwriting the last verified position, indicates a capture problem, and tries again on the next scheduled check. When a readable capture returns, the dashboard can restore the displayed move even if the chess position is unchanged. If the actual Chess.com page itself is black, this does not repair a browser/GPU rendering failure.
