"""Verify Stockfish 19 is installed AND can calculate a legal move locally.

Run from the repository folder:
    .venv/bin/python scripts/check_stockfish19_ready.py
To install or repair the pinned official binary first:
    .venv/bin/python scripts/check_stockfish19_ready.py --install

This verifies Linux engine execution, not the Chrome extension's installation.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import chess
import chess.engine
import server


def check_ready(engine_path: str | None = None, seconds: float = 1.0) -> dict:
    """Test the actual backend engine identity, configuration and legal move."""
    path = engine_path or server.stockfish_location()
    board = chess.Board()
    with chess.engine.SimpleEngine.popen_uci(path) as engine:
        name = engine.id.get("name")
        if not server.is_stockfish19_name(name):
            raise RuntimeError(
                f"NOT READY: expected Stockfish 19 but found {name!r}. "
                "Run scripts/install_stockfish19.py first.")
        engine.configure({"Threads": 1, "Hash": 16})
        start = time.monotonic()
        result = engine.play(
            board, chess.engine.Limit(time=seconds),
            ponder=False, info=chess.engine.INFO_ALL)
        elapsed = time.monotonic() - start
        if result.move not in board.legal_moves:
            raise RuntimeError("NOT READY: engine failed to return a legal move")
        return {
            "ready": True,
            "engine": name,
            "executable": str(Path(path).resolve()),
            "default_seconds": server.ANALYSIS_SECONDS,
            "tested_seconds": seconds,
            "measured_wall_seconds": round(elapsed, 3),
            "threads": 1,
            "hash_mib": 16,
            "test_fen": board.fen(),
            "bestmove": result.move.uci(),
            "depth": result.info.get("depth"),
            "nodes": result.info.get("nodes"),
            "extension_installed": "unverified: inspect chrome://extensions on this Chromebook",
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--install", action="store_true",
        help="Install/repair official checksum-verified Stockfish 19 before checking")
    args = parser.parse_args()
    try:
        if args.install:
            from scripts.install_stockfish19 import install
            path = str(install())
        else:
            path = None
        result = check_ready(path)
    except Exception as error:
        print(json.dumps({
            "ready": False,
            "error": str(error),
            "next_step": (
                "In the repository folder run: "
                ".venv/bin/python scripts/check_stockfish19_ready.py --install"
            ),
        }, indent=2))
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
