"""Unit checks for independent parallel game scheduling and accounting."""
from __future__ import annotations

import os
import time
import unittest
from unittest.mock import patch

from scripts.parallel_sf19_match import parallel_match


def fake_game(_baseline, _candidate, opening, candidate_white, seconds,
              max_plies, game_id):
    assert seconds == 1.0
    assert max_plies == 300
    return {
        "baseline_engine": "Stockfish 19",
        "candidate_engine": "Stockfish 19",
        "opening_fen": opening,
        "candidate_color": "white" if candidate_white else "black",
        "candidate_points": 0.5,
        "status": "draw",
        "played_plies": 25,
        "wall_seconds": 0.01,
        "game_id": game_id,
    }


class ParallelMatchTests(unittest.TestCase):
    def test_four_concurrent_games_create_five_color_swapped_pairs(self):
        with patch("scripts.parallel_sf19_match.run_one", side_effect=fake_game), \
             patch("scripts.parallel_sf19_match.os.cpu_count", return_value=4):
            report = parallel_match("baseline", "candidate", games=10, seconds=1,
                                    max_plies=300, pair_offset=15, workers=4)
        self.assertEqual(report["total_games"], 10)
        self.assertEqual(report["scored_games"], 10)
        self.assertEqual(report["draws"], 10)
        self.assertEqual(report["candidate_score_fraction"], 0.5)
        self.assertEqual([r["game_id"] for r in report["games"]], list(range(30, 40)))
        for i in range(0, 10, 2):
            self.assertEqual(report["games"][i]["opening_fen"],
                             report["games"][i + 1]["opening_fen"])
            self.assertEqual(report["games"][i]["candidate_color"], "white")
            self.assertEqual(report["games"][i + 1]["candidate_color"], "black")

    def test_reject_oversubscribed_runner(self):
        with patch("scripts.parallel_sf19_match.os.cpu_count", return_value=2):
            with self.assertRaisesRegex(ValueError, "Cannot reserve"):
                parallel_match("baseline", "candidate", workers=4)

    def test_reject_same_executable(self):
        with patch("scripts.parallel_sf19_match.os.cpu_count", return_value=4):
            with self.assertRaisesRegex(ValueError, "distinct executable"):
                parallel_match("same", "same", workers=4)

    def test_reject_unpaired_games(self):
        with self.assertRaisesRegex(ValueError, "color-paired"):
            parallel_match("a", "b", games=5)


if __name__ == "__main__":
    unittest.main()
