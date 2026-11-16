"""Combine exactly 100 games from 10 five-pair sharded GitHub Actions matches."""
from __future__ import annotations

import argparse
import json
from pathlib import Path


def aggregate(directory: Path) -> dict:
    files = sorted(directory.glob("shard-*.json"))
    if len(files) != 10:
        raise ValueError(f"Expected 10 completed shard reports, found {len(files)}")
    reports = [json.loads(file.read_text(encoding="utf-8")) for file in files]
    offsets = sorted(report.get("pair_offset") for report in reports)
    if offsets != list(range(0, 50, 5)):
        raise ValueError(f"Unexpected pair offsets: {offsets}")
    if any(r["total_games"] != 10 or len(r["games"]) != 10 or
           r["seconds_per_move"] != 1 or r["max_plies_after_opening"] != 300
           for r in reports):
        raise ValueError("Shard settings do not match the requested 100-game, 1-second, 300-ply match")
    if len({r["baseline"] for r in reports}) != 1 or len({r["candidate"] for r in reports}) != 1:
        raise ValueError("Different engine identities across match shards")
    totals = {key: sum(r[key] for r in reports) for key in (
        "total_games", "scored_games", "incomplete_games",
        "candidate_wins", "draws", "baseline_wins")}
    if totals["total_games"] != 100 or totals["scored_games"] + totals["incomplete_games"] != 100:
        raise ValueError("Incomplete or inconsistent game accounting")
    total_points = totals["candidate_wins"] + 0.5 * totals["draws"]
    return {
        "baseline": reports[0]["baseline"],
        "candidate": reports[0]["candidate"],
        "seconds_per_move": 1,
        "max_plies_after_opening": 300,
        "paired_openings": 50,
        "shards": 10,
        **totals,
        "candidate_score_fraction": (round(total_points / totals["scored_games"], 5)
                                     if totals["scored_games"] else None),
        "interpretation": (
            "Unfinished games are excluded from the score, not counted as draws. "
            "A 100-game sample with repeated openings is exploratory, not proof of greater Elo. "
            "A fuller strength test requires more opening variety and a statistically powered match."
        ),
        "games": [
            {**game, "pair_index": r["pair_offset"] + i // 2}
            for r in reports for i, game in enumerate(r["games"])
        ],
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("reports"))
    parser.add_argument("--output", type=Path, default=Path("sf19_100_summary.json"))
    args = parser.parse_args()
    report = aggregate(args.directory)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("100-GAME SUMMARY", json.dumps({k: v for k, v in report.items() if k != "games"}))
