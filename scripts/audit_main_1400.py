"""Audit main coach move strength against Stockfish 19 reference configurations.

The experiment verifies the real server.analyze_fen() pathway at 1s/move.
This is a comparative move-quality check, NOT an absolute 1400 Elo rating test:
the UCI_Elo scale is engine-calibrated at a different time control, and no
external human-calibrated opponent pool participates in this experiment.
"""
from __future__ import annotations

import argparse
import json
import random
from collections import Counter, defaultdict
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))

import chess
import chess.engine
import server
from training import position_bank


def sample_positions(amount: int, seed: int) -> list[dict]:
    if amount < 6 or amount > 200:
        raise ValueError("Choose between 6 and 200 audit positions")
    rng=random.Random(seed)
    groups=defaultdict(list)
    for record in position_bank():
        groups[record["theme"]].append(record)
    selected=[]
    selected_ids=set()
    # Take representative tactics, endgames, openings and strategy samples
    # before filling the balance across the full position bank.
    for theme in ("opening","tactics","strategy","endgame","check_evasion"):
        available=groups.get(theme, [])
        n=min(len(available),max(1,amount//8),amount-len(selected))
        for record in rng.sample(available,n):
            selected.append(record)
            selected_ids.add(record["id"])
    remaining=[r for records in groups.values() for r in records if r["id"] not in selected_ids]
    selected+=rng.sample(remaining,amount-len(selected))
    rng.shuffle(selected)
    return selected


def valid_move(board: chess.Board, move: chess.Move | None, label: str) -> str:
    if move is None or move not in board.legal_moves:
        raise RuntimeError(f"Invalid {label} recommendation for {board.fen()}")
    return move.uci()


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--positions",type=int,default=24)
    parser.add_argument("--seconds",type=float,default=1.0)
    parser.add_argument("--seed",type=int,default=1400)
    parser.add_argument("--output",default="main_1400_strength_audit.json")
    args=parser.parse_args()
    if args.seconds != server.ANALYSIS_SECONDS:
        raise ValueError("Audit must use the actual 1-second main-coach default")
    if server.MAIN_COACH_ELO != 1400:
        raise RuntimeError("The main-coach configured Elo is not 1400")
    records=sample_positions(args.positions,args.seed)
    path=server.stockfish_location()
    server.coach_control(False)
    server.ANALYSIS_CACHE.clear()
    output=[]
    try:
        with chess.engine.SimpleEngine.popen_uci(path) as main_engine, \
             chess.engine.SimpleEngine.popen_uci(path) as engine2200, \
             chess.engine.SimpleEngine.popen_uci(path) as full_engine:
            for engine in (main_engine,engine2200,full_engine):
                if not server.is_stockfish19_name(engine.id.get("name")):
                    raise RuntimeError("Stockfish 19 is required for every opponent")
            server.configure_main_engine(main_engine)
            engine2200.configure({"Threads":1,"Hash":16,"UCI_LimitStrength":True,"UCI_Elo":2200})
            full_engine.configure({"Threads":1,"Hash":16,"UCI_LimitStrength":False})
            server.ENGINE=main_engine
            for n,record in enumerate(records,start=1):
                board=chess.Board(record["fen"])
                response=server.analyze_fen(board.fen(),args.seconds)
                main_move=valid_move(board,chess.Move.from_uci(
                    response["from"]+response["to"]+
                    ("q" if "promote to queen" in response["instruction"] else
                     "r" if "promote to rook" in response["instruction"] else
                     "b" if "promote to bishop" in response["instruction"] else
                     "n" if "promote to knight" in response["instruction"] else "")),
                    "main")
                stronger=engine2200.play(board,chess.engine.Limit(time=args.seconds),
                                        ponder=False)
                full=full_engine.play(board,chess.engine.Limit(time=args.seconds),
                                      ponder=False)
                other_move=valid_move(board,stronger.move,"2200")
                top_move=valid_move(board,full.move,"unrestricted")
                item={"id":record["id"],"theme":record["theme"],"fen":board.fen(),
                      "main_1400":main_move,"uci_2200":other_move,
                      "unrestricted":top_move,"same_as_full":main_move==top_move,
                      "uci_2200_same_as_full":other_move==top_move,
                      "main_same_as_2200":main_move==other_move}
                output.append(item)
                print(f"{n}/{len(records)} {record['theme']}: "
                      f"1400={main_move} 2200={other_move} unlimited={top_move}",
                      flush=True)
    finally:
        server.ENGINE=None
        server.ANALYSIS_CACHE.clear()
    n=len(output)
    count=lambda key:sum(1 for r in output if r[key])
    themes=dict(Counter(r["theme"] for r in output))
    result={
        "note":"COMPARATIVE TEST ONLY: No absolute Elo or human 1400 calibration is established.",
        "engine":"Stockfish 19",
        "tested_main_analysis_pathway":True,
        "main_uci_elo":server.MAIN_COACH_ELO,
        "main_limited_strength":True,
        "reference_limited_elo":2200,
        "unrestricted_reference":True,
        "seconds_per_move_each":args.seconds,
        "positions":n,
        "position_themes":themes,
        "main_1400_agreed_with_unrestricted":count("same_as_full"),
        "main_1400_differed_from_unrestricted":n-count("same_as_full"),
        "uci_2200_agreed_with_unrestricted":count("uci_2200_same_as_full"),
        "uci_2200_differed_from_unrestricted":n-count("uci_2200_same_as_full"),
        "main_1400_agreed_with_2200":count("main_same_as_2200"),
        "limitations":[
            "Move-agreement is not an Elo rating.",
            "The sample is small and generated from the project's practice positions.",
            "UCI Elo is calibrated on a separate engine-rating scale and different time controls.",
            "No statistically reliable human, FIDE, or Chess.com rating is established.",
        ],
        "records":output,
    }
    Path(args.output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    print("AUDIT_SUMMARY",json.dumps({k:v for k,v in result.items() if k!="records"}),flush=True)


if __name__=="__main__":
    main()
