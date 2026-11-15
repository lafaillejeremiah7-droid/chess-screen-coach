# Python Chess Screen Coach

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
