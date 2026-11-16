import json
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest

import chess

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
import selfplay_campaign as c


class MateEngine:
    def configure(self, options):
        pass

    def play(self, board, limit, **kwargs):
        for move in board.legal_moves:
            board.push(move)
            mate = board.is_checkmate()
            board.pop()
            if mate:
                return types.SimpleNamespace(move=move)
        return types.SimpleNamespace(move=next(iter(board.legal_moves)))


class CampaignTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name)/'campaign.sqlite3'
        self.config = {'games':10,'training_games':2,'seconds':1.0,
                       'teacher_seconds':1.5,'teacher_positions_per_game':2,
                       'seed':20261116,'max_plies':1024}
        self.db = c.init_db(self.path,self.config)
        c._ENGINES = [MateEngine(),MateEngine(),MateEngine()]
        c._STOP_EVENT = None

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def record(self, slot, fen='7k/5Q2/6K1/8/8/8/8/8 w - - 0 1'):
        return {'slot':slot,'attempt':0,'start':'test','start_fen':fen,
                'moves':[],'book_hits':0,'elapsed':0.0,'observations':[],
                'teacher_updates':[],'teacher_checked':0}

    def test_default_is_one_million_at_one_second(self):
        args=c.parser().parse_args([])
        self.assertEqual((args.games,args.seconds),(1_000_000,1.0))

    def test_task_balance_and_matched_starts(self):
        config={**self.config,'games':100,'training_games':20}
        specs=[c.task_spec(i,config) for i in range(100)]
        self.assertEqual(sum(s['phase']=='training' for s in specs),20)
        for split in ('seen','unseen'):
            rows=[s for s in specs if s['split']==split]
            self.assertEqual(len(rows),40)
            for pair in range(10):
                four=[s for s in rows if s['pair']==pair]
                self.assertEqual({(s['adapted'],s['agent_white']) for s in four},
                                 {(False,False),(False,True),(True,False),(True,True)})
                starts={c.make_start(s['split'],s['pair'],config['seed']) for s in four}
                self.assertEqual(len(starts),1)
        for s in specs:
            _,fen=c.make_start(s['split'],s['pair'],config['seed'])
            b=chess.Board(fen)
            self.assertTrue(b.is_valid())
            self.assertFalse(b.is_game_over(claim_draw=True))

    def test_terminal_game_counted_exactly_once(self):
        spec=c.task_spec(2,self.config)
        c.save_pending(self.db,2,self.record(2))
        self.assertEqual(c.run_game(self.path,self.config,spec,time.monotonic()+10),'completed')
        result=json.loads(self.db.execute('SELECT record FROM games').fetchone()[0])
        self.assertEqual(result['termination'],'CHECKMATE')
        self.assertEqual(len(result['moves']),1)
        self.assertEqual(c.run_game(self.path,self.config,spec,time.monotonic()+10),'already_complete')
        self.assertEqual(c.status(self.db,self.config)['completed'],1)
        self.assertEqual(c.status(self.db,self.config)['pending'],0)

    def test_deadline_saves_and_resumes_same_game(self):
        record=self.record(2)
        c.save_pending(self.db,2,record)
        spec=c.task_spec(2,self.config)
        self.assertEqual(c.run_game(self.path,self.config,spec,time.monotonic()-1),'paused')
        self.assertEqual(c.status(self.db,self.config)['completed'],0)
        self.assertEqual(c.run_game(self.path,self.config,spec,time.monotonic()+10),'completed')
        got=json.loads(self.db.execute('SELECT record FROM games').fetchone()[0])
        self.assertEqual(got['start_fen'],record['start_fen'])
        self.assertEqual(got['slot'],2)

    def test_resume_replays_prior_moves(self):
        record=self.record(2,chess.STARTING_FEN)
        record['moves']=['f2f3','e7e5','g2g4']
        c.save_pending(self.db,2,record)
        spec={**c.task_spec(2,self.config),'agent_white':False}
        c.run_game(self.path,self.config,spec,time.monotonic()+10)
        got=json.loads(self.db.execute('SELECT record FROM games').fetchone()[0])
        self.assertEqual(got['moves'],['f2f3','e7e5','g2g4','d8h4'])

    def test_censored_attempt_not_counted_as_completed_or_draw(self):
        config={**self.config,'max_plies':1}
        c.save_pending(self.db,2,self.record(2,chess.STARTING_FEN))
        self.assertEqual(c.run_game(self.path,config,c.task_spec(2,config),time.monotonic()+10),'censored')
        status=c.status(self.db,config)
        self.assertEqual(status['completed'],0)
        self.assertEqual(status['unfinished_attempts'],1)
        self.assertEqual(status['remaining'],10)

    def test_evaluation_never_learns(self):
        record=self.record(3)
        c.save_pending(self.db,3,record)
        c.run_game(self.path,self.config,c.task_spec(3,self.config),time.monotonic()+10)
        self.assertEqual(self.db.execute('SELECT count(*) FROM book').fetchone()[0],0)
        record.update(result='draw',score=0.5)
        with self.assertRaises(ValueError):
            c.finish_game(self.db,c.task_spec(4,self.config),record,[('bad','e2e4')])
        self.assertIsNone(self.db.execute('SELECT 1 FROM games WHERE slot=4').fetchone())

    def test_training_result_and_book_atomic(self):
        record=self.record(0)
        c.save_pending(self.db,0,record)
        c.run_game(self.path,self.config,c.task_spec(0,self.config),time.monotonic()+10)
        self.assertEqual(self.db.execute('SELECT count(*) FROM games').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT count(*) FROM book').fetchone()[0],1)

    def test_config_and_draw_clock_are_preserved(self):
        with self.assertRaises(ValueError):
            c.init_db(self.path,{**self.config,'seconds':0.01})
        b=chess.Board()
        key=c.position_key(b)
        b.halfmove_clock=99
        self.assertNotEqual(key,c.position_key(b))

    def test_paired_summary_waits_for_all_four_games(self):
        for slot in (2,3,4,5):
            spec=c.task_spec(slot,self.config)
            record=self.record(slot)
            record.update(result='agent1_win' if spec['adapted'] else 'draw',
                          score=1.0 if spec['adapted'] else 0.5)
            c.finish_game(self.db,spec,record,[])
            report=c.paired_summary(self.db)['seen']
            self.assertEqual(report['complete_color_groups'],int(slot==5))
        self.assertEqual(report['candidate_minus_control_score'],0.5)


if __name__=='__main__':
    unittest.main()
