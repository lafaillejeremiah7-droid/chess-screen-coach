"""Reproducible decision-quality test on positions from actual FIDE tournament PGNs.

Independent evidence here is real game position selection and longer same-engine analysis.
This is NOT a tournament Elo test and deep Stockfish is not an infallible oracle.
"""
import hashlib
import io
import json
import random
import statistics
import time
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

import chess
import chess.engine
import chess.pgn
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server

SOURCE_COMMIT="5721c8a71a0f9850d54fe6d5b2d8060abcab1357"
SOURCES=[
 ("Chess_Candidates_and_Interzonals/Candidates2022.pgn",
  "2ff67698f28938850de0621d9adea8a23b229746"),
 ("Imense_Database_For _ChessEnigine/World_Chess_Champoinship/WorldChamp2018.pgn",
  "6737f278c167051483805fae91677d1ee6d54f3a"),
]
BUDGETS=(0.2,1.0,2.0)
REFERENCE_SECONDS=3.0
RESCORE_SECONDS=1.0
TARGET=60

def real_game_positions():
    pool=defaultdict(list)
    game_count=0
    for path,expected_blob in SOURCES:
        safe_path=urllib.parse.quote(path,safe="/")
        uri=f"https://raw.githubusercontent.com/mainali123/Chess-Dataset/{SOURCE_COMMIT}/{safe_path}"
        with urllib.request.urlopen(uri,timeout=30) as response:
            data=response.read()
        git_hash=hashlib.sha1(b"blob "+str(len(data)).encode()+bytes([0])+data).hexdigest()
        if git_hash!=expected_blob:
            raise RuntimeError(f"PGN content integrity check failed: {path}")
        stream=io.StringIO(data.decode("utf-8-sig",errors="replace"))
        while True:
            game=chess.pgn.read_game(stream)
            if game is None:break
            if game.errors:continue
            game_count+=1
            board=game.board()
            for ply,move in enumerate(game.mainline_moves(),1):
                board.push(move)
                if ply<8 or board.is_game_over() or not board.is_valid():
                    continue
                n=len(board.piece_map())
                if n<=14 and ply>=45:phase="endgame"
                elif ply<=25:phase="opening"
                else:phase="middlegame"
                pool[phase].append({
                  "fen":board.fen(),
                  "game":f"{game.headers.get('White','?')} vs {game.headers.get('Black','?')}",
                  "event":game.headers.get("Event",""),
                  "ply":ply,
                  "pieces":n,
                  "source":path,
                  "phase":phase
                })
    return pool,game_count

def choose(pool):
    rng=random.Random(20261116)
    selected=[]
    seen=set()
    for phase in ("opening","middlegame","endgame"):
        options=list(pool[phase])
        rng.shuffle(options)
        per_game=defaultdict(int)
        for p in options:
            if len([x for x in selected if x["phase"]==phase])>=20:break
            if p["fen"] in seen or per_game[p["source"]+"|"+p["game"]]>=3:continue
            selected.append(p);seen.add(p["fen"])
            per_game[p["source"]+"|"+p["game"]]+=1
    if len(selected)<TARGET:
        alternatives=[p for values in pool.values() for p in values]
        rng.shuffle(alternatives)
        for p in alternatives:
            if len(selected)>=TARGET:break
            if p["fen"] not in seen:
                selected.append(p);seen.add(p["fen"])
    if len(selected)!=TARGET:
        raise RuntimeError(f"Only {len(selected)} eligible real positions")
    rng.shuffle(selected)
    return selected

def normalized_loss(reference,candidate,turn):
    a=reference.pov(turn)
    b=candidate.pov(turn)
    if a.is_mate() or b.is_mate():
        return None
    # Values computed at different search budgets; this is approximate only.
    return round(min(500,max(0,(a.score()-b.score()))),1)

