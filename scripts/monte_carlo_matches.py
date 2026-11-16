"""Paired Monte Carlo-vs-Stockfish legal chess games, equal time per move.

The 0.1-second per-player setting is for a bounded experiment, not a direct
measurement of the production agent at its 1-second setting.
"""
import json
import random
import sys
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import chess
import chess.engine
import chess.pgn
import server
import monte_carlo_experiment as mc

DECISION_SECONDS=0.10
MAX_NEW_PLIES=100
STARTS=12

def match():
    positions,source_games=mc.tournament_positions()
    starts=[x for x in positions if x["phase"]=="middlegame"][:6]
    starts += [x for x in positions if x["phase"]=="endgame"][:6]
    if len(starts)!=STARTS:raise RuntimeError("Not enough matched starts")
    games=[]
    out_pgn=[]
    engine=chess.engine.SimpleEngine.popen_uci(server.stockfish_location())
    engine.configure({"Threads":1,"Hash":16})
    engine_name=engine.id.get("name")
    beginning=time.perf_counter()
    try:
        for i,start in enumerate(starts):
            for mc_color in (chess.WHITE,chess.BLACK):
                board=chess.Board(start["fen"])
                moves=[]
                mc_sims=0
                rng=random.Random(mc.SEED+117*i+(1 if mc_color else 2))
                for ply in range(MAX_NEW_PLIES):
                    if board.is_game_over(claim_draw=False):break
                    if board.turn==mc_color:
                        move,n=mc.mcts(board,DECISION_SECONDS,rng)
                        mc_sims+=n
                    else:
                        play=engine.play(board,chess.engine.Limit(time=DECISION_SECONDS),
                                         ponder=False,game=object())
                        move=play.move
                    if move not in board.legal_moves:
                        raise AssertionError("Illegal move by "+("MCTS" if board.turn==mc_color else "Stockfish"))
                    moves.append(move.uci())
                    board.push(move)
                outcome=board.outcome(claim_draw=False)
                actual_result=board.result(claim_draw=False) if outcome else "*"
                winner=None if outcome is None or outcome.winner is None else (
                    "MCTS" if outcome.winner==mc_color else "Stockfish")
                category="censored" if outcome is None else "draw" if winner is None else winner
                record={
                    "starting_phase":start["phase"],
                    "source":start["source"],"players":start["players"],
                    "start_fen":start["fen"],
                    "mcts_color":"white" if mc_color else "black",
                    "winner":winner,"outcome":category,
                    "result":actual_result,
                    "new_plies":len(moves),
                    "monte_carlo_tree_simulations":mc_sims,
                    "movelist_uci":moves
                }
                games.append(record)
                game=chess.pgn.Game()
                game.setup(chess.Board(start["fen"]))
                game.headers.update({
                    "Event":"MCTS vs Stockfish control",
                    "White":"MCTS" if mc_color else "Stockfish",
                    "Black":"Stockfish" if mc_color else "MCTS",
                    "Result":actual_result,
                    "Round":f"{i+1}.{1 if mc_color else 2}"
                })
                node=game
                for uci in moves:
                    node=node.add_variation(chess.Move.from_uci(uci))
                out_pgn.append(str(game))
                print("MATCH",len(games),category,"plies",len(moves),"simulations",mc_sims,flush=True)
    finally:engine.quit()
    counts={name:sum(g["outcome"]==name for g in games)
            for name in ("MCTS","Stockfish","draw","censored")}
    completed=len(games)-counts["censored"]
    report={
        "engine":engine_name,
        "matched_starts":STARTS,
        "games":len(games),
        "search_seconds_per_move_both_sides":DECISION_SECONDS,
        "maximum_new_plies_per_game":MAX_NEW_PLIES,
        "completed_games":completed,
        "counts":counts,
        "game_source_count":source_games,
        "simulation_total":sum(g["monte_carlo_tree_simulations"] for g in games),
        "elapsed_seconds":round(time.perf_counter()-beginning,1),
        "limitations":"Low 0.1s time control and limited paired games. Censored games excluded from completed-game scores. Not a 1s production win-rate estimate.",
        "results":games
    }
    Path("monte_carlo_matches.json").write_text(json.dumps(report,indent=2)+"\n")
    Path("monte_carlo_matches.pgn").write_text("\n\n".join(out_pgn)+"\n")
    print("MATCH_SUMMARY",json.dumps({k:v for k,v in report.items() if k!="results"}),flush=True)

if __name__=="__main__":match()
