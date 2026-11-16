"""Offline Monte Carlo chess experiment. Never changes the production engine.

Three equal 1-second decision budgets:
* Stockfish: existing 1.0-second engine.
* Pure UCT MCTS: legal chess tree with randomized, capture-biased rollouts.
* Hybrid: 0.7-second Stockfish MultiPV shortlist + 0.3-second Monte Carlo rerank.

Test on real tournament positions and independently count legal random-game rollouts.
The 3s Stockfish analysis is a finite, imperfect comparison standard; not ground truth.
"""
from __future__ import annotations
import hashlib
import io
import json
import math
import random
import statistics
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import chess
import chess.engine
import chess.pgn
import server

SOURCE_COMMIT="5721c8a71a0f9850d54fe6d5b2d8060abcab1357"
SOURCES=[
 ("Chess_Candidates_and_Interzonals/Candidates2022.pgn",
  "2ff67698f28938850de0621d9adea8a23b229746"),
 ("Imense_Database_For _ChessEnigine/World_Chess_Champoinship/WorldChamp2018.pgn",
  "6737f278c167051483805fae91677d1ee6d54f3a"),
]
SEED=20261116
PIECE_VALUE={chess.PAWN:100,chess.KNIGHT:320,chess.BISHOP:330,chess.ROOK:510,chess.QUEEN:900,chess.KING:0}

def outcome_score(board:chess.Board,root:bool)->float:
    result=board.outcome(claim_draw=False)
    if result:
        if result.winner is None:return 0.5
        return 1.0 if result.winner==root else 0.0
    material=sum(PIECE_VALUE[p.piece_type]*(1 if p.color==root else -1)
                 for p in board.piece_map().values())
    return 0.5+0.5*math.tanh(material/600)

def rollout(board:chess.Board,root:bool,rng:random.Random,max_plies:int=16):
    b=board.copy(stack=False)
    for _ in range(max_plies):
        if b.is_game_over(claim_draw=False):break
        legal=list(b.legal_moves)
        if not legal:break
        weights=[5 if b.is_capture(m) else 1 for m in legal]
        for i,m in enumerate(legal):
            if m.promotion:weights[i]+=12
        b.push(rng.choices(legal,weights,k=1)[0])
    return outcome_score(b,root)

class Node:
    __slots__=("board","children","untried","visits","sum_root")
    def __init__(self,board:chess.Board,rng:random.Random):
        self.board=board
        self.children={}
        self.untried=list(board.legal_moves) if not board.is_game_over(claim_draw=False) else []
        rng.shuffle(self.untried)
        self.visits=0
        self.sum_root=0.0

def mcts(board:chess.Board,seconds:float,rng:random.Random):
    root_color=board.turn
    root=Node(board.copy(stack=False),rng)
    begin=time.perf_counter()
    limit=begin+seconds
    sims=0
    if not root.untried:return None,0
    while time.perf_counter()<limit or sims==0:
        current=root
        trace=[root]
        while not current.untried and current.children:
            ln=math.log(max(2,current.visits))
            sign=current.board.turn==root_color
            current=max(
                current.children.values(),
                key=lambda child: ((child.sum_root/child.visits) if sign else
                        (1-child.sum_root/child.visits))+
                        1.2*math.sqrt(ln/child.visits))
            trace.append(current)
        if current.untried:
            move=current.untried.pop()
            b=current.board.copy(stack=False)
            b.push(move)
            child=Node(b,rng)
            current.children[move]=child
            current=child
            trace.append(child)
        value=rollout(current.board,root_color,rng)
        for n in trace:
            n.visits+=1
            n.sum_root+=value
        sims+=1
    # Visit-count selection avoids lucky moves based on only one rollout.
    move=max(root.children.items(),
             key=lambda item:(item[1].visits,item[1].sum_root/item[1].visits))[0]
    return move,sims

