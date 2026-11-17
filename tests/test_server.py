"""Unit checks for move wording and legal position tracking."""
import unittest
import threading
from unittest.mock import Mock, patch
import chess
import chess.engine
import server
from server import format_instruction, advance_position

class FakeAnalysis:
    def __init__(self, move, info=None, selected=None):
        self.info={"pv":[move],**(info or {})}
        self.selected=selected if selected is not None else move
        self.stopped=False
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def __iter__(self):
        yield self.info
    def stop(self):self.stopped=True
    def wait(self):return chess.engine.BestMove(self.selected,None)


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

    def test_track_two_plies_from_fast_bot(self):
        start = chess.Board()
        after = start.copy()
        after.push_uci("e2e4")
        after.push_uci("e7e5")
        tracked = advance_position(start.fen(), after.board_fen())
        self.assertEqual(tracked["fen"], after.fen())

    def test_reject_three_plies(self):
        start = chess.Board()
        after = start.copy()
        after.push_uci("e2e4")
        after.push_uci("e7e5")
        after.push_uci("g1f3")
        with self.assertRaises(ValueError):
            advance_position(start.fen(), after.board_fen())

    def test_reject_illegal_move_instruction(self):
        board = chess.Board()
        with self.assertRaises(ValueError):
            format_instruction(board, chess.Move.from_uci("g1e2"))

    def test_track_special_moves(self):
        cases = [
            ("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1g1"),
            ("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8n"),
            ("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5d6"),
        ]
        for fen, move in cases:
            with self.subTest(move=move):
                after = chess.Board(fen)
                after.push_uci(move)
                self.assertEqual(advance_position(fen, after.board_fen())["fen"], after.fen())

    def test_reject_malformed_observed_placement(self):
        with self.assertRaises(ValueError):
            advance_position(chess.Board().fen(), "not a board")


class AnalysisWorkloadTests(unittest.TestCase):
    def setUp(self):
        server.ANALYSIS_CACHE.clear()
        self.engine = Mock()
        server.coach_control(False)
        self.engine.analysis.side_effect = lambda board, *args, **kwargs: FakeAnalysis(
            next(iter(board.legal_moves)))
        self.engine_patch = patch.object(server, "ENGINE", self.engine)
        self.engine_patch.start()

    def tearDown(self):
        self.engine_patch.stop()
        server.ANALYSIS_CACHE.clear()

    def test_same_position_reuses_analysis_without_another_engine_search(self):
        board = chess.Board()
        first = server.analyze_fen(board.fen())
        self.assertIn(chess.Move.from_uci(first["from"] + first["to"]), board.legal_moves)
        original = dict(first)
        first["instruction"] = "Caller changed the returned dictionary"
        self.assertEqual(server.analyze_fen(board.fen()), original)
        self.assertEqual(self.engine.analysis.call_count, 1)

    def test_different_positions_are_analyzed_and_cache_is_bounded(self):
        with patch.object(server, "MAX_CACHED_POSITIONS", 2):
            board = chess.Board()
            initial_fen = board.fen()
            server.analyze_fen(initial_fen)
            for move in ("e2e4", "e7e5"):
                board.push_uci(move)
                server.analyze_fen(board.fen())
            self.assertEqual(len(server.ANALYSIS_CACHE), 2)
            self.assertNotIn((initial_fen, 1.0, 1650), server.ANALYSIS_CACHE)
            self.assertEqual(self.engine.analysis.call_count, 3)

    def test_main_coach_recommends_weaker_selected_move_not_top_pv(self):
        top=chess.Move.from_uci("g1f3")
        weaker=chess.Move.from_uci("a2a3")
        self.engine.analysis.side_effect=lambda board,*args,**kwargs:FakeAnalysis(top,selected=weaker)
        answer=server.analyze_fen(chess.Board().fen())
        self.assertEqual(answer["from"],"a2")
        self.assertEqual(answer["to"],"a3")
        self.assertEqual(answer["instruction"],"Move pawn from a2 to a3")
        self.assertIsNone(answer["score_cp"])
        self.assertIsNone(answer["mate_in"])

    def test_busy_engine_does_not_queue_more_searches(self):
        with server.ENGINE_LOCK:
            with self.assertRaisesRegex(RuntimeError, "Engine busy"):
                server.analyze_fen(chess.Board().fen())
        self.engine.analysis.assert_not_called()

    def test_engine_failure_releases_lock_and_can_be_retried(self):
        self.engine.analysis.side_effect = RuntimeError("Temporary engine failure")
        with self.assertRaisesRegex(RuntimeError, "Temporary"):
            server.analyze_fen(chess.Board().fen())
        self.assertFalse(server.ENGINE_LOCK.locked())
        self.assertFalse(server.ANALYSIS_CACHE)

    def test_invalid_engine_move_is_never_cached(self):
        self.engine.analysis.side_effect = None
        self.engine.analysis.return_value = FakeAnalysis(chess.Move.from_uci("e2e5"))
        with self.assertRaisesRegex(ValueError, "not legal"):
            server.analyze_fen(chess.Board().fen())
        self.assertFalse(server.ANALYSIS_CACHE)


