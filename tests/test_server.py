"""Unit checks for move wording and legal position tracking."""
import unittest
import chess
from server import format_instruction, advance_position


class ChessCoachTests(unittest.TestCase):
    def test_plain_move_instruction(self):
        board = chess.Board()
        move = chess.Move.from_uci("g1f3")
        self.assertEqual(format_instruction(board, move), "Move knight from g1 to f3")

    def test_pawn_move_instruction(self):
        board = chess.Board()
        move = chess.Move.from_uci("e2e4")
        self.assertEqual(format_instruction(board, move), "Move pawn from e2 to e4")

    def test_track_one_legal_move(self):
        start = chess.Board()
        next_board = start.copy()
        next_board.push_uci("e2e4")
        tracked = advance_position(start.fen(), next_board.board_fen())
        self.assertTrue(tracked["changed"])
        self.assertEqual(tracked["fen"], next_board.fen())

    def test_reject_skipped_moves(self):
        start = chess.Board()
        after = start.copy()
        after.push_uci("e2e4")
        after.push_uci("e7e5")
        with self.assertRaises(ValueError):
            advance_position(start.fen(), after.board_fen())

    def test_reject_illegal_move_instruction(self):
        board = chess.Board()
        with self.assertRaises(ValueError):
            format_instruction(board, chess.Move.from_uci("g1e2"))


if __name__ == "__main__":
    unittest.main()
