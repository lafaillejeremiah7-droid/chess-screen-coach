"""Deterministic chess exercises and Stockfish move-comparison API.

The browser handles adaptive scheduling and spaced repetition. This module only
supplies reproducible legal positions and validates/scorers independent moves.
"""
from __future__ import annotations

import random
import threading

import chess
import chess.engine

OPENINGS = (
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7",
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6 f3 Be7 Qd2 O-O O-O-O Nbd7",
    "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7",
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6 d5 Ne7 Ne1 Nd7",
    "e4 e6 d4 d5 Nc3 Nf6 e5 Nfd7 f4 c5 Nf3 Nc6 Be3 Qb6 Na4 Qa5+ c3 c4",
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7 h5 Bh7 Bd3 Bxd3",
    "d4 d5 c4 c6 Nf3 Nf6 Nc3 dxc4 a4 Bf5 e3 e6 Bxc4 Bb4 O-O O-O Qe2",
    "c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6 O-O Be7 d3 O-O",
    "Nf3 d5 g3 Nf6 Bg2 e6 O-O Be7 d3 O-O Nbd2 c5 e4 Nc6 Re1 b5",
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Bd2 Bxd2+ Nbxd2 d5",
    "d4 Nf6 c4 e6 Nf3 b6 g3 Bb7 Bg2 Be7 O-O O-O Nc3 Ne4 Qc2 Nxc3",
    "e4 e5 Nc3 Nf6 f4 d5 fxe5 Nxe4 Nf3 Bg4 Qe2 Nc6 Nxe4 dxe4 Qxe4",
    "d4 d5 Nf3 Nf6 e3 c5 Bd3 Nc6 O-O e6 b3 Bd6 Bb2 O-O Nbd2 b6",
    "e4 e5 Nf3 d6 d4 Nf6 Nc3 Nbd7 Bc4 Be7 O-O O-O Re1 c6 a4 Qc7",
    "c4 c5 Nc3 Nc6 Nf3 Nf6 g3 g6 Bg2 Bg7 O-O O-O d3 d6 Rb1 a6",
)

ENDGAMES = (
    "8/8/4k3/8/8/8/4K3/4R3 w - - 0 1",
    "8/2k5/8/8/8/5K2/4P3/8 w - - 0 1",
    "8/8/3k4/8/3P4/4K3/8/8 w - - 0 1",
    "8/8/3k4/8/8/4K3/4P3/3R4 w - - 0 1",
    "8/1k6/8/3p4/8/8/4K3/8 w - - 0 1",
    "8/8/8/4k3/8/4K3/2P5/8 w - - 0 1",
    "8/8/5k2/8/8/2K5/3P4/8 w - - 0 1",
    "4k3/8/8/8/8/5K2/4P3/4R3 w - - 0 1",
)


def _theme(board: chess.Board) -> str:
    if board.is_check():
        return "check_evasion"
    if len(board.piece_map()) <= 10:
        return "endgame"
    moves = list(board.legal_moves)
    if any(board.gives_check(move) for move in moves) or sum(
            board.is_capture(move) for move in moves) >= 2:
        return "tactics"
    if board.fullmove_number < 11:
        return "opening"
    return "strategy"


_BANK = None


def position_bank() -> list[dict]:
    """A stable, offline exercise bank; no remote games or user data required."""
    global _BANK
    if _BANK is not None:
        return [dict(item) for item in _BANK]
    seen = set()
    out = []

    def add(board):
        if not board.is_valid() or board.is_game_over():
            return
        fen = board.fen()
        if fen in seen:
            return
        seen.add(fen)
        out.append({"id": f"p{len(out):04d}", "fen": fen,
                    "theme": _theme(board), "turn": "white" if board.turn else "black"})

    for line in OPENINGS:
        board = chess.Board()
        for ply, san in enumerate(line.split()):
            try:
                board.push_san(san)
            except ValueError:
                break
            if ply >= 3:
                add(board)
        # Deterministic continuations create new middlegame samples.
        if board.is_valid() and not board.is_game_over():
            rng = random.Random(sum(ord(c) for c in line))
            for _ in range(14):
                legal = list(board.legal_moves)
                if not legal:
                    break
                move = rng.choice(legal)
                board.push(move)
                add(board)

    for seed in ENDGAMES:
        board = chess.Board(seed)
        if not board.is_valid():
            continue
        add(board)
        rng = random.Random(seed)
        for _ in range(12):
            moves = list(board.legal_moves)
            if not moves or board.is_game_over():
                break
            board.push(rng.choice(moves))
            add(board)

    if len(out) < 100:
        raise RuntimeError("Exercise bank has fewer than 100 valid positions")
    _BANK = out
    return [dict(item) for item in out]


