# Python Chess Screen Coach

## Recommended on Chromebook: no-screen-share Chrome extension

**This avoids the screen-sharing video stream.** The extension reads chess piece
classes from the visible Chess.com webpage, converts them to FEN, sends that
text to your local Python server, and displays a single instruction at the
top of the chess tab. No screenshots, video, or microphone permissions.

**Supported pages:** `https://www.chess.com/play/computer` (computer/bot games)
and `https://www.chess.com/analysis` (personal/post-game analysis).
The extension is not injected into Chess.com's live human games. Using engine
suggestions during games against other people violates fair-play rules.

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
The overlay appears only on allowed pages, without a screen-sharing prompt.
To hide it, turn off the extension in `chrome://extensions`.

The extension reads the board every 1.2 seconds, and the Python backend
tracks up to two legal half-moves between checks. It does not constantly run
image recognition or send screen frames. It won't cure freezes caused by
insufficient memory/storage, and the Linux Python process still needs system
resources.

**Limitations:** Start from the initial position. If you open a game already
in progress, the initial turn/castling status is not knowable from pieces
alone; use the manual FEN feature on the existing dashboard or restart a bot
game. If more than two half-moves happen between checks or Chess.com changes
its page structure, tracking stops rather than showing an unverified move.
The extension only reads these supported webpages, **not** your Chromebook
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
```

If Stockfish is installed in a nonstandard location:

```bash
STOCKFISH_PATH=/absolute/path/to/stockfish python server.py
```