if __name__ == "__main__":
    unittest.main()

class AdjustableAnalysisTests(unittest.TestCase):
    def setUp(self):
        server.ANALYSIS_CACHE.clear()
        server.coach_control(False)
        self.engine = Mock()
        def play(board, limit, **kwargs):
            move = next(iter(board.legal_moves))
            return FakeAnalysis(move, info={
                "depth": 15, "nodes": 9000,
                "score": chess.engine.PovScore(chess.engine.Cp(70), board.turn)
            })
        self.engine.analysis.side_effect = play
        self.patcher = patch.object(server, "ENGINE", self.engine)
        self.patcher.start()

    def tearDown(self):
        self.patcher.stop()
        server.ANALYSIS_CACHE.clear()

    def test_default_search_uses_one_second(self):
        fen = chess.Board().fen()
        answer = server.analyze_fen(fen)
        self.assertEqual(answer["seconds"], 1.0)
        self.assertEqual(self.engine.analysis.call_args.args[1].time, 1.0)
        self.assertIn((fen, 1.0, 1650), server.ANALYSIS_CACHE)

    def test_search_budget_is_explicit_and_engine_reports_diagnostics(self):
        result=server.analyze_fen(chess.Board().fen(), 1)
        self.assertEqual(result["seconds"], 1.0)
        self.assertEqual(result["depth"], 15)
        self.assertEqual(result["nodes"], 9000)
        self.assertEqual(result["score_cp"], 70)
        self.assertEqual(result["mate_in"], None)
        self.assertTrue(result["reason"])
        self.assertAlmostEqual(self.engine.analysis.call_args.args[1].time, 1.0)

    def test_cache_separates_search_budgets(self):
        fen=chess.Board().fen()
        server.analyze_fen(fen,0.2)
        server.analyze_fen(fen,1)
        server.analyze_fen(fen,0.2)
        self.assertEqual(self.engine.analysis.call_count,2)
        self.assertIn((fen,0.2,1650),server.ANALYSIS_CACHE)
        self.assertIn((fen,1.0,1650),server.ANALYSIS_CACHE)

    def test_adjustable_strength_changes_engine_and_cache_in_place(self):
        fen=chess.Board().fen()
        low=server.analyze_fen(fen,1,1400)
        high=server.analyze_fen(fen,1,1650)
        reused=server.analyze_fen(fen,1,1650)
        self.assertEqual(low["elo"],1400)
        self.assertEqual(high["elo"],1650)
        self.assertEqual(reused,high)
        self.assertEqual(self.engine.analysis.call_count,2)
        self.assertIn((fen,1.0,1400),server.ANALYSIS_CACHE)
        self.assertIn((fen,1.0,1650),server.ANALYSIS_CACHE)
        self.assertEqual(self.engine.configure.call_args.args[0],
                         {"UCI_LimitStrength":True,"UCI_Elo":1650})

    def test_full_strength_disables_uci_limit_and_separates_cache(self):
        fen=chess.Board().fen()
        limited=server.analyze_fen(fen,1,1650)
        full=server.analyze_fen(fen,1,"full")
        self.assertEqual(limited["elo"],1650)
        self.assertEqual(full["elo"],"full")
        self.assertEqual(self.engine.configure.call_args.args[0],{"UCI_LimitStrength":False})
        self.assertEqual(self.engine.analysis.call_count,2)
        self.assertIn((fen,1.0,1650),server.ANALYSIS_CACHE)
        self.assertIn((fen,1.0,"full"),server.ANALYSIS_CACHE)
        server.analyze_fen(fen,1,"full")
        self.assertEqual(self.engine.analysis.call_count,2)

    def test_rejects_invalid_strengths(self):
        for elo in (1320.5,0,1000,5000,"1650",True,float("nan")):
            with self.subTest(elo=elo):
                with self.assertRaises(ValueError):
                    server.analyze_fen(chess.Board().fen(),1,elo)
        self.engine.analysis.assert_not_called()

    def test_rejects_invalid_search_times(self):
        for seconds in (0,0.1,0.7,5,True,"1",float("nan")):
            with self.subTest(seconds=seconds):
                with self.assertRaises(ValueError):
                    server.analyze_fen(chess.Board().fen(),seconds)
        self.engine.analysis.assert_not_called()

    def test_move_reason_uses_verifiable_board_features(self):
        board=chess.Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")
        self.assertEqual(server.describe_move(board,chess.Move.from_uci("e1g1")), "Castles the king.")
        capture=chess.Board("7k/8/8/8/p7/8/R7/7K w - - 0 1")
        self.assertIn("Captures",server.describe_move(capture,chess.Move.from_uci("a2a4")))


