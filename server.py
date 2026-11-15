"""Local Python chess coach: static screen-sharing UI + Stockfish API.

The browser handles screen capture and piece recognition. Python validates FEN and
uses a locally installed Stockfish engine. The service only listens on loopback.
"""
from __future__ import annotations

import json
import mimetypes
import os
import shutil
import threading
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent
ENGINE_LOCK = threading.Lock()
ENGINE: chess.engine.SimpleEngine | None = None
ANALYSIS_SECONDS = 0.2
ANALYSIS_CACHE: OrderedDict[str, dict] = OrderedDict()
MAX_CACHED_POSITIONS = 128
MAX_BODY = 2048
PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
    chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
}


def stockfish_location() -> str:
    """Find local Stockfish; on Debian/ChromeOS it commonly lives in /usr/games."""
    explicit = os.getenv("STOCKFISH_PATH")
    candidates = [explicit] if explicit else []
    candidates += [shutil.which("stockfish"), "/usr/games/stockfish", "/usr/bin/stockfish"]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise FileNotFoundError(
        "Stockfish not installed. On Chromebook Linux run: sudo apt install stockfish"
    )


def format_instruction(board: chess.Board, move: chess.Move) -> str:
    """Only the requested concise instruction, without evaluations or variations."""
    piece = board.piece_at(move.from_square)
    if piece is None or move not in board.legal_moves:
        raise ValueError("Move is not legal for this position")
    from_sq = chess.square_name(move.from_square)
    to_sq = chess.square_name(move.to_square)
    text = f"Move {PIECE_NAMES[piece.piece_type]} from {from_sq} to {to_sq}"
    if move.promotion:
        text += f" (promote to {PIECE_NAMES[move.promotion]})"
    return text


def analyze_fen(fen: str) -> dict:
    if not isinstance(fen, str) or len(fen) > 120:
        raise ValueError("Invalid FEN")
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise ValueError(f"Invalid position: {exc}") from exc
    if not board.is_valid():
        raise ValueError("Invalid board position; check the recognized pieces and side to move")
    if board.is_game_over():
        return {"instruction": "Game over", "from": None, "to": None, "fen": board.fen()}
    if ENGINE is None:
        raise RuntimeError("Stockfish is unavailable. Install stockfish and restart Python server.")
    # Do not accumulate searches from multiple tabs on a small Chromebook.
    if not ENGINE_LOCK.acquire(blocking=False):
        raise RuntimeError("Engine busy. Keep one coach tab open and try again.")
    try:
        key = board.fen()
        if key in ANALYSIS_CACHE:
            ANALYSIS_CACHE.move_to_end(key)
            return dict(ANALYSIS_CACHE[key])
        result = ENGINE.play(board, chess.engine.Limit(time=ANALYSIS_SECONDS), ponder=False)
        move = result.move
        if move is None:
            raise RuntimeError("Stockfish did not return a legal move")
        answer = {
            "instruction": format_instruction(board, move),
            "from": chess.square_name(move.from_square),
            "to": chess.square_name(move.to_square),
            "fen": key,
        }
        ANALYSIS_CACHE[key] = answer
        if len(ANALYSIS_CACHE) > MAX_CACHED_POSITIONS:
            ANALYSIS_CACHE.popitem(last=False)
        return dict(answer)
    finally:
        ENGINE_LOCK.release()


def placement_key(board: chess.BaseBoard) -> tuple:
    """Compare piece bitboards without serializing hundreds of FEN strings."""
    return (board.pawns, board.knights, board.bishops, board.rooks,
            board.queens, board.kings, board.occupied_co[chess.WHITE],
            board.occupied_co[chess.BLACK])


def advance_position(previous: str, observed_placement: str) -> dict:
    """Advance by one or two legal half-moves, without guessing ambiguous paths.

    A bot can respond faster than a low-frequency browser poll, so the new
    board may be two half-moves ahead. Never infer more than two.
    """
    if not isinstance(previous, str) or not isinstance(observed_placement, str):
        raise ValueError("Missing chess position")
    if len(previous) > 120 or len(observed_placement) > 90:
        raise ValueError("Chess position is too long")
    board = chess.Board(previous)
    if not board.is_valid():
        raise ValueError("Previous position is invalid")
    observed_key = placement_key(chess.BaseBoard(observed_placement))
    if placement_key(board) == observed_key:
        return {"fen": board.fen(), "changed": False}

    first_positions = []
    one_move_matches = []
    for move in board.legal_moves:
        after = board.copy(stack=False)
        after.push(move)
        if placement_key(after) == observed_key:
            one_move_matches.append(after.fen())
        first_positions.append(after)
    if len(one_move_matches) == 1:
        return {"fen": one_move_matches[0], "changed": True}
    if len(one_move_matches) > 1:
        raise ValueError("More than one legal move matches the new board")

    two_move_matches = set()
    for after in first_positions:
        for reply in after.legal_moves:
            finish = after.copy(stack=False)
            finish.push(reply)
            if placement_key(finish) == observed_key:
                two_move_matches.add(finish.fen())
                if len(two_move_matches) > 1:
                    raise ValueError("Ambiguous two-move transition; resync required")
    if len(two_move_matches) == 1:
        return {"fen": two_move_matches.pop(), "changed": True}
    raise ValueError("Cannot track position within two moves; resync required")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        # No image content or chess positions are logged.
        pass

    def respond_json(self, status: int, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        endpoint = urlparse(self.path).path
        if endpoint not in ("/api/analyze", "/api/track"):
            return self.respond_json(404, {"error": "Unknown API endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > MAX_BODY:
                return self.respond_json(413, {"error": "Invalid request size"})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            if endpoint == "/api/track":
                result = advance_position(data.get("previous"), data.get("placement"))
            else:
                result = analyze_fen(data.get("fen"))
            self.respond_json(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.respond_json(400, {"error": str(exc)})
        except Exception as exc:
            self.respond_json(503, {"error": str(exc)})

    def do_GET(self) -> None:
        path = unquote(urlparse(self.path).path)
        if path == "/api/health":
            return self.respond_json(200, {"python": True, "stockfish": ENGINE is not None})
        if path == "/":
            path = "/index.html"
        if path == "/templates/pieces.json":
            path = "/public/templates/pieces.json"
        # Only serve the specific files needed by the local browser interface.
        permitted = (
            path in ("/index.html", "/src/app.js", "/src/recognition.js", "/src/style.css")
            or path == "/public/templates/pieces.json"
        )
        if not permitted:
            self.send_error(404)
            return
        candidate = (ROOT / path.lstrip("/")).resolve()
        if not candidate.is_relative_to(ROOT) or not candidate.is_file():
            self.send_error(404)
            return
        content = candidate.read_bytes()
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main() -> None:
    global ENGINE
    try:
        ENGINE = chess.engine.SimpleEngine.popen_uci(stockfish_location())
        ENGINE.configure({"Threads": 1, "Hash": 16})
        print("Stockfish ready: 1 thread, 16 MiB hash, 0.2-second searches; no pondering.")
    except Exception as exc:
        if ENGINE is not None:
            ENGINE.close()
            ENGINE = None
        print(f"Stockfish unavailable: {exc}")
    port = int(os.getenv("PORT", "8765"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Open http://localhost:{port} in Chrome")
    print("For practice, puzzles, bot games, and post-game analysis only.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
        if ENGINE is not None:
            ENGINE.quit()
            ENGINE = None


if __name__ == "__main__":
    main()
