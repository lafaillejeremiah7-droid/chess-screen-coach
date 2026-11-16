"""Resumable, terminal-outcome Stockfish campaign. Never imports the live server.

20% training, 40% frozen controls, 40% adapted-vs-frozen tests. Games with
cutoffs/errors do not satisfy a target slot. All results and moves are in SQLite.
"""
import argparse
import concurrent.futures
import contextlib
import fcntl
import hashlib
import json
import math
import multiprocessing
import os
from pathlib import Path
import random
import shutil
import signal
import sqlite3
import statistics
import sys
import time

import chess
import chess.engine

SCHEMA = 1
STARTS = (
    ("Italian", "e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6"),
    ("Ruy Lopez", "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6"),
    ("Sicilian", "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6"),
    ("Caro Kann", "e4 c6 d4 d5 Nc3 dxe4 Nxe4 Bf5"),
    ("Queens Gambit", "d4 d5 c4 e6 Nc3 Nf6 Bg5 Be7"),
    ("Kings Indian", "d4 Nf6 c4 g6 Nc3 Bg7 e4 d6"),
    ("English", "c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5"),
    ("London", "d4 Nf6 Nf3 d5 Bf4 e6 e3 Bd6"),
    ("French", "e4 e6 d4 d5 Nc3 Nf6 Bg5 Be7"),
    ("Scotch", "e4 e5 Nf3 Nc6 d4 exd4 Nxd4 Bc5"),
    ("Candidates endgame", "8/5R2/2k5/2p1b3/p3N3/2P4r/3K4/8 b - - 3 61"),
    ("Candidates middlegame", "5r2/1b2q1k1/p2p1p1p/P1p3p1/4P3/2BP3P/1P3QP1/5RK1 w - - 0 41"),
)
_ENGINES = []
_STOP = False
_STOP_EVENT = None


def connect(path):
    db = sqlite3.connect(path, timeout=120)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA synchronous=FULL")
    return db


def position_key(board):
    # Include the halfmove clock; the old four-field key discarded 50-move context.
    return " ".join(board.fen().split()[:5])


def seed_for(*parts):
    return int.from_bytes(hashlib.sha256(json.dumps(parts).encode()).digest()[:8], "big")


def make_start(split, pair, seed):
    rng = random.Random(seed_for(seed, split, pair))
    pool = STARTS[:6] if split in ("training", "seen") else STARTS[6:]
    name, text = pool[rng.randrange(len(pool))]
    if "/" in text:
        board = chess.Board(text)
    else:
        board = chess.Board()
        for san in text.split():
            board.push_san(san)
    # Seeded legal perturbations diversify trajectories. They are NOT rated or
    # engine-balanced openings; matched colors and controls share the exact start.
    for _ in range(2):
        moves = sorted(board.legal_moves, key=lambda m: m.uci())
        rng.shuffle(moves)
        for move in moves:
            board.push(move)
            if not board.is_game_over(claim_draw=True):
                break
            board.pop()
        else:
            break
    if not board.is_valid() or board.is_game_over(claim_draw=True):
        raise ValueError("Invalid/non-playable starting position")
    return name, board.fen()