class RecoveryTests(unittest.TestCase):
    def test_replays_many_moves_without_guessing(self):
        board = chess.Board()
        san = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6"]
        for move in san: board.push_san(move)
        result = server.recover_from_history(san,board.board_fen())
        self.assertEqual(result["fen"],board.fen())
        self.assertEqual(result["recovered_moves"],8)

    def test_rejects_history_that_disagrees_with_board(self):
        with self.assertRaisesRegex(ValueError,"does not match"):
            server.recover_from_history(["e4","e5"],chess.Board().board_fen())


class AdaptiveTrainingTests(unittest.TestCase):
    def test_bank_has_at_least_100_legal_unique_positions(self):
        from training import position_bank
        positions=position_bank()
        self.assertGreaterEqual(len(positions),100)
        self.assertEqual(len({item["fen"] for item in positions}),len(positions))
        for item in positions:
            board=chess.Board(item["fen"])
            self.assertTrue(board.is_valid())
            self.assertFalse(board.is_game_over())

    def test_engine_scores_submitted_move_and_preserves_perspective(self):
        from training import evaluate_attempt
        board=chess.Board()
        def search(position, seconds, root_moves=None):
            target=chess.Move.from_uci("e2e4")
            if root_moves:
                self.assertEqual(root_moves[0],chess.Move.from_uci("a2a3"))
                return {"pv":root_moves,"score":chess.engine.PovScore(chess.engine.Cp(5),position.turn)}
            return {"pv":[target],"score":chess.engine.PovScore(chess.engine.Cp(65),position.turn)}
        result=evaluate_attempt(board.fen(),"a2a3",search,threading.Lock(),object())
        self.assertEqual(result["centipawn_loss"],60)
        self.assertEqual(result["best_san"],"e4")
        self.assertEqual(result["played_san"],"a3")

    def test_training_temporarily_uses_unrestricted_engine_then_restores_1400(self):
        from training import evaluate_attempt
        fake=Mock()
        search=Mock(return_value={
            "pv":[chess.Move.from_uci("e2e4")],
            "score":chess.engine.PovScore(chess.engine.Cp(30),chess.WHITE)
        })
        result=evaluate_attempt(chess.Board().fen(),"e2e4",
                                search,threading.Lock(),fake,main_elo=1400)
        self.assertEqual(result["best"],"e2e4")
        self.assertEqual(fake.configure.call_args_list[0].args[0],
                         {"UCI_LimitStrength":False})
        self.assertEqual(fake.configure.call_args_list[-1].args[0],
                         {"UCI_LimitStrength":True,"UCI_Elo":1400})

    def test_training_restores_engine_after_failed_search(self):
        from training import evaluate_attempt
        fake=Mock()
        with self.assertRaisesRegex(RuntimeError,"simulated"):
            evaluate_attempt(chess.Board().fen(),"e2e4",
                             Mock(side_effect=RuntimeError("simulated")),
                             threading.Lock(),fake,main_elo=1400)
        self.assertEqual(fake.configure.call_args_list[-1].args[0],
                         {"UCI_LimitStrength":True,"UCI_Elo":1400})

    def test_hidden_control_blocks_engine_requests(self):
        server.coach_control(True)
        try:
            with self.assertRaisesRegex(RuntimeError,"paused"):
                server.analyze_fen(chess.Board().fen())
        finally:
            server.coach_control(False)


class PauseCancellationTests(unittest.TestCase):
    def test_hiding_stops_active_engine_analysis(self):
        class ActiveSearch:
            def __init__(self):self.stops=0
            def stop(self):self.stops+=1
        active=ActiveSearch()
        try:
            with server.CONTROL_LOCK:
                server.ACTIVE_ANALYSIS=active
            result=server.coach_control(True)
            self.assertTrue(result["hidden"])
            self.assertEqual(active.stops,1)
        finally:
            with server.CONTROL_LOCK:
                server.ACTIVE_ANALYSIS=None
            server.coach_control(False)



class MainCoachStrengthTests(unittest.TestCase):
    def test_main_engine_strength_default_is_1650(self):
        self.assertEqual(server.MAIN_COACH_ELO, 1650)
        fake=Mock()
        server.configure_main_engine(fake)
        fake.configure.assert_called_once_with({
            "Threads": 1, "Hash": 16,
            "UCI_LimitStrength": True, "UCI_Elo": 1650
        })


class LocalApiBoundaryTests(unittest.TestCase):
    def test_loopback_api_rejects_untrusted_origins_and_host_headers(self):
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        http=ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        thread=threading.Thread(target=http.serve_forever,daemon=True)
        thread.start()
        url=f"http://127.0.0.1:{http.server_port}/api/health"
        try:
            with urllib.request.urlopen(url, timeout=3) as response:
                self.assertEqual(response.status,200)
            for headers in ({"Origin":"https://untrusted.example"},
                            {"Host":"untrusted.example"},
                            {"Origin":"null"}):
                with self.subTest(headers=headers):
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=3)
                    self.assertEqual(caught.exception.code,403)
            extension_origin={"Origin":"chrome-extension://"+"a"*32}
            with urllib.request.urlopen(urllib.request.Request(url,headers=extension_origin),timeout=3) as response:
                self.assertEqual(response.status,200)
        finally:
            http.shutdown()
            http.server_close()
