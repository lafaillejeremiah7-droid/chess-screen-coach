"""Local, isolated human-vs-limited-Stockfish practice opponent.

Only accepts a human White move and returns the Black opponent's reply.
Does not change the main Stockfish analysis engine or connect to chess websites.
"""
from __future__ import annotations

import re
import threading

import chess
import chess.engine

PRACTICE_LOCK = threading.Lock()
MIN_ELO = 1320
MAX_ELO = 3190
SEARCH_SECONDS = 1.0


def board_state(board: chess.Board, human_san=None, engine_san=None) -> dict:
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        status = "Your move." if board.turn == chess.WHITE else "Engine to move."
    elif outcome.winner is None:
        status = "Draw: " + outcome.termination.name.replace("_", " ").lower() + "."
    else:
        status = ("White" if outcome.winner == chess.WHITE else "Black") + " wins: " + outcome.termination.name.replace("_", " ").lower() + "."
    return {
        "fen": board.fen(),
        "legal_moves": [move.uci() for move in board.legal_moves] if board.turn == chess.WHITE and outcome is None else [],
        "finished": outcome is not None,
        "status": status,
        "human_san": human_san,
        "engine_san": engine_san,
        "human_uci": None,
        "engine_uci": None,
    }


def initial_position() -> dict:
    return board_state(chess.Board())


def play_practice_turn(fen, move_uci, elo, engine_path=None, engine_factory=None,
                       moves=None) -> dict:
    """Play White's legal move, then ask a dedicated strength-limited engine for Black's reply.

    The engine is a new process so no strength setting can leak into the main
    application's full-strength analysis engine.
    """
    if type(elo) is not int or not MIN_ELO <= elo <= MAX_ELO:
        raise ValueError(f"Practice Elo must be an integer from {MIN_ELO} to {MAX_ELO}")
    if not isinstance(fen, str) or len(fen) > 120:
        raise ValueError("Invalid starting position")
    if not isinstance(move_uci, str) or len(move_uci) not in (4, 5):
        raise ValueError("Move must be a UCI string such as e2e4")
    try:
        board = chess.Board(fen)
        move = chess.Move.from_uci(move_uci)
        if moves is not None:
            if not isinstance(moves, list) or len(moves) > 400 or any(
                not isinstance(item, str) or len(item) not in (4, 5) for item in moves
            ):
                raise ValueError("Invalid practice history")
            replay = chess.Board()
            for item in moves:
                replay.push_uci(item)
            if replay.fen() != board.fen():
                raise ValueError("Practice history does not match board")
            board = replay
    except ValueError as exc:
        raise ValueError(f"Invalid board, move, or practice history: {exc}") from exc
    if not board.is_valid() or board.turn != chess.WHITE or board.is_game_over(claim_draw=True):
        raise ValueError("Expected an unfinished position with White to play")
    if board.fullmove_number > 200:
        raise ValueError("Practice game exceeds 200 full moves")
    if move not in board.legal_moves:
        raise ValueError("Illegal White move")
    human_san = board.san(move)
    board.push(move)
    if board.is_game_over(claim_draw=True):
        state = board_state(board, human_san, None)
        state["human_uci"] = move.uci()
        return state

    if not PRACTICE_LOCK.acquire(blocking=False):
        raise RuntimeError("Practice engine busy; retry the move")
    try:
        # Resolve executable lazily. A custom factory is used only by unit tests.
        if engine_path is None:
            from server import stockfish_location
            engine_path = stockfish_location()
        if engine_factory is None:
            engine_factory = chess.engine.SimpleEngine.popen_uci
        engine = engine_factory(engine_path)
        try:
            name = engine.id.get("name")
            if not isinstance(name, str) or not re.match(r"^Stockfish 19(?:\s|$)", name):
                raise RuntimeError("Practice requires Stockfish 19")
            engine.configure({
                "Threads": 1,
                "Hash": 16,
                "UCI_LimitStrength": True,
                "UCI_Elo": elo,
            })
            result = engine.play(board, chess.engine.Limit(time=SEARCH_SECONDS), ponder=False)
        finally:
            engine.quit()
        if result.move is None or result.move not in board.legal_moves:
            raise RuntimeError("Practice engine did not return a legal move")
        engine_san = board.san(result.move)
        board.push(result.move)
        state = board_state(board, human_san, engine_san)
        state["human_uci"] = move.uci()
        state["engine_uci"] = result.move.uci()
        return state
    finally:
        PRACTICE_LOCK.release()
