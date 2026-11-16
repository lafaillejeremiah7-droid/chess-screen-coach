"""Run a paired Stockfish 19 A/B match in parallel on independent CPU cores.

Preserves a full 1.0-second UCI movetime for EACH individual engine move.
Separate engine processes and game states avoid UCI/TT sharing across games.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import time
from pathlib import Path

import chess.engine
from scripts.compare_engines import OPENINGS, play_game


def run_one(baseline_path: str, candidate_path: str,
            opening: str, candidate_white: bool, seconds: float,
            max_plies: int, game_id: int) -> dict:
    start = time.monotonic()
    with chess.engine.SimpleEngine.popen_uci(baseline_path) as baseline:
        with chess.engine.SimpleEngine.popen_uci(candidate_path) as candidate:
            for engine in (baseline, candidate):
                engine.configure({"Threads": 1, "Hash": 16})
            data = play_game(
                baseline, candidate, opening, candidate_white,
                seconds, max_plies, game_id)
            data["baseline_engine"] = baseline.id.get("name", "")
            data["candidate_engine"] = candidate.id.get("name", "")
    data["wall_seconds"] = round(time.monotonic() - start, 2)
    return data


def parallel_match(baseline_path: str, candidate_path: str, games: int = 10,
                   seconds: float = 1.0, max_plies: int = 300,
                   pair_offset: int = 0, workers: int = 4) -> dict:
    if games < 2 or games % 2:
        raise ValueError("Games must be positive, even, and color-paired")
    if seconds <= 0 or max_plies < 2 or pair_offset < 0:
        raise ValueError("Invalid search time, ply cap, or pair offset")
    if not 1 <= workers <= 8:
        raise ValueError("Workers must be between 1 and 8")
    available = os.cpu_count() or 1
    if workers > available:
        raise ValueError(f"Cannot reserve {workers} cores on a {available}-CPU runner")
    if Path(baseline_path).resolve() == Path(candidate_path).resolve():
        raise ValueError("Candidate must be a distinct executable")
    tasks = []
    for pair in range(games // 2):
        pair_id = pair_offset + pair
        opening = OPENINGS[pair_id % len(OPENINGS)]
        for color_index, candidate_white in enumerate((True, False)):
            game_id = 2 * pair_id + color_index
            tasks.append((baseline_path, candidate_path, opening,
                          candidate_white, seconds, max_plies, game_id))
    results = [None] * games
    start = time.monotonic()
    print(f"Running {games} games on {workers} concurrent worker cores "
          f"(detected CPUs: {available}); {seconds:g} seconds per move.", flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as pool:
        future_map = {pool.submit(run_one, *task): i for i, task in enumerate(tasks)}
        for future in concurrent.futures.as_completed(future_map):
            index = future_map[future]
            results[index] = future.result()
            print(f"Game {index + 1}/{games}: {results[index]['status']}", flush=True)
    elapsed = round(time.monotonic() - start, 2)
    baseline_names = {r["baseline_engine"] for r in results}
    candidate_names = {r["candidate_engine"] for r in results}
    if len(baseline_names) != 1 or len(candidate_names) != 1:
        raise RuntimeError("Engine identities changed between workers")
    scored = [r["candidate_points"] for r in results if r["candidate_points"] is not None]
    return {
        "baseline": next(iter(baseline_names)),
        "baseline_path": str(Path(baseline_path).resolve()),
        "candidate": next(iter(candidate_names)),
        "candidate_path": str(Path(candidate_path).resolve()),
        "seconds_per_move": seconds,
        "max_plies_after_opening": max_plies,
        "pair_offset": pair_offset,
        "worker_process_pairs": workers,
        "runner_wall_seconds": elapsed,
        "sum_game_wall_seconds": round(sum(r["wall_seconds"] for r in results), 2),
        "total_games": games,
        "scored_games": len(scored),
        "incomplete_games": games - len(scored),
        "candidate_wins": sum(x == 1.0 for x in scored),
        "draws": sum(x == 0.5 for x in scored),
        "baseline_wins": sum(x == 0.0 for x in scored),
        "candidate_score_fraction": (round(sum(scored) / len(scored), 5)
                                     if scored else None),
        "limitations": (
            "All completed matches receive the same 1-second UCI movetime per move. "
            "Concurrent CPU contention can change nodes searched. "
            "Small/reused opening sample is not a statistically conclusive Elo test. "
            "Max-ply unfinished games are excluded, not counted as draws."
        ),
        "games": results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--games", type=int, default=10)
    parser.add_argument("--seconds", type=float, default=1.0)
    parser.add_argument("--max-plies", type=int, default=300)
    parser.add_argument("--pair-offset", type=int, default=0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--output", type=Path, default=Path("parallel_match.json"))
    args = parser.parse_args()
    report = parallel_match(
        args.baseline, args.candidate, args.games, args.seconds,
        args.max_plies, args.pair_offset, args.workers)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("SUMMARY", json.dumps({k: v for k, v in report.items() if k != "games"}), flush=True)


if __name__ == "__main__":
    main()