def _cp(info: dict, turn: chess.Color) -> int | None:
    score = info.get("score")
    if score is None:
        return None
    return score.pov(turn).score(mate_score=100000)


def _explain(board: chess.Board, played: chess.Move | None,
             best: chess.Move, loss: int | None) -> str:
    if played is None:
        return "Time expired. Review the best move before the next position."
    if played == best:
        return "Your move matched Stockfish's preferred move at this search budget."
    if board.gives_check(best):
        reason = "Stockfish's move gives check."
    elif board.is_capture(best):
        reason = "Stockfish's move captures material."
    elif best.promotion:
        reason = "Stockfish's move promotes a pawn."
    else:
        reason = "Review the alternative and its resulting position."
    if loss is not None:
        return f"Estimated evaluation difference: {loss} centipawns. {reason}"
    return reason


def evaluate_attempt(fen: str, move: str | None, search,
                     engine_lock: threading.Lock, engine, main_elo: int | None = None) -> dict:
    """Compare candidate moves using the same Stockfish 19 engine, perspective and budget."""
    if not isinstance(fen, str) or len(fen) > 120:
        raise ValueError("Invalid FEN")
    try:
        board = chess.Board(fen)
    except ValueError as exc:
        raise ValueError("Invalid FEN") from exc
    if not board.is_valid() or board.is_game_over():
        raise ValueError("Training position is invalid or finished")
    if move is not None and (not isinstance(move, str) or len(move) not in (4, 5)):
        raise ValueError("Use a legal UCI move, such as e2e4")
    played = None
    if move is not None:
        try:
            played = chess.Move.from_uci(move)
        except ValueError as exc:
            raise ValueError("Invalid move notation") from exc
        if played not in board.legal_moves:
            raise ValueError("Move is illegal in this position")
    if engine is None:
        raise RuntimeError("Stockfish unavailable")
    if not engine_lock.acquire(blocking=False):
        raise RuntimeError("Engine busy; retry this position")
    try:
        # Training scores must use unrestricted engine search, not the main
        # coach's intentionally weakened 1400 UCI Elo configuration.
        if main_elo is not None:
            engine.configure({"UCI_LimitStrength": False})
        best_info = search(board, 1.0)
        pv = best_info.get("pv") or []
        if not pv or pv[0] not in board.legal_moves:
            raise RuntimeError("Stockfish returned no legal principal variation")
        best = pv[0]
        top_cp = _cp(best_info, board.turn)
        own_cp = top_cp if played == best else None
        if played is not None and played != best:
            own_info = search(board, 1.0, root_moves=[played])
            own_cp = _cp(own_info, board.turn)
        loss = max(0, top_cp - own_cp) if top_cp is not None and own_cp is not None else None
        return {"best": best.uci(), "best_san": board.san(best),
                "played": played.uci() if played is not None else None,
                "played_san": board.san(played) if played is not None else None,
                "centipawn_loss": loss, "best_eval_cp": top_cp,
                "played_eval_cp": own_cp,
                "matched_best": played == best,
                "explanation": _explain(board, played, best, loss)}
    finally:
        try:
            if main_elo is not None:
                engine.configure({"UCI_LimitStrength": True, "UCI_Elo": main_elo})
        finally:
            engine_lock.release()
