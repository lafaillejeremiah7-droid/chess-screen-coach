"""One-second production-budget self-play contest using trained vs frozen Stockfish."""
import json,statistics,time
from pathlib import Path
import chess,chess.engine
import server
import selfplay_agent2 as s

SEC=1.0
POST_SEC=1.5
PLIES=32
if server.ANALYSIS_SECONDS!=SEC:
    raise AssertionError("Production default changed; this contest requires one second")

TRAIN=[
    ("Caruana-Firouzja 2022",s.make_board(s.STARTS[10][1])),
    ("Caruana-Ding 2022",s.make_board(s.STARTS[11][1])),
]
UNSEEN=[
    ("Duda-Firouzja 2022",s.make_board("1r5k/5R1p/2p5/p3b3/8/P5nP/B7/6RK w - - 1 38")),
    ("Nepomniachtchi-Rapport 2022",s.make_board("2r5/1p3p2/p6p/5pk1/4bR2/P5P1/1PP1B2P/2K5 w - - 1 29")),
]

def assess(game,judge):
    if game["score"] is not None:return None
    b=chess.Board(game["start_fen"])
    for uci in game["moves"]:b.push_uci(uci)
    score=judge.analyse(b,chess.engine.Limit(time=0.5),game=object())["score"]
    is_white=game["agent1_color"]=="white"
    return score.pov(is_white).score(mate_score=10000)

def main():
    start=time.perf_counter()
    a,b,judge=(s.engine(server.stockfish_location()) for _ in range(3))
    title=judge.id["name"]
    train=[];controls=[];adapted=[];book={}
    try:
        for i,(name,pos) in enumerate(TRAIN):
            for color in (chess.WHITE,chess.BLACK):
                g=s.play(pos,name,color,(a,b),("train",i,color),SEC,limit=PLIES,collect=True)
                train.append(g)
                print("TRAIN",len(train),name,g["result"],flush=True)
        experiences={}
        for g in train:
            for key,fen,move in g["observations"]:
                experiences.setdefault(key,[]).append((fen,move,g["score"]))
        changed=0
        for key,visits in experiences.items():
            pos=chess.Board(visits[0][0])
            response=judge.play(pos,chess.engine.Limit(time=POST_SEC),game=("teacher",key))
            if response.move not in pos.legal_moves:raise AssertionError("Illegal learning target")
            choice=response.move.uci()
            if any(x[1]!=choice for x in visits):changed+=1
            book[key]={"uci":choice,"seen":len(visits),"training_choices":[x[1] for x in visits]}
        print("BOOK",len(book),"changed",changed,flush=True)
        for split,starts in (("seen",TRAIN),("unseen",UNSEEN)):
            for i,(name,pos) in enumerate(starts):
                for color in (chess.WHITE,chess.BLACK):
                    tag=(split,i,color)
                    first=s.play(pos,name,color,(a,b),(tag,"control"),SEC,limit=PLIES)
                    second=s.play(pos,name,color,(a,b),(tag,"adapted"),SEC,book=book,limit=PLIES)
                    first["split"]=second["split"]=split
                    first["adjudication_score_cp"]=assess(first,judge)
                    second["adjudication_score_cp"]=assess(second,judge)
                    controls.append(first);adapted.append(second)
                    print("EVAL",len(adapted),split,name,"control",first["result"],
                          "adapted",second["result"],"hits",second["book_hits"],
                          "terminal_cps",first["adjudication_score_cp"],
                          second["adjudication_score_cp"],flush=True)
    finally:
        for e in (a,b,judge):e.quit()
    def cp_deltas(indices):
        diff=[]
        for i in indices:
            x=controls[i]["adjudication_score_cp"]
            y=adapted[i]["adjudication_score_cp"]
            if x is not None and y is not None:diff.append(y-x)
        return {"n":len(diff),"mean":round(statistics.mean(diff),1) if diff else None,
                "median":round(statistics.median(diff),1) if diff else None,
                "positive":sum(x>0 for x in diff),"negative":sum(x<0 for x in diff)}
    report={
        "engine":title,"seconds_each_player":SEC,
        "training_games":s.summary(train),
        "offline_teacher_seconds_per_position":POST_SEC,
        "offline_teacher_positions":len(book),
        "offline_cpu_extra_budget":round(POST_SEC*len(book),1),
        "book_corrections":changed,
        "control":s.summary(controls),
        "adapted":s.summary(adapted),
        "seen":{"control":s.summary(controls[:4]),"adapted":s.summary(adapted[:4]),
                "terminal_evaluation_differences_cp":cp_deltas(range(4))},
        "unseen":{"control":s.summary(controls[4:]),"adapted":s.summary(adapted[4:]),
                  "terminal_evaluation_differences_cp":cp_deltas(range(4,8))},
        "elapsed_s":round(time.perf_counter()-start,1),
        "limitations":"Only 8 adapted test games and 8 matched controls at 1s; move cutoff 32, uncompleted games have separate 0.5s estimated terminal evaluations, not actual wins. Extra offline teacher compute gives candidate a preparation advantage; no statistically proven Elo gain.",
        "controls":controls,"adapted_games":adapted,"book":book
    }
    Path("selfplay_one_second.json").write_text(json.dumps(report,indent=2)+"\n")
    Path("selfplay_one_second.pgn").write_text("\n\n".join(
        [s.pgn(g,"One-second control") for g in controls]+
        [s.pgn(g,"One-second adapted") for g in adapted])+"\n")
    print("SUMMARY",json.dumps({k:v for k,v in report.items() if k not in
          ("controls","adapted_games","book")}),flush=True)

if __name__=="__main__":main()
