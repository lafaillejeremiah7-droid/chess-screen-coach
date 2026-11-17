"""Local Python chess coach: static screen-sharing UI + Stockfish API.

The browser handles screen capture and piece recognition. Python validates FEN and
uses a locally installed Stockfish engine. The service only listens on loopback.
"""
from __future__ import annotations

import json
import mimetypes
import os
import re
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
CONTROL_LOCK = threading.Lock()
COACH_HIDDEN = False
ACTIVE_ANALYSIS = None  # python-chess SimpleAnalysisResult, stopped on H.
ANALYSIS_SECONDS = 1.0
# Permanent default for move recommendations from the extension/dashboard.
# UCI_Elo is approximate and not equivalent to any online rating.
MAIN_COACH_ELO = 1400
ALLOWED_ANALYSIS_SECONDS = (0.2, 0.5, 1.0, 2.0)
ANALYSIS_CACHE: OrderedDict[str, dict] = OrderedDict()
MAX_CACHED_POSITIONS = 128
MAX_BODY = 8192  # Bounded support for 400-move SAN histories and sparring logs.
PIECE_NAMES = {
    chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop",
    chess.ROOK: "rook", chess.QUEEN: "queen", chess.KING: "king",
}


def is_stockfish19_name(name: str | None) -> bool:
    """Prevent a silent fallback to outdated system Stockfish executables."""
    return isinstance(name, str) and re.match(r"^Stockfish 19(?:\s|$)", name) is not None


