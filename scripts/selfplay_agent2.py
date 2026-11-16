"""Offline self-play: train a correction book, compare adapted Agent 1 vs frozen Agent 2.
Agents use equal time at evaluation; post-game training uses EXTRA CPU and is disclosed.
No changes are made to the production coach.
"""
import json,random,statistics,time,sys,os
from collections import defaultdict
from pathlib import Path
import chess,chess.engine,chess.pgn
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server

SEED=20261116
STARTS=[
("Italian","e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6"),
("Ruy Lopez","e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6"),
("Sicilian","e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6"),
("Caro Kann","e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5"),
("Queens Gambit","d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7"),
("Kings Indian","d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"),
("English","c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5"),
("London","d4 Nf6 Nf3 d5 Bf4 e6 e3 Bd6"),
("French","e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7"),
("Scotch","e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5"),
("Candidates endgame","8/5R2/2k5/2p1b3/p3N3/2P4r/3K4/8 b - - 3 61"),
("Candidates middlegame","5r2/1b2q1k1/p2p1p1p/P1p3p1/4P3/2BP3P/1P3QP1/5RK1 w - - 0 41")
]
def make_board(value):
    if "/" in value:b=chess.Board(value)
    else:
        b=chess.Board()
        for san in value.split():b.push_san(san)
    if not b.is_valid() or b.is_game_over():raise ValueError("Bad start "+value)
    return b

def key(board):
    return " ".join(board.fen().split()[:4])

def engine(path):
    e=chess.engine.SimpleEngine.popen_uci(path)
    e.configure({"Threads":1,"Hash":16})
    return e

def play(start,name,agent_color,engines,game_id,seconds,book=None,limit=60,collect=False):
    b=start.copy(stack=False)
    moves=[];observations=[];hits=[]
    book=book or {}
    for ply in range(limit):
        if b.is_game_over(claim_draw=True):break
        k=key(b)
        move=None
        if b.turn==agent_color and ply<12 and k in book:
            trial=chess.Move.from_uci(book[k]["uci"])
            if trial in b.legal_moves:
                move=trial;hits.append(k)
        if move is None:
            which=engines[0] if b.turn==agent_color else engines[1]
            result=which.play(b,chess.engine.Limit(time=seconds),ponder=False,game=game_id)
            move=result.move
        if move not in b.legal_moves:raise AssertionError("Illegal move")
        if collect and b.turn==agent_color and ply<12:
            observations.append((k,b.fen(),move.uci()))
        moves.append(move.uci())
        b.push(move)
    outcome=b.outcome(claim_draw=True)
    verdict=("censored" if outcome is None else
        "draw" if outcome.winner is None else
        "agent1_win" if outcome.winner==agent_color else "agent2_win")
    score=None if outcome is None else (0.5 if outcome.winner is None
        else 1.0 if outcome.winner==agent_color else 0.0)
    return {"start":name,"start_fen":start.fen(),
            "agent1_color":"white" if agent_color else "black",
            "result":verdict,"score":score,"plies":len(moves),"moves":moves,
            "observations":observations,"book_hits":len(hits)}

def summary(games):
    count={k:sum(g["result"]==k for g in games)
           for k in ("agent1_win","agent2_win","draw","censored")}
    scored=[g["score"] for g in games if g["score"] is not None]
    return {"games":len(games),"results":count,
            "completed":len(scored),
            "score_fraction_on_completed":round(statistics.mean(scored),3) if scored else None,
            "book_move_uses":sum(g["book_hits"] for g in games),
            "games_using_book":sum(g["book_hits"]>0 for g in games),
            "mean_plies":round(statistics.mean(g["plies"] for g in games),1)}

def pgn(g,title):
    record=chess.pgn.Game()
    record.setup(chess.Board(g["start_fen"]))
    record.headers["Event"]=title
    record.headers["White"]="Agent 1" if g["agent1_color"]=="white" else "Agent 2"
    record.headers["Black"]="Agent 1" if g["agent1_color"]=="black" else "Agent 2"
    if g["result"]=="draw":record.headers["Result"]="1/2-1/2"
    elif g["result"]=="censored":record.headers["Result"]="*"
    else:
        white_won=(g["result"]=="agent1_win" and g["agent1_color"]=="white") or (
            g["result"]=="agent2_win" and g["agent1_color"]=="black")
        record.headers["Result"]="1-0" if white_won else "0-1"
    node=record
    for uci in g["moves"]:node=node.add_variation(chess.Move.from_uci(uci))
    return str(record)

