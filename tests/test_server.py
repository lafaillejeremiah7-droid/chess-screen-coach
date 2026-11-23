from concurrent.futures import Future
import threading
import unittest
from unittest.mock import patch
import chess
import server


class FakeEngine:
    def __init__(self):
        self.calls = 0
        self.returncode = Future()

    def play(self, board, limit):
        self.calls += 1
        return type("Result", (), {"move": chess.Move.from_uci("e2e4")})()


class BlockingEngine(FakeEngine):
    def __init__(self):
        super().__init__()
        self.started = threading.Event()
        self.release = threading.Event()

    def play(self, board, limit):
        self.started.set()
        if not self.release.wait(timeout=4):
            raise RuntimeError("Test search never resumed")
        return super().play(board, limit)


class ServerTests(unittest.TestCase):
    def test_full_strength_move_is_legal(self):
        fake = FakeEngine()
        with patch.object(server, "ENGINE", fake):
            result = server.analyze(chess.STARTING_FEN)
        self.assertEqual(result["instruction"], "Move pawn from e2 to e4")
        self.assertEqual(result["uci"], "e2e4")
        self.assertEqual(result["engine"], "Stockfish 19 Full")
        self.assertEqual(fake.calls, 1)

    def test_next_analysis_replaces_exited_engine(self):
        dead, fresh = FakeEngine(), FakeEngine()
        dead.returncode.set_result(1)
        with patch.object(server, "ENGINE", dead), patch.object(server, "start_engine", return_value=fresh) as start:
            self.assertEqual(server.analyze(chess.STARTING_FEN)["uci"], "e2e4")
            start.assert_called_once_with()
            self.assertEqual(dead.calls, 0)
            self.assertEqual(fresh.calls, 1)

    def test_rejects_invalid_position(self):
        with self.assertRaises(ValueError):
            server.analyze("not a FEN")
        with self.assertRaises(ValueError):
            server.analyze("8/8/8/8/8/8/8/8 w - - 0 1")

    def test_old_queued_position_does_not_use_engine(self):
        fake = FakeEngine()
        stale = server.issue_request()
        latest = server.issue_request()
        with patch.object(server, "ENGINE", fake):
            with self.assertRaises(server.SupersededRequest):
                server.analyze(chess.STARTING_FEN, stale)
            self.assertEqual(fake.calls, 0)
            self.assertEqual(server.analyze(chess.STARTING_FEN, latest)["uci"], "e2e4")
            self.assertEqual(fake.calls, 1)

    def test_new_position_supersedes_in_progress_result(self):
        engine = BlockingEngine()
        old_token = server.issue_request()
        errors = []

        def old_search():
            try:
                server.analyze(chess.STARTING_FEN, old_token)
            except Exception as error:
                errors.append(error)

        with patch.object(server, "ENGINE", engine):
            thread = threading.Thread(target=old_search, daemon=True)
            thread.start()
            self.assertTrue(engine.started.wait(timeout=3))
            new_token = server.issue_request()
            engine.release.set()
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
            self.assertEqual(len(errors), 1)
            self.assertIsInstance(errors[0], server.SupersededRequest)
            result = server.analyze(chess.STARTING_FEN, new_token)
            self.assertEqual(result["uci"], "e2e4")
            self.assertEqual(engine.calls, 2)

    def test_newest_token_is_global_and_monotonic(self):
        a = server.issue_request()
        b = server.issue_request()
        self.assertGreater(b, a)
        self.assertFalse(server.is_latest(a))
        self.assertTrue(server.is_latest(b))


if __name__ == "__main__":
    unittest.main()