def task_spec(slot, config):
    train = config["training_games"]
    if slot < train:
        return {"slot": slot, "phase": "training", "split": "training",
                "pair": slot // 2, "agent_white": slot % 2 == 0, "adapted": True}
    group, offset = divmod(slot - train, 8)
    split = "seen" if offset < 4 else "unseen"
    offset %= 4
    # Counterbalance whether the candidate/control is played first.
    adapted = bool((offset % 2) ^ (group % 2))
    return {"slot": slot, "phase": "evaluation", "split": split,
            "pair": group, "agent_white": offset < 2, "adapted": adapted}


def init_db(path, config):
    db = connect(path)
    db.executescript("""
      CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS games (
        slot INTEGER PRIMARY KEY, phase TEXT NOT NULL, split TEXT NOT NULL,
        pair_id INTEGER NOT NULL, agent_white INTEGER NOT NULL, adapted INTEGER NOT NULL,
        result TEXT NOT NULL, score REAL NOT NULL, plies INTEGER NOT NULL,
        book_hits INTEGER NOT NULL, elapsed REAL NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pending (slot INTEGER PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rejected (
        slot INTEGER NOT NULL, attempt INTEGER NOT NULL, reason TEXT NOT NULL,
        record TEXT NOT NULL, PRIMARY KEY(slot,attempt));
      CREATE TABLE IF NOT EXISTS book (
        position TEXT PRIMARY KEY, uci TEXT NOT NULL, source_slot INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS games_phase ON games(phase);
    """)
    stored = db.execute("SELECT value FROM metadata WHERE key='config'").fetchone()
    if stored and json.loads(stored[0]) != config:
        raise ValueError("Checkpoint configuration differs; use the original settings or a new output directory")
    with db:
        db.execute("INSERT OR IGNORE INTO metadata VALUES ('config',?)", (json.dumps(config, sort_keys=True),))
    return db


def binary_identity(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    with chess.engine.SimpleEngine.popen_uci(path) as eng:
        return {"name": eng.id.get("name", "unknown"), "sha256": digest.hexdigest()}


def init_worker(engine_path, stop_event=None):
    global _ENGINES, _STOP_EVENT
    _STOP_EVENT = stop_event
    # The coordinator handles graceful cancellation and stops scheduling. A
    # worker yields at its deadline and stores its in-progress move history.
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    _ENGINES = [chess.engine.SimpleEngine.popen_uci(engine_path) for _ in range(3)]
    for engine in _ENGINES:
        engine.configure({"Threads": 1, "Hash": 16})
    # multiprocessing finalizers run before Python joins python-chess's
    # non-daemon protocol threads. Plain atexit cleanup deadlocks on shutdown.
    from multiprocessing.util import Finalize
    Finalize(None, close_engines, exitpriority=10)


def must_pause(deadline):
    return time.monotonic() >= deadline or (_STOP_EVENT is not None and _STOP_EVENT.is_set())


def close_engines():
    for eng in _ENGINES:
        with contextlib.suppress(Exception):
            eng.quit()


def save_pending(db, slot, record):
    with db:
        db.execute("INSERT OR REPLACE INTO pending VALUES (?,?)", (slot, json.dumps(record)))


def finish_game(db, spec, record, updates):
    # Result, teacher corrections and pending deletion are ONE transaction.
    # A retry cannot add a result twice or lose its associated learning update.
    with db:
        existing = db.execute("SELECT 1 FROM games WHERE slot=?", (spec["slot"],)).fetchone()
        if existing:
            return False
        db.execute("INSERT INTO games VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            spec["slot"], spec["phase"], spec["split"], spec["pair"],
            int(spec["agent_white"]), int(spec["adapted"]), record["result"],
            record["score"], len(record["moves"]), record["book_hits"],
            record["elapsed"], json.dumps(record)))
        if spec["phase"] != "training" and updates:
            raise ValueError("Evaluation cannot update the learned book")
        for key, uci in updates:
            db.execute("INSERT OR IGNORE INTO book VALUES (?,?,?)", (key, uci, spec["slot"]))
        db.execute("DELETE FROM pending WHERE slot=?", (spec["slot"],))
    return True


def run_game(db_path, config, spec, deadline):
    db = connect(db_path)
    slot = spec["slot"]
    try:
        if db.execute("SELECT 1 FROM games WHERE slot=?", (slot,)).fetchone():
            return "already_complete"
        prior = db.execute("SELECT record FROM pending WHERE slot=?", (slot,)).fetchone()
        if prior:
            record = json.loads(prior[0])
        else:
            attempts = db.execute("SELECT count(*) FROM rejected WHERE slot=?", (slot,)).fetchone()[0]
            if attempts >= 3:
                raise RuntimeError(f"Slot {slot} failed three times; inspect rejected games before continuing")
            name, fen = make_start(spec["split"], spec["pair"], config["seed"])
            record = {"slot": slot, "attempt": attempts, "start": name, "start_fen": fen,
                      "moves": [], "book_hits": 0, "elapsed": 0.0,
                      "observations": [], "teacher_updates": [], "teacher_checked": 0}
        board = chess.Board(record["start_fen"])
        for uci in record["moves"]:
            board.push_uci(uci)
        began = time.monotonic()
        for eng in _ENGINES:
            eng.configure({"Clear Hash": None})
        tag = object()
        outcome = board.outcome(claim_draw=True)
        while outcome is None:
            if must_pause(deadline):
                record["elapsed"] += time.monotonic() - began
                save_pending(db, slot, record)
                return "paused"
            if len(record["moves"]) >= config["max_plies"]:
                record["elapsed"] += time.monotonic() - began
                with db:
                    db.execute("INSERT INTO rejected VALUES (?,?,?,?)", (
                        slot, record["attempt"], "move_limit_unfinished", json.dumps(record)))
                    db.execute("DELETE FROM pending WHERE slot=?", (slot,))
                return "censored"
            own_turn = board.turn == spec["agent_white"]
            move = None
            if own_turn and spec["adapted"] and len(record["moves"]) < 12:
                learned = db.execute("SELECT uci FROM book WHERE position=?", (position_key(board),)).fetchone()
                if learned:
                    trial = chess.Move.from_uci(learned[0])
                    if trial in board.legal_moves:
                        move = trial
                        record["book_hits"] += 1
            if move is None:
                eng = _ENGINES[0 if own_turn else 1]
                move = eng.play(board, chess.engine.Limit(time=config["seconds"]),
                                game=tag, ponder=False).move
            if move not in board.legal_moves:
                raise RuntimeError(f"Illegal move in slot {slot}")
            if spec["phase"] == "training" and own_turn and len(record["moves"]) < 12:
                record["observations"].append(len(record["moves"]))
            record["moves"].append(move.uci())
            board.push(move)
            outcome = board.outcome(claim_draw=True)
            if len(record["moves"]) % 8 == 0:
                now = time.monotonic()
                record["elapsed"] += now - began
                began = now
                save_pending(db, slot, record)
        record["result"] = ("draw" if outcome.winner is None else
                            "agent1_win" if outcome.winner == spec["agent_white"] else "agent2_win")
        record["score"] = 0.5 if outcome.winner is None else float(outcome.winner == spec["agent_white"])
        record["termination"] = outcome.termination.name
        # All selected training positions are from completed games. Evaluations
        # never produce learning targets, even on a resumed campaign.
        if spec["phase"] == "training":
            choices = record["observations"][:]
            random.Random(seed_for(config["seed"], slot, "teacher")).shuffle(choices)
            choices = choices[:config["teacher_positions_per_game"]]
            for index in range(record["teacher_checked"], len(choices)):
                if must_pause(deadline):
                    record["elapsed"] += time.monotonic() - began
                    save_pending(db, slot, record)
                    return "paused"
                position = chess.Board(record["start_fen"])
                for uci in record["moves"][:choices[index]]:
                    position.push_uci(uci)
                key = position_key(position)
                if not db.execute("SELECT 1 FROM book WHERE position=?", (key,)).fetchone():
                    answer = _ENGINES[2].play(position, chess.engine.Limit(time=config["teacher_seconds"]),
                                              game=object(), ponder=False).move
                    if answer not in position.legal_moves:
                        raise RuntimeError("Illegal teacher move")
                    record["teacher_updates"].append([key, answer.uci()])
                record["teacher_checked"] = index + 1
        record["elapsed"] += time.monotonic() - began
        finish_game(db, spec, record, record["teacher_updates"])
        return "completed"
    finally:
        db.close()


def paired_summary(db):
    # Independent units are mirrored starting-position groups, NOT individual
    # white/black games. Only complete control/candidate color pairs contribute.
    answer = {}
    for split in ("seen", "unseen"):
        groups = db.execute("""
          SELECT pair_id, SUM(CASE WHEN adapted=1 THEN score ELSE -score END)/2.0
          FROM games WHERE phase='evaluation' AND split=?
          GROUP BY pair_id HAVING COUNT(*)=4 ORDER BY pair_id
        """, (split,)).fetchall()
        vals = [r[1] for r in groups]
        delta = statistics.mean(vals) if vals else None
        interval = None
        if len(vals) >= 30:
            margin = 1.96 * statistics.stdev(vals) / math.sqrt(len(vals))
            interval = [max(-1.0, delta-margin), min(1.0, delta+margin)]
        answer[split] = {"complete_color_groups": len(vals), "candidate_minus_control_score": delta,
                         "approximate_95_percent_group_interval": interval}
    return answer


def status(db, config):
    groups = []
    for row in db.execute("""SELECT phase,split,adapted,count(*),
          sum(result='agent1_win'),sum(result='agent2_win'),sum(result='draw'),
          avg(score),avg(plies),sum(book_hits) FROM games GROUP BY phase,split,adapted"""):
        groups.append(dict(zip(("phase","split","adapted","completed","agent1_wins",
                                "agent2_wins","draws","score","mean_plies","book_hits"), row)))
    completed = sum(g["completed"] for g in groups)
    return {"target": config["games"], "completed": completed,
            "remaining": config["games"]-completed,
            "state": "complete" if completed == config["games"] else "incomplete",
            "pending": db.execute("SELECT count(*) FROM pending").fetchone()[0],
            "unfinished_attempts": db.execute("SELECT count(*) FROM rejected").fetchone()[0],
            "learned_positions": db.execute("SELECT count(*) FROM book").fetchone()[0],
            "groups": groups, "paired_comparison": paired_summary(db), "config": config,
            "limitations": [
                "One million is a target until completed equals target.",
                "Training uses extra offline teacher compute; Stockfish neural weights do not change.",
                "Seen/unseen refer to six opening/start families each, not representative human play.",
                "Seeded random legal opening perturbations can be unbalanced; results are narrowly scoped.",
                "Claims of draw use python-chess claim_draw=True; no evaluation-based adjudications.",
                "Interrupted games resume from saved moves; engine hash and wall-clock searches are not reproducible.",
                "Repeated starts/trajectories are possible; a million games does not mean a million unique games.",
                "Only a final frozen held-out comparison can support an improvement claim; no human Elo estimate."]}


def write_status(path, report):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(report, indent=2)+"\n")
    temp.replace(path)


