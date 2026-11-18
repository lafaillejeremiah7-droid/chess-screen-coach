"""Minimal terminal-hosted Stockfish 19 analysis service. Full UCI strength."""
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
PIECES = {"p": "pawn", "n": "knight", "b": "bishop",
          "r": "rook", "q": "queen", "k": "king"}


def start_engine():
    if not ENGINE_PATH.is_file():
        raise RuntimeError("Stockfish 19 missing. Run bash start.sh")
    engine = chess.engine.SimpleEngine.popen_uci(str(ENGINE_PATH))
    if not engine.id.get("name", "").startswith("Stockfish 19"):
        engine.quit()
        raise RuntimeError("Expected full native Stockfish 19")
    engine.configure({"Threads": 1, "Hash": 16, "UCI_LimitStrength": False})
    return engine


def analyze(fen: str):
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
    with ENGINE_LOCK:
        result = ENGINE.play(board, chess.engine.Limit(time=ANALYSIS_SECONDS))
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
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
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
            self.reply(200, analyze(body.get("fen")))
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
        ENGINE.quit()


if __name__ == "__main__":
    main()