def bandit(board:chess.Board,moves:list[chess.Move],seconds:float,rng:random.Random):
    """A root-only Monte Carlo comparison used only as an experimental tie-breaker."""
    first=board.turn
    stats={m:[0,0.0] for m in moves}
    choices={m:board.copy(stack=False) for m in moves}
    for m,b in choices.items():b.push(m)
    deadline=time.perf_counter()+seconds
    it=0
    while time.perf_counter()<deadline or it<len(moves):
        unvisited=[m for m in moves if stats[m][0]==0]
        if unvisited:m=rng.choice(unvisited)
        else:
            m=max(moves,key=lambda v:stats[v][1]/stats[v][0]+
                  0.7*math.sqrt(math.log(it+1)/stats[v][0]))
        score=rollout(choices[m],first,rng,max_plies=16)
        stats[m][0]+=1;stats[m][1]+=score
        it+=1
    return {m:(n,s/n if n else 0.5) for m,(n,s) in stats.items()},it

def hybrid_move(board:chess.Board,engine:chess.engine.SimpleEngine,rng:random.Random):
    begin=time.perf_counter()
    analyses=engine.analyse(board,chess.engine.Limit(time=0.7),multipv=3,game=object())
    if not analyses:return None,0,False
    best=analyses[0]["pv"][0]
    shortlist=[]
    for info in analyses:
        if not info.get("pv"):continue
        score=info.get("score")
        if score is None or score.pov(board.turn).is_mate():continue
        shortlist.append((info["pv"][0],score.pov(board.turn).score()))
    if len(shortlist)<2:return best,0,False
    top_score=shortlist[0][1]
    close=[m for m,cp in shortlist if top_score-cp<=25]
    if len(close)<2:return best,0,False
    remaining=max(0.01,begin+1.0-time.perf_counter())
    scores,sims=bandit(board,close,remaining,rng)
    choice=max(close,key=lambda m:scores[m][1])
    if choice!=best and scores[choice][0]>=5 and scores[best][0]>=5 and (
       scores[choice][1]-scores[best][1])>=0.15:
        return choice,sims,True
    return best,sims,False

def tournament_positions(n_per_phase=12):
    phases=defaultdict(list)
    total_games=0
    for path,expected_blob in SOURCES:
        uri=f"https://raw.githubusercontent.com/mainali123/Chess-Dataset/{SOURCE_COMMIT}/{urllib.parse.quote(path,safe='/')}"
        with urllib.request.urlopen(uri,timeout=30) as response:data=response.read()
        actual=hashlib.sha1(b"blob "+str(len(data)).encode()+bytes([0])+data).hexdigest()
        if actual!=expected_blob:raise ValueError("Pinned PGN content changed: "+path)
        stream=io.StringIO(data.decode("utf-8-sig",errors="replace"))
        while game:=chess.pgn.read_game(stream):
            if game.errors:continue
            total_games+=1
            b=game.board()
            for ply,move in enumerate(game.mainline_moves(),1):
                b.push(move)
                if ply<8 or b.is_game_over() or not b.is_valid():continue
                count=len(b.piece_map())
                phase="endgame" if count<=14 and ply>=45 else (
                      "opening" if ply<=25 else "middlegame")
                phases[phase].append((b.fen(),path,game.headers.get("Event",""),
                                      game.headers.get("White","")+" - "+game.headers.get("Black","")))
    rng=random.Random(SEED)
    selected=[];seen=set()
    for phase in ("opening","middlegame","endgame"):
        items=phases[phase][:]
        rng.shuffle(items)
        for fen,source,event,players in items:
            if sum(x["phase"]==phase for x in selected)>=n_per_phase:break
            if fen in seen:continue
            selected.append({"fen":fen,"phase":phase,"source":source,
                            "event":event,"players":players})
            seen.add(fen)
    if len(selected)!=3*n_per_phase:raise ValueError("Insufficient real-game positions")
    rng.shuffle(selected)
    return selected,total_games

def simulate_games(seconds=120,max_games=20000,cap_plies=220):
    rng=random.Random(SEED)
    start=time.perf_counter()
    records=defaultdict(int)
    plies=0;games=0
    while games<max_games and time.perf_counter()-start<seconds:
        b=chess.Board()
        while b.ply()<cap_plies and not b.is_game_over(claim_draw=False):
            b.push(rng.choice(list(b.legal_moves)))
        outcome=b.outcome(claim_draw=False)
        if outcome is None:records["censored_at_ply_cap"]+=1
        elif outcome.winner is None:records["draw"]+=1
        elif outcome.winner:records["white_win"]+=1
        else:records["black_win"]+=1
        plies+=b.ply()
        games+=1
        if games%500==0:
            print("ROLLOUT_GAMES",games,flush=True)
    return {"random_games":games,"total_plies":plies,"mean_plies":round(plies/games,1),
            "completed":games-records["censored_at_ply_cap"],**records,
            "seed":SEED,"max_plies":cap_plies,"wall_seconds":round(time.perf_counter()-start,1)}

