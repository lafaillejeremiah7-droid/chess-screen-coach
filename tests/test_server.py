import unittest
from unittest.mock import patch
import chess
import server


class FakeEngine:
    def play(self, board, limit):
        self.board = board
        return type("Result", (), {"move": chess.Move.from_uci("e2e4")})()


class ServerTests(unittest.TestCase):
    def test_full_strength_move_is_legal(self):
        fake = FakeEngine()
        with patch.object(server, "ENGINE", fake):
            result = server.analyze(chess.STARTING_FEN)
        self.assertEqual(result["instruction"], "Move pawn from e2 to e4")
        self.assertEqual(result["uci"], "e2e4")
        self.assertEqual(result["engine"], "Stockfish 19 Full")

    def test_rejects_invalid_position(self):
        with self.assertRaises(ValueError):
            server.analyze("not a FEN")
        with self.assertRaises(ValueError):
            server.analyze("8/8/8/8/8/8/8/8 w - - 0 1")


if __name__ == "__main__":
    unittest.main()
