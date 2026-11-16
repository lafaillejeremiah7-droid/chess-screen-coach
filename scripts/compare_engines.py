"""Run controlled, paired-opening games between two UCI chess engines.

This tests one-second decision-making with colors swapped, equal time and
identical hardware. Never interpret a tiny match or incomplete games as Elo.
"""
from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

import chess
import chess.engine

OPENINGS = (
    "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6",
    "d4 d5 c4 e6 Nc3 Nf6 Nf3 Be7",
    "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6",
    "e4 e6 d4 d5 Nc3 Nf6",
    "c4 e5 Nc3 Nf6 g3 d5",
    "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5",
    "d4 Nf6 c4 g6 Nc3 Bg7",
    "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6",
)


def opening_board(san_line: str) -> chess.Board:
    board = chess.Board()
    for san in san_line.split():
        board.push_san(san)
    return board


def play_game(baseline: chess.engine.SimpleEngine,
              candidate: chess.engine.SimpleEngine, opening: str,
              candidate_white: bool, seconds: float, max_plies: int,
              game_id: int) -> dict:
    board = opening_board(opening)
    opening_fen = board.fen()
    played = 0
    while not board.is_game_over(claim_draw=True) and played < max_plies:
        candidate_to_play = board.turn == candidate_white
        engine = candidate if candidate_to_play else baseline
        result = engine.play(board, chess.engine.Limit(time=seconds),
                             ponder=False, game=game_id)
        if result.move not in board.legal_moves:
            raise RuntimeError("UCI engine returned an illegal move")
        board.push(result.move)
        played += 1
    outcome = board.outcome(claim_draw=True)
    if outcome is None:
        status, points = "incomplete", None
    elif outcome.winner is None:
        status, points = "draw", 0.5
    elif outcome.winner == candidate_white:
        status, points = "candidate_win", 1.0
    else:
        status, points = "baseline_win", 0.0
    return {
        "opening_fen": opening_fen,
        "candidate_color": "white" if candidate_white else "black",
        "candidate_points": points,
        "status": status,
        "played_plies": played,
        "final_fen": board.fen(),
    }


def run_match(baseline_path: str, candidate_path: str, games: int,
              seconds: float, max_plies: int, seed: int) -> dict:
    if games < 2 or games % 2:
        raise ValueError("Games must be a positive even number (paired colors)")
    if seconds <= 0 or max_plies < 2:
        raise ValueError("Time and maximum plies must be positive")
    if Path(baseline_path).resolve() == Path(candidate_path).resolve():
        print("WARNING: Candidate and baseline paths are identical; this is only a pipeline smoke test.")
    rng = random.Random(seed)
    openings = [OPENINGS[i % len(OPENINGS)] for i in range(games // 2)]
    rng.shuffle(openings)
    records = []
    with chess.engine.SimpleEngine.popen_uci(baseline_path) as baseline:
        with chess.engine.SimpleEngine.popen_uci(candidate_path) as candidate:
            for engine in (baseline, candidate):
                engine.configure({"Threads": 1, "Hash": 16})
            baseline_name = baseline.id.get("name")
            candidate_name = candidate.id.get("name")
            for pair, opening in enumerate(openings):
                for candidate_white in (True, False):
                    item = play_game(baseline, candidate, opening,
                                     candidate_white, seconds, max_plies, pair * 2 + int(not candidate_white))
                    records.append(item)
                    print(f"Game {len(records)}/{games}: {item['status']}", flush=True)
    scored = [x["candidate_points"] for x in records if x["candidate_points"] is not None]
    return {
        "baseline": baseline_name, "baseline_path": str(Path(baseline_path).resolve()),
        "candidate": candidate_name, "candidate_path": str(Path(candidate_path).resolve()),
        "seconds_per_move": seconds, "max_plies_after_opening": max_plies,
        "seed": seed, "total_games": len(records), "scored_games": len(scored),
        "incomplete_games": len(records) - len(scored),
        "candidate_wins": sum(x == 1 for x in scored),
        "draws": sum(x == 0.5 for x in scored),
        "baseline_wins": sum(x == 0 for x in scored),
        "candidate_score_fraction": round(sum(scored) / len(scored), 5) if scored else None,
        "limitations": (
            "Small fixed opening sample; 1 second per move includes engine startup overhead; "
            "game caps may produce unscored games. Score is not Elo or proof of improvement."
        ),
        "games": records,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", default=".stockfish/bin/stockfish")
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--games", type=int, default=20)
    parser.add_argument("--seconds", type=float, default=1.0)
    parser.add_argument("--max-plies", type=int, default=200)
    parser.add_argument("--seed", type=int, default=20261116)
    parser.add_argument("--output", default="engine_ab_report.json")
    args = parser.parse_args()
    report = run_match(args.baseline, args.candidate, args.games,
                       args.seconds, args.max_plies, args.seed)
    Path(args.output).write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("SUMMARY", json.dumps({k: v for k, v in report.items() if k != "games"}))


if __name__ == "__main__":
    main()