def run_campaign(db_path, config, engine_path, workers, max_seconds, stop_after=None):
    global _STOP
    _STOP = False
    db = init_db(db_path, config)
    deadline = time.monotonic() + max_seconds
    start_count = db.execute("SELECT count(*) FROM games").fetchone()[0]
    last_print = 0
    try:
        ctx = multiprocessing.get_context("spawn")
        stop_event = ctx.Event()
        with concurrent.futures.ProcessPoolExecutor(max_workers=workers, mp_context=ctx,
                initializer=init_worker, initargs=(engine_path,stop_event)) as pool:
            for low, high in ((0, config["training_games"]), (config["training_games"], config["games"])):
                cursor = low
                active = {}
                retry = []
                while True:
                    if _STOP:
                        stop_event.set()
                    finished_count = db.execute("SELECT count(*) FROM games").fetchone()[0]
                    allowed = not _STOP and time.monotonic() < deadline
                    if stop_after is not None and finished_count-start_count >= stop_after:
                        allowed = False
                    while allowed and len(active) < workers:
                        if stop_after is not None and finished_count-start_count+len(active) >= stop_after:
                            break
                        if retry:
                            slot = retry.pop(0)
                        else:
                            slot = cursor
                            cursor += 1
                        if slot >= high:
                            break
                        if db.execute("SELECT 1 FROM games WHERE slot=?", (slot,)).fetchone():
                            continue
                        future = pool.submit(run_game, str(db_path), config, task_spec(slot,config), deadline)
                        active[future] = slot
                    if not active:
                        break
                    done, _ = concurrent.futures.wait(active, timeout=1,
                        return_when=concurrent.futures.FIRST_COMPLETED)
                    for future in done:
                        slot = active.pop(future)
                        result = future.result()
                        if result == "censored":
                            retry.append(slot)
                    now = time.monotonic()
                    if now-last_print >= 20 or done:
                        report = status(db, config)
                        write_status(Path(db_path).with_name("summary.json"), report)
                        print(json.dumps({k:report[k] for k in ("completed","target","pending","unfinished_attempts","learned_positions")}), flush=True)
                        last_print = now
                phase_done = db.execute("SELECT count(*) FROM games WHERE slot>=? AND slot<?", (low,high)).fetchone()[0]
                if phase_done != high-low:
                    break
        report = status(db, config)
        write_status(Path(db_path).with_name("summary.json"), report)
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        return report
    finally:
        db.close()


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--games", type=int, default=1_000_000)
    p.add_argument("--seconds", type=float, default=1.0)
    p.add_argument("--teacher-seconds", type=float, default=1.5)
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--max-seconds", type=float, default=10800)
    p.add_argument("--stop-after", type=int)
    p.add_argument("--max-plies", type=int, default=1024)
    p.add_argument("--seed", type=int, default=20261116)
    p.add_argument("--output", type=Path, default=Path("campaign"))
    p.add_argument("--engine", default=os.environ.get("STOCKFISH_PATH"))
    p.add_argument("--status", action="store_true")
    return p