def stockfish_location() -> str:
    """Find a Stockfish executable; verify its UCI identity before use."""
    explicit = os.getenv("STOCKFISH_PATH")
    if explicit:
        if Path(explicit).is_file() and os.access(explicit, os.X_OK):
            return explicit
        raise FileNotFoundError(f"STOCKFISH_PATH does not point to an executable: {explicit}")
    candidates = [
        ROOT / ".stockfish" / "bin" / "stockfish",
        shutil.which("stockfish"),
        "/usr/games/stockfish",
        "/usr/bin/stockfish",
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    raise FileNotFoundError(
        "No Stockfish found. Run: python3 scripts/install_stockfish19.py"
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



def describe_move(board: chess.Board, move: chess.Move) -> str:
    """Describe observable move features without inventing chess strategy."""
    if board.is_castling(move):
        return "Castles the king."
    captured = board.piece_at(move.to_square)
    capture = board.is_capture(move)
    next_board = board.copy(stack=False)
    next_board.push(move)
    if next_board.is_checkmate():
        return "Delivers checkmate."
    if move.promotion:
        return f"Promotes a pawn to {PIECE_NAMES[move.promotion]}."
    if next_board.is_check():
        return "Gives check."
    if capture:
        captured_name = PIECE_NAMES[captured.piece_type] if captured else "pawn"
        return f"Captures a {captured_name}."
    return "Stockfish's strength-limited choice at the current search budget."


def search_seconds(value: float | None) -> float:
    if value is None:
        return ANALYSIS_SECONDS
    if type(value) not in (int, float) or float(value) not in ALLOWED_ANALYSIS_SECONDS:
        raise ValueError("Analysis seconds must be 0.2, 0.5, 1 or 2.")
    return float(value)


def configure_main_engine(engine) -> None:
    """Give the *main* recommendation bot a permanent ~1400 UCI-Elo target.

    Stockfish chooses the weakened move in its final UCI bestmove. Reading
    only the top analysis PV bypasses the limit.
    """
    engine.configure({"Threads": 1, "Hash": 16,
                      "UCI_LimitStrength": True, "UCI_Elo": MAIN_COACH_ELO})


def coach_control(hidden: bool | None = None) -> dict:
    """Shared pause state for the extension and the floating-window dashboard."""
    global COACH_HIDDEN
    if hidden is not None:
        if type(hidden) is not bool:
            raise ValueError("hidden must be true or false")
        with CONTROL_LOCK:
            COACH_HIDDEN = hidden
            running = ACTIVE_ANALYSIS if hidden else None
        if running is not None:
            running.stop()  # Stop the active UCI search, not just its UI result.
    with CONTROL_LOCK:
        return {"hidden": COACH_HIDDEN, "engine_running": ACTIVE_ANALYSIS is not None}


def engine_info(board: chess.Board, seconds: float, root_moves=None) -> dict:
    """Search with an externally stoppable handle; caller owns ENGINE_LOCK."""
    global ACTIVE_ANALYSIS
    if ENGINE is None:
        raise RuntimeError("Stockfish is unavailable")
    with CONTROL_LOCK:
        if COACH_HIDDEN:
            raise RuntimeError("Chess coach hidden; analysis paused")
    analysis = ENGINE.analysis(board, chess.engine.Limit(time=seconds),
                               info=chess.engine.INFO_ALL, root_moves=root_moves)
    try:
        with CONTROL_LOCK:
            ACTIVE_ANALYSIS = analysis
            hidden = COACH_HIDDEN
        if hidden:
            analysis.stop()
        with analysis:
            for _ in analysis:
                pass
            # The top PV is NOT necessarily the strength-limited choice.
            # Waiting for UCI bestmove preserves Stockfish's deliberate
            # suboptimal selection and the existing H-key cancellation path.
            selected = analysis.wait()
            result = dict(analysis.info)
            result["selected_move"] = selected.move
    finally:
        with CONTROL_LOCK:
            if ACTIVE_ANALYSIS is analysis:
                ACTIVE_ANALYSIS = None
    with CONTROL_LOCK:
        if COACH_HIDDEN:
            raise RuntimeError("Chess coach hidden; analysis canceled")
    return result


def analyze_fen(fen: str, seconds: float | None = None) -> dict:
    # H suspends analysis even when an earlier answer is already cached.
    with CONTROL_LOCK:
        if COACH_HIDDEN:
            raise RuntimeError("Chess coach hidden; analysis paused")
    seconds = search_seconds(seconds)
    if not isinstance(fen, str) or len(fen) > 120:
        raise ValueError("Invalid FEN")
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise ValueError(f"Invalid position: {exc}") from exc
    if not board.is_valid():
        raise ValueError("Invalid board position; check the recognized pieces and side to move")
    if board.is_game_over():
        return {"instruction": "Game over", "from": None, "to": None, "fen": board.fen(), "seconds": seconds, "reason": "Game finished."}
    if ENGINE is None:
        raise RuntimeError("Stockfish is unavailable. Install stockfish and restart Python server.")
    # Do not accumulate searches from multiple tabs on a small Chromebook.
    if not ENGINE_LOCK.acquire(blocking=False):
        raise RuntimeError("Engine busy. Keep one coach tab open and try again.")
    try:
        key = (board.fen(), seconds)
        if key in ANALYSIS_CACHE:
            ANALYSIS_CACHE.move_to_end(key)
            return dict(ANALYSIS_CACHE[key])
        info = engine_info(board, seconds)
        # Use the actual UCI bestmove selected under UCI_LimitStrength,
        # never the full-strength top principal variation.
        move = info.get("selected_move")
        if move is None:
            raise RuntimeError("Stockfish did not return a legal move")
        # The analysis PV may describe a stronger move than Stockfish's
        # deliberately limited bestmove. Never attribute that PV score to a
        # different selected move.
        score = info.get("score")
        pv = info.get("pv") or []
        pov_score = score.pov(board.turn) if score is not None and pv and pv[0] == move else None
        answer = {
            "instruction": format_instruction(board, move),
            "from": chess.square_name(move.from_square),
            "to": chess.square_name(move.to_square),
            "fen": board.fen(),
            "seconds": seconds,
            "reason": describe_move(board, move),
            "depth": info.get("depth") if isinstance(info.get("depth"), int) else None,
            "nodes": info.get("nodes") if isinstance(info.get("nodes"), int) else None,
            "score_cp": pov_score.score() if pov_score is not None else None,
            "mate_in": pov_score.mate() if pov_score is not None else None,
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



def recover_from_history(moves: list, placement: str) -> dict:
    """Replay a complete SAN/UCI move list and verify against the observed board."""
    if not isinstance(moves, list) or not 1 <= len(moves) <= 400 or any(
        not isinstance(item, str) or len(item) > 14 for item in moves
    ):
        raise ValueError("Valid complete move history required")
    if not isinstance(placement, str) or len(placement) > 90:
        raise ValueError("Valid board placement required")
    board = chess.Board()
    try:
        for item in moves:
            token = item.strip()
            if not token:
                raise ValueError("Empty history move")
            try:
                board.push_san(token)
            except ValueError:
                board.push_uci(token)
        target = chess.BaseBoard(placement)
    except (ValueError, AssertionError) as exc:
        raise ValueError("History contains an illegal or malformed move") from exc
    if placement_key(board) != placement_key(target):
        raise ValueError("Move history does not match the observed board")
    return {"fen": board.fen(), "recovered_moves": len(moves)}


class Handler(BaseHTTPRequestHandler):
    def local_request_allowed(self) -> bool:
        """Reject browser-origin CSRF and DNS-rebinding requests on loopback."""
        host=(self.headers.get("Host") or "").strip().lower()
        allowed_hosts={f"127.0.0.1:{self.server.server_port}",
                       f"localhost:{self.server.server_port}",
                       "127.0.0.1", "localhost"}
        if host not in allowed_hosts:
            return False
        origin=self.headers.get("Origin")
        if origin is None:
            return True  # local tools and direct requests without Origin
        if origin in {f"http://127.0.0.1:{self.server.server_port}",
                      f"http://localhost:{self.server.server_port}"}:
            return True
        # Chrome's extension background service worker contacts loopback.
        return re.fullmatch(r"chrome-extension://[a-p]{32}",origin) is not None

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
        if not self.local_request_allowed():
            return self.respond_json(403, {"error":"Cross-origin local API request denied"})
        endpoint = urlparse(self.path).path
        if endpoint not in ("/api/analyze", "/api/track", "/api/recover", "/api/control", "/api/training/evaluate", "/api/sparring/turn"):
            return self.respond_json(404, {"error": "Unknown API endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 2 or length > MAX_BODY:
                return self.respond_json(413, {"error": "Invalid request size"})
            data = json.loads(self.rfile.read(length))
            if not isinstance(data, dict):
                raise ValueError("Expected JSON object")
            if endpoint == "/api/control":
                result = coach_control(data.get("hidden"))
            elif endpoint == "/api/track":
                result = advance_position(data.get("previous"), data.get("placement"))
            elif endpoint == "/api/recover":
                result = recover_from_history(data.get("moves"), data.get("placement"))
            elif endpoint == "/api/training/evaluate":
                from training import evaluate_attempt
                result = evaluate_attempt(data.get("fen"), data.get("move"), engine_info,
                                          ENGINE_LOCK, ENGINE, main_elo=MAIN_COACH_ELO)
            elif endpoint == "/api/sparring/turn":
                from sparring import play_practice_turn
                result = play_practice_turn(data.get("fen"), data.get("move"), data.get("elo"),
                                            moves=data.get("moves"))
            else:
                result = analyze_fen(data.get("fen"), data.get("seconds"))
            self.respond_json(200, result)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            self.respond_json(400, {"error": str(exc)})
        except Exception as exc:
            self.respond_json(503, {"error": str(exc)})

    def do_GET(self) -> None:
        if not self.local_request_allowed():
            return self.respond_json(403, {"error":"Cross-origin local API request denied"})
        path = unquote(urlparse(self.path).path)
        if path == "/api/control":
            return self.respond_json(200, coach_control())
        if path == "/api/sparring/start":
            from sparring import initial_position
            return self.respond_json(200, initial_position())
        if path == "/api/training/positions":
            from training import position_bank
            return self.respond_json(200, {"positions": position_bank()})
        if path == "/api/health":
            return self.respond_json(200, {"python": True, "stockfish": ENGINE is not None,
                                           "stockfish19": ENGINE is not None and is_stockfish19_name(ENGINE.id.get("name")),
                                           "engine": ENGINE.id.get("name") if ENGINE is not None else None,
                                           "default_seconds": ANALYSIS_SECONDS,
                                           "default_elo": MAIN_COACH_ELO,
                                           "strength_limited": ENGINE is not None,
                                           "times": ALLOWED_ANALYSIS_SECONDS})
        if path == "/":
            path = "/index.html"
        if path == "/templates/pieces.json":
            path = "/public/templates/pieces.json"
        # Only serve the specific files needed by the local browser interface.
        permitted = (
            path in ("/index.html", "/training.html", "/sparring.html", "/src/training.js", "/src/sparring.js", "/src/app.js", "/src/recognition.js", "/src/style.css")
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
        engine_path = stockfish_location()
        ENGINE = chess.engine.SimpleEngine.popen_uci(engine_path)
        name = ENGINE.id.get("name")
        if not is_stockfish19_name(name):
            raise RuntimeError(
                f"Expected Stockfish 19, found {name!r} at {engine_path}. "
                "Run: python3 scripts/install_stockfish19.py"
            )
        configure_main_engine(ENGINE)
        print(f"Stockfish 19 ready: {engine_path}; 1 thread, 16 MiB hash; "
              f"main coach targets {MAIN_COACH_ELO} UCI Elo; default 1-second search.")
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