def experiment(seconds=0.12,post_seconds=0.8,limit=60):
    starts=[(name,make_board(value)) for name,value in STARTS]
    first=starts[:6]
    unseen=starts[6:]
    a,b,teacher=map(engine,[server.stockfish_location()]*3)
    version=teacher.id.get("name")
    began=time.monotonic()
    training=[];original=[];learned=[];book={}
    try:
        for i,(name,start) in enumerate(first):
            for color in (chess.WHITE,chess.BLACK):
                game=play(start,name,color,(a,b),("training",i,color),
                          seconds,limit=limit,collect=True)
                training.append(game)
                print("TRAIN",len(training),name,game["result"],flush=True)
        observed=defaultdict(list)
        for g in training:
            for k,fen,move in g["observations"]:
                observed[k].append((fen,move,g["score"]))
        ordered=sorted(observed,key=lambda k:(-len(observed[k]),k))
        changed=0
        for k in ordered[:90]:
            fen,_,_=observed[k][0]
            pos=chess.Board(fen)
            teacher_answer=teacher.play(pos,chess.engine.Limit(time=post_seconds),
                                        ponder=False,game=("postmortem",k))
            new=teacher_answer.move
            if new not in pos.legal_moves:raise AssertionError("Teacher illegal")
            if any(chosen!=new.uci() for _,chosen,_ in observed[k]):changed+=1
            book[k]={"uci":new.uci(),"seen":len(observed[k]),"original":[u for _,u,_ in observed[k]],
                     "training_scores":[v for _,_,v in observed[k] if v is not None]}
        print("LEARNED_BOOK",len(book),"different_moves",changed,flush=True)
        for split,sets in (("seen",first),("unseen",unseen)):
            for i,(name,start) in enumerate(sets):
                for color in (chess.WHITE,chess.BLACK):
                    base=("evaluation",split,i,color)
                    control=play(start,name,color,(a,b),(base,"control"),seconds,limit=limit)
                    adapted=play(start,name,color,(a,b),(base,"candidate"),seconds,book=book,limit=limit)
                    control["split"]=adapted["split"]=split
                    original.append(control);learned.append(adapted)
                    print("MATCH",len(learned),split,name,
                          "control",control["result"],"learned",adapted["result"],
                          "book_hits",adapted["book_hits"],flush=True)
    finally:
        for e in (a,b,teacher):e.quit()
    output={
        "engine":version,"seed":SEED,
        "training_seconds_per_move":seconds,"evaluation_seconds_per_move_each_side":seconds,
        "offline_postmortem_seconds_per_position":post_seconds,
        "offline_postmortem_added_budget_seconds":round(len(book)*post_seconds,2),
        "training":summary(training),"control":summary(original),"candidate":summary(learned),
        "seen":{"control":summary([g for g in original if g["split"]=="seen"]),
                "candidate":summary([g for g in learned if g["split"]=="seen"])},
        "unseen":{"control":summary([g for g in original if g["split"]=="unseen"]),
                  "candidate":summary([g for g in learned if g["split"]=="unseen"])},
        "book":{"observed_unique_positions":len(observed),"stored":len(book),"changed_from_training":changed},
        "elapsed_s":round(time.monotonic()-began,1),
        "limitations":"Evaluations start from 6 training-seen and 6 unseen positions; trajectories frozen, but shared starts allow memorization. Agent 1 had extra offline postmortem compute. Censored games are excluded from win-rate score; small sample; not a 1-second production-strength claim.",
        "training_games":training,"control_games":original,"candidate_games":learned,
        "learned_moves":book
    }
    Path("selfplay_agent2_results.json").write_text(json.dumps(output,indent=2)+"\n")
    Path("selfplay_agent2_games.pgn").write_text("\n\n".join(
        [pgn(g,"Frozen vs frozen control") for g in original]+
        [pgn(g,"Learned Agent 1 vs frozen Agent 2") for g in learned])+"\n")
    print("SUMMARY",json.dumps({k:v for k,v in output.items() if k not in (
        "training_games","control_games","candidate_games","learned_moves")}),flush=True)

if __name__=="__main__":
    experiment()