def main():
    args = parser().parse_args()
    if args.games < 10 or args.games % 10:
        raise SystemExit("--games must be a positive multiple of 10")
    if not 0 < args.seconds <= 10 or not args.seconds <= args.teacher_seconds <= 60:
        raise SystemExit("Invalid search budget")
    if args.workers < 1 or args.workers > (os.cpu_count() or 1):
        raise SystemExit("--workers must be between 1 and available logical CPUs")
    if args.max_seconds <= 0 or args.max_plies < 1 or (args.stop_after is not None and args.stop_after < 1):
        raise SystemExit("Invalid stopping limit")
    args.output.mkdir(parents=True, exist_ok=True)
    path = args.output / "campaign.sqlite3"
    if args.status:
        if not path.exists():
            raise SystemExit("No checkpoint exists")
        with contextlib.closing(connect(path)) as db:
            config = json.loads(db.execute("SELECT value FROM metadata WHERE key='config'").fetchone()[0])
            print(json.dumps(status(db,config), indent=2))
        return
    eng_path = args.engine or shutil.which("stockfish") or "/usr/games/stockfish"
    identity = binary_identity(eng_path)
    config = {"schema":SCHEMA,"games":args.games,"training_games":args.games//5,
              "seconds":args.seconds,"teacher_seconds":args.teacher_seconds,
              "teacher_positions_per_game":2,"seed":args.seed,"max_plies":args.max_plies,
              "threads_per_engine":1,"hash_mib":16,"engine":identity}
    def stop(signum, frame):
        global _STOP
        _STOP = True
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    with open(args.output / "campaign.lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("This checkpoint already has an active coordinator")
        report = run_campaign(path, config, eng_path, args.workers, args.max_seconds, args.stop_after)
    print(json.dumps({k:report[k] for k in ("state","target","completed","remaining")}), flush=True)


if __name__ == "__main__":
    main()
