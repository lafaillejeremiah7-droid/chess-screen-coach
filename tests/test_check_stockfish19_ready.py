"""Version-guard tests that avoid treating an older Stockfish as ready."""
import unittest
from unittest.mock import patch, MagicMock

import chess
import chess.engine
import server
from scripts.check_stockfish19_ready import check_ready


class Stockfish19ReadinessTests(unittest.TestCase):
    def test_exact_stable_release_identity(self):
        self.assertTrue(server.is_stockfish19_name("Stockfish 19"))
        self.assertTrue(server.is_stockfish19_name("Stockfish 19 by authors"))
        for bad in (None, "", "Stockfish 17.1", "Stockfish 18", "Stockfish 190"):
            with self.subTest(name=bad):
                self.assertFalse(server.is_stockfish19_name(bad))

    def test_preflight_rejects_old_engine(self):
        fake = MagicMock()
        fake.id = {"name": "Stockfish 18"}
        fake.__enter__.return_value = fake
        fake.__exit__.return_value = None
        with patch("scripts.check_stockfish19_ready.chess.engine.SimpleEngine.popen_uci", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "expected Stockfish 19"):
                check_ready("/fake/stockfish18")
        fake.play.assert_not_called()

    def test_preflight_reports_legal_move(self):
        fake = MagicMock()
        fake.id = {"name": "Stockfish 19"}
        fake.__enter__.return_value = fake
        fake.__exit__.return_value = None
        fake.play.return_value = chess.engine.PlayResult(
            chess.Move.from_uci("e2e4"), None, info={"depth": 13, "nodes": 16000})
        with patch("scripts.check_stockfish19_ready.chess.engine.SimpleEngine.popen_uci", return_value=fake):
            result = check_ready("/fake/stockfish19")
        self.assertTrue(result["ready"])
        self.assertEqual(result["engine"], "Stockfish 19")
        self.assertEqual(result["default_seconds"], 1.0)
        self.assertEqual(result["bestmove"], "e2e4")
        self.assertEqual(result["threads"], 1)
        self.assertEqual(result["hash_mib"], 16)
        self.assertEqual(fake.play.call_args.args[1].time, 1.0)


if __name__ == "__main__":
    unittest.main()