def forced_gap(engine,board,reference,move,seconds=1.0):
    if move==reference["pv"][0]:return 0
    forced=engine.analyse(board,chess.engine.Limit(time=seconds),
                          root_moves=[move],game=object())
    a=reference["score"].pov(board.turn)
    b=forced["score"].pov(board.turn)
    if a.is_mate() or b.is_mate():return None
    return max(0,min(500,a.score()-b.score()))

def main():
    starts=time.perf_counter()
    game_report=simulate_games()
    print("SIMULATION_SUMMARY",json.dumps(game_report),flush=True)
    items,n_games=tournament_positions()
    engine=chess.engine.SimpleEngine.popen_uci(server.stockfish_location())
    engine_name=engine.id.get("name","unknown")
    engine.configure({"Threads":1,"Hash":16})
    samples=[]
    try:
        for i,item in enumerate(items,1):
            board=chess.Board(item["fen"])
            moves={}
            fast=engine.play(board,chess.engine.Limit(time=1.0),ponder=False,game=object())
            moves["stockfish_1s"]=(fast.move,None,False)
            mc,ns=mcts(board,1.0,random.Random(SEED+i*37))
            moves["mcts_1s"]=(mc,ns,False)
            hm,hs,overrode=hybrid_move(board,engine,random.Random(SEED+i*101))
            moves["hybrid_1s"]=(hm,hs,overrode)
            ref=engine.analyse(board,chess.engine.Limit(time=3.0),game=object())
            ref_move=ref["pv"][0]
            out={**item,"reference":ref_move.uci(),"reference_depth":ref.get("depth"),
                 "decisions":{}}
            for name,(move,sims,overrode) in moves.items():
                if move not in board.legal_moves:raise RuntimeError("Illegal move: "+name)
                out["decisions"][name]={
                    "move":move.uci(),"exact_match":move==ref_move,
                    "approx_cp_gap":forced_gap(engine,board,ref,move),
                    "simulation_count":sims,"hybrid_overrode":overrode,
                }
            samples.append(out)
            if i%6==0:print("POSITION_PROGRESS",i,"/",len(items),flush=True)
    finally:
        engine.quit()
    names=("stockfish_1s","mcts_1s","hybrid_1s")
    metrics={}
    for name in names:
        decisions=[p["decisions"][name] for p in samples]
        gaps=[d["approx_cp_gap"] for d in decisions if d["approx_cp_gap"] is not None]
        metrics[name]={
            "exact_agreement":sum(d["exact_match"] for d in decisions),
            "positions":len(decisions),
            "mean_approx_cp_gap":round(statistics.mean(gaps),1) if gaps else None,
            "median_approx_cp_gap":round(statistics.median(gaps),1) if gaps else None,
            "gap_over_50":sum(g>50 for g in gaps),
            "gap_over_100":sum(g>100 for g in gaps),
            "excluded_mate":len(decisions)-len(gaps),
            "median_simulations":statistics.median([d["simulation_count"] for d in decisions
                                                   if d["simulation_count"] is not None])
                                  if name!="stockfish_1s" else None,
            "hybrid_overrides":sum(d["hybrid_overrode"] for d in decisions) if name=="hybrid_1s" else None,
        }
    report={
        "engine":engine_name,"sample_size":len(samples),
        "real_games_parsed":n_games,
        "source_commit":SOURCE_COMMIT,
        "game_rollouts":game_report,
        "comparison":"Three 1s decisions vs a separate 3s Stockfish analysis; no ELO or win-rate inference.",
        "strategies":metrics,
        "positions":samples,
        "elapsed_seconds":round(time.perf_counter()-starts,1)
    }
    Path("monte_carlo_results.json").write_text(json.dumps(report,indent=2)+"\n")
    print("RESULT",json.dumps({k:v for k,v in report.items() if k!="positions"}),flush=True)
    examples=sorted(samples,key=lambda item:item["decisions"]["mcts_1s"]["approx_cp_gap"] or 0,
                    reverse=True)[:3]
    print("MCTS_WORST",json.dumps(examples),flush=True)

if __name__=="__main__":
    main()
