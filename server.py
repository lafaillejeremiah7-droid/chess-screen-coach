"""Minimal full-strength Stockfish 19 service; latest board request takes priority."""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import chess
import chess.engine

ROOT = Path(__file__).resolve().parent
ENGINE_PATH = ROOT / ".stockfish" / "bin" / "stockfish"
ANALYSIS_SECONDS = 1.0
ENGINE = None
ENGINE_LOCK = threading.Lock()
REQUEST_LOCK = threading.Lock()
LATEST_REQUEST = 0
PIECES = {"p": "pawn", "n": "knight", "b": "bishop",
          "r": "rook", "q": "queen", "k": "king"}


class SupersededRequest(Exception):
    """A newer live board is available; do not analyze or return an older one."""


def issue_request() -> int:
    global LATEST_REQUEST
    with REQUEST_LOCK:
        LATEST_REQUEST += 1
        return LATEST_REQUEST


def is_latest(token: int) -> bool:
    with REQUEST_LOCK:
        return token == LATEST_REQUEST


def start_engine():
    if not ENGINE_PATH.is_file():
        raise RuntimeError("Stockfish 19 missing. Run bash start.sh")
    engine = chess.engine.SimpleEngine.popen_uci(str(ENGINE_PATH))
    if not engine.id.get("name", "").startswith("Stockfish 19"):
        engine.quit()
        raise RuntimeError("Expected full native Stockfish 19")
    engine.configure({"Threads": 1, "Hash": 16, "UCI_LimitStrength": False})
    return engine


def position_from_fen(fen: str) -> chess.Board:
    if not isinstance(fen, str) or len(fen) > 120:
        raise ValueError("Invalid FEN")
    try:
        board = chess.Board(fen)
    except ValueError as error:
        raise ValueError("Invalid FEN") from error
    if not board.is_valid():
        raise ValueError("Invalid board position")
    if board.is_game_over():
        raise ValueError("Game over: no legal move")
    return board


def analyze(fen: str, request_token: int | None = None):
    global ENGINE
    board = position_from_fen(fen)
    with ENGINE_LOCK:
        # Lock waiters are checked before using CPU: obsolete searches are skipped.
        if request_token is not None and not is_latest(request_token):
            raise SupersededRequest()
        if ENGINE is None or ENGINE.returncode.done():
            ENGINE = start_engine()
        try:
            result = ENGINE.play(board, chess.engine.Limit(time=ANALYSIS_SECONDS))
        except chess.engine.EngineTerminatedError:
            ENGINE.close()
            ENGINE = None
            raise
        # A new board can arrive during this one-second search.
        if request_token is not None and not is_latest(request_token):
            raise SupersededRequest()
    move = result.move
    if move is None or move not in board.legal_moves:
        raise RuntimeError("Stockfish did not return a legal move")
    instruction = "Move " + PIECES[board.piece_at(move.from_square).symbol().lower()]
    instruction += " from " + chess.square_name(move.from_square)
    instruction += " to " + chess.square_name(move.to_square)
    if move.promotion:
        instruction += " and promote to " + PIECES[chess.piece_symbol(move.promotion)]
    print(instruction, flush=True)
    return {"instruction": instruction, "uci": move.uci(), "engine": "Stockfish 19 Full"}


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            # The browser has already aborted a superseded request.
            pass

    def do_GET(self):
        if self.path == "/health":
            engine = ENGINE
            if engine is None or engine.returncode.done():
                self.reply(503, {"ok": False, "error": "Stockfish stopped. Next analysis will restart it."})
            else:
                self.reply(200, {"ok": True, "engine": "Stockfish 19 Full", "seconds": ANALYSIS_SECONDS})
        else:
            self.reply(404, {"error": "Not found"})

    def do_POST(self):
        if self.path != "/analyze":
            self.reply(404, {"error": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError("Invalid request length")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Expected a JSON object")
            fen = body.get("fen")
            position_from_fen(fen)
            token = issue_request()
            self.reply(200, analyze(fen, token))
        except SupersededRequest:
            self.reply(409, {"error": "Superseded by newer board"})
        except (ValueError, json.JSONDecodeError) as error:
            self.reply(400, {"error": str(error)})
        except Exception as error:
            self.reply(503, {"error": str(error)})

    def log_message(self, _format, *_args):
        pass


def main():
    global ENGINE
    ENGINE = start_engine()
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Full Stockfish 19 ready. Listening at http://127.0.0.1:8765", flush=True)
    print("Leave this terminal open. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        if ENGINE is not None and not ENGINE.returncode.done():
            ENGINE.quit()


if __name__ == "__main__":
    main()
