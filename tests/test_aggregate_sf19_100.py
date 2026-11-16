"""Check paired opening sharding and strict 100-game aggregation."""
import json
import tempfile
import unittest
from pathlib import Path

from scripts.compare_engines import run_match
from scripts.aggregate_sf19_100 import aggregate


class AggregateTests(unittest.TestCase):
    def test_exact_shards(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            for shard in range(10):
                report = {
                    "baseline": "Stockfish 19", "candidate": "Stockfish 19",
                    "total_games": 10, "scored_games": 10,
                    "incomplete_games": 0, "candidate_wins": 1,
                    "draws": 8, "baseline_wins": 1,
                    "pair_offset": shard * 5, "seconds_per_move": 1,
                    "max_plies_after_opening": 300,
                    "games": [{"status": "draw"} for _ in range(10)],
                }
                (directory / f"shard-{shard}.json").write_text(json.dumps(report))
            summary = aggregate(directory)
            self.assertEqual(summary["total_games"], 100)
            self.assertEqual(summary["paired_openings"], 50)
            self.assertEqual(summary["candidate_score_fraction"], 0.5)
            (directory / "shard-0.json").unlink()
            with self.assertRaisesRegex(ValueError, "Expected 10"):
                aggregate(directory)


if __name__ == "__main__":
    unittest.main()