def benchmark():
    pool,games=real_game_positions()
    sample=choose(pool)
    output=[]
    engine=chess.engine.SimpleEngine.popen_uci(server.stockfish_location())
    name=engine.id.get("name","unknown")
    engine.configure({"Threads":1,"Hash":16})
    start=time.monotonic()
    try:
        for idx,item in enumerate(sample,1):
            board=chess.Board(item["fen"])
            quick={}
            for seconds in BUDGETS:
                r=engine.play(board,chess.engine.Limit(time=seconds),ponder=False,
                              info=chess.engine.INFO_ALL,game=(idx,seconds,"quick"))
                if r.move not in board.legal_moves:
                    raise RuntimeError("Agent returned illegal move")
                quick[seconds]=r
            ref=engine.analyse(board,chess.engine.Limit(time=REFERENCE_SECONDS),
                               game=(idx,"reference"))
            best=ref["pv"][0]
            if best not in board.legal_moves:
                raise RuntimeError("Reference returned illegal move")
            evaluations={}
            for seconds,result in quick.items():
                move=result.move
                if move==best:
                    evaluations[seconds]=0
                    continue
                forced=engine.analyse(
                    board,chess.engine.Limit(time=RESCORE_SECONDS),
                    root_moves=[move],game=(idx,seconds,"forced"))
                evaluations[seconds]=normalized_loss(ref["score"],forced["score"],board.turn)
            output.append({
                **item,"ref_uci":best.uci(),"ref_depth":ref.get("depth"),
                "decisions":{
                    str(seconds):{
                        "uci":quick[seconds].move.uci(),
                        "same_as_reference":quick[seconds].move==best,
                        "depth":quick[seconds].info.get("depth"),
                        "estimated_cp_loss":evaluations[seconds],
                        "mate_excluded":evaluations[seconds] is None,
                    }
                    for seconds in BUDGETS
                }
            })
            if idx%10==0:
                print("PROGRESS",idx,"/",len(sample),flush=True)
    finally:
        engine.quit()
    summary={}
    for seconds in BUDGETS:
        d=[x["decisions"][str(seconds)] for x in output]
        vals=[x["estimated_cp_loss"] for x in d if x["estimated_cp_loss"] is not None]
        summary[str(seconds)]={
            "agreement":sum(x["same_as_reference"] for x in d),
            "agreement_pct":round(100*sum(x["same_as_reference"] for x in d)/len(d),1),
            "mean_estimated_cp_loss":round(statistics.mean(vals),1) if vals else None,
            "median_estimated_cp_loss":round(statistics.median(vals),1) if vals else None,
            "loss_over_50":sum(x>50 for x in vals),
            "loss_over_100":sum(x>100 for x in vals),
            "mate_excluded":sum(x["mate_excluded"] for x in d),
        }
    report={
        "engine":name,
        "source_commit":SOURCE_COMMIT,
        "sources":[s[0] for s in SOURCES],
        "source_games_parsed":games,
        "sample_count":len(sample),
        "phase_counts":{phase:sum(x["phase"]==phase for x in output)
                        for phase in ("opening","middlegame","endgame")},
        "quick_seconds":list(BUDGETS),
        "reference_seconds":REFERENCE_SECONDS,
        "forced_rescore_seconds":RESCORE_SECONDS,
        "one_thread_hash_mib":16,
        "duration_s":round(time.monotonic()-start,1),
        "statistics":summary,
        "limitations":"Single-run same-engine comparison, 3s reference not ground truth, one machine, no ELO or win-rate claims.",
        "positions":output
    }
    Path("decision_quality_real_games.json").write_text(json.dumps(report,indent=2)+chr(10))
    print("RESULT",json.dumps({k:v for k,v in report.items() if k!="positions"}),flush=True)
    print("EXAMPLES",json.dumps(sorted(output,key=lambda x:(x["decisions"]["0.2"]["estimated_cp_loss"] or 0),reverse=True)[:5]),flush=True)

if __name__=="__main__":benchmark()
