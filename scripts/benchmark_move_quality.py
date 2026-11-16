"""Reproducible Stockfish move-quality sample. No screenshots, account data or live games.

Compare a quick move with longer analysis, evaluate the quick move separately
at that longer budget, and report centipawn differences. Not an Elo estimate.
"""
from __future__ import annotations

import argparse
import json
import random
import statistics
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import chess
import chess.engine
import server

OPENINGS = [
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d3 d6 O-O O-O Re1 a6",
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O",
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Be3 e5 Nb3 Be6",
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5 Ng3 Bg6 h4 h6 Nf3 Nd7",
    "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7 e5 Nfd7 Bxe7 Qxe7",
    "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7 e3 O-O Nf3 h6 Bh4 b6",
    "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6 Nf3 O-O Be2 e5 O-O Nc6",
    "c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Nb6 Nf3 Nc6",
    "e4 d5 exd5 Qxd5 Nc3 Qa5 d4 c6 Nf3 Nf6 Bc4 Bf5",
    "d4 Nf6 Nf3 d5 Bf4 e6 e3 Bd6 Bg3 O-O Bd3 c5",
    "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5 Nxc6 bxc6 Bd3",
    "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7",
    "e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4",
    "e4 e5 f4 exf4 Nf3 g5 h4 g4 Ne5 Nf6 Bc4 d5",
    "d4 Nf6 c4 e6 Nc3 Bb4 e3 O-O Bd3 d5 Nf3 c5",
]


def build_positions(count: int = 110, seed: int = 20261116):
    if count < 100:
        raise ValueError("Provide at least 100 positions for the full audit.")
    rng = random.Random(seed)
    targets = {"opening": 40, "middlegame": 40, "endgame": count-80}
    positions = []
    seen = set()

    def add(name, board):
        fen = board.fen()
        if board.is_valid() and not board.is_game_over() and fen not in seen:
            seen.add(fen)
            positions.append((name, board.copy(stack=False)))
            return True
        return False

    for line in OPENINGS:
        board = chess.Board()
        for ply, san in enumerate(line.split(), start=1):
            board.push_san(san)
            if ply >= 6 and len([x for x in positions if x[0]=="opening"]) < targets["opening"]:
                add("opening", board)
    if sum(category=="opening" for category,_ in positions) < targets["opening"]:
        raise RuntimeError("Insufficient distinct opening positions")

    mid_count = 0
    for attempt in range(10000):
        if mid_count >= targets["middlegame"]:
            break
        board = chess.Board()
        for _ in range(rng.randint(22, 57)):
            if board.is_game_over():
                break
            board.push(rng.choice(list(board.legal_moves)))
        pieces = len(board.piece_map())
        if 12 <= pieces <= 30 and board.fullmove_number >= 12:
            mid_count += int(add("middlegame", board))
    if mid_count < targets["middlegame"]:
        raise RuntimeError(f"Only {mid_count} middlegame positions generated")

    end_count = 0
    for attempt in range(20000):
        if end_count >= targets["endgame"]:
            break
        board = chess.Board(None)
        occupied = set()
        for piece_type, color in ((chess.KING, chess.WHITE), (chess.KING, chess.BLACK)):
            sq = rng.choice([square for square in chess.SQUARES if square not in occupied])
            board.set_piece_at(sq, chess.Piece(piece_type,color))
            occupied.add(sq)
        extras = rng.sample([
            (chess.ROOK,chess.WHITE), (chess.ROOK,chess.BLACK),
            (chess.PAWN,chess.WHITE), (chess.PAWN,chess.BLACK),
            (chess.KNIGHT,chess.WHITE), (chess.BISHOP,chess.BLACK)
        ],rng.randint(2,4))
        for piece_type,color in extras:
            choices=[square for square in chess.SQUARES if square not in occupied and
                     (piece_type!=chess.PAWN or chess.square_rank(square) not in (0,7))]
            sq=rng.choice(choices)
            board.set_piece_at(sq,chess.Piece(piece_type,color))
            occupied.add(sq)
        board.turn=rng.choice((chess.WHITE,chess.BLACK))
        board.castling_rights=0
        board.fullmove_number=50
        if add("endgame",board):
            end_count += 1
    if end_count < targets["endgame"]:
        raise RuntimeError(f"Only {end_count} endgame positions generated")
    assert len(positions) == count, (len(positions),count)
    return positions


def run_benchmark(count=110, quick=0.2, reference=0.9):
    positions=build_positions(count)
    results=[]
    engine=chess.engine.SimpleEngine.popen_uci(server.stockfish_location())
    engine.configure({"Threads":1,"Hash":16})
    start=time.monotonic()
    try:
        print("ENGINE",engine.id,flush=True)
        for i,(category,board) in enumerate(positions,1):
            candidate=engine.play(board,chess.engine.Limit(time=quick),info=chess.engine.INFO_ALL)
            move=candidate.move
            comparison=engine.analyse(board,chess.engine.Limit(time=reference),info=chess.engine.INFO_ALL)
            ref_move=comparison["pv"][0]
            forced=engine.analyse(
                board,chess.engine.Limit(time=reference),
                root_moves=[move],info=chess.engine.INFO_ALL
            )
            ref_score=comparison["score"].pov(board.turn)
            move_score=forced["score"].pov(board.turn)
            cp_loss=None
            if not ref_score.is_mate() and not move_score.is_mate():
                # Capped to make individual noisy evaluations less dominant.
                cp_loss=min(500,max(0,ref_score.score()-move_score.score()))
            item={
                "index":i,"category":category,"fen":board.fen(),
                "quick_uci":move.uci(),"reference_uci":ref_move.uci(),
                "same_move":move==ref_move,
                "quick_depth":candidate.info.get("depth"),
                "reference_depth":comparison.get("depth"),
                "centipawn_loss_estimate":cp_loss,
                "mate_score_excluded":cp_loss is None,
            }
            results.append(item)
            if i%10==0:
                print("PROGRESS",i,"of",count,flush=True)
    finally:
        engine.quit()
    losses=[v["centipawn_loss_estimate"] for v in results
            if v["centipawn_loss_estimate"] is not None]
    report={
        "method":"Fast Stockfish move versus longer same-engine search; forced-move rescoring",
        "engine":engine.id.get("name"),"hardware":"GitHub Actions Linux runner",
        "quick_seconds":quick,"reference_seconds":reference,
        "samples":len(results),
        "categories":{k:sum(x["category"]==k for x in results)
                      for k in ("opening","middlegame","endgame")},
        "move_agreement":sum(x["same_move"] for x in results),
        "evaluated_nonmate":len(losses),
        "excluded_mate":count-len(losses),
        "estimated_mean_cp_loss":round(statistics.mean(losses),2) if losses else None,
        "estimated_median_cp_loss":round(statistics.median(losses),2) if losses else None,
        "estimated_loss_gt50":sum(v>50 for v in losses),
        "duration_seconds":round(time.monotonic()-start,2),
        "positions":results,
        "limitations":"Single seed and runner; short reference not ground truth. No Elo or win-rate inference."
    }
    print("SUMMARY",json.dumps({k:v for k,v in report.items() if k!="positions"}),flush=True)
    return report


if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--samples",type=int,default=110)
    p.add_argument("--reference-seconds",type=float,default=0.9)
    p.add_argument("--output",default="move_quality_report.json")
    args=p.parse_args()
    report=run_benchmark(args.samples,reference=args.reference_seconds)
    Path(args.output).write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
