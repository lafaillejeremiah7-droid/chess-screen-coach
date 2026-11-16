"""Build an unchanged and an experimental Stockfish 19 from identical source.

Experiment: reduce LMR by one ply for later quiet checking moves in non-root
nodes at depth >= 5. This is not an established playing-strength improvement.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / ".stockfish" / "research"
SOURCE = RESEARCH / "Stockfish-source"
TAG = "sf_19"
SOURCE_SHA = "edb0d9db6731067ec50ce619ff372b463bc4dd5d"
ANCHOR = "        // Apply the computed LMR\n        if (depth >= 2 && moveCount > 1)\n"
PATCH = (
    "        // Experiment only: search late quiet checking moves one ply deeper.\n"
    "        // Hypothesis: tactical stability may outweigh additional nodes.\n"
    "        if (!rootNode && depth >= 5 && moveCount > 2 && givesCheck && !capture)\n"
    "            r -= 1024;\n\n"
    + ANCHOR
)


def call(*args: str) -> None:
    subprocess.run(args, check=True)


def fingerprint(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def edit_search_file(search: Path) -> None:
    original = search.read_text(encoding="utf-8")
    if original.count(ANCHOR) != 1 or PATCH in original:
        raise RuntimeError("Unexpected upstream search.cpp: refusing to modify it")
    search.write_text(original.replace(ANCHOR, PATCH), encoding="utf-8")


def build(clean: bool = False, jobs: int = 2) -> dict:
    if jobs < 1 or jobs > 8:
        raise ValueError("Use 1 to 8 compilation jobs")
    if clean and SOURCE.exists():
        shutil.rmtree(SOURCE)
    if SOURCE.exists():
        raise RuntimeError("Source directory already exists; pass --clean to rebuild from pinned tag")
    RESEARCH.mkdir(parents=True, exist_ok=True)
    call("git", "clone", "--depth", "1", "--branch", TAG,
         "https://github.com/official-stockfish/Stockfish.git", str(SOURCE))
    actual = subprocess.check_output(["git", "-C", str(SOURCE), "rev-parse", "HEAD"], text=True).strip()
    if actual != SOURCE_SHA:
        raise RuntimeError(f"Unexpected upstream revision {actual}; expected {SOURCE_SHA}")
    src = SOURCE / "src"
    call("make", "-C", str(src), "net")
    command = ("make", "-C", str(src), f"-j{jobs}", "build", "ARCH=x86-64")
    call(*command)
    baseline = RESEARCH / "stockfish19-baseline"
    candidate = RESEARCH / "stockfish19-check-lmr"
    shutil.copy2(src / "stockfish", baseline)

    edit_search_file(src / "search.cpp")
    call(*command)
    shutil.copy2(src / "stockfish", candidate)
    if fingerprint(baseline) == fingerprint(candidate):
        raise RuntimeError("Candidate binary identical to baseline; patch may not have compiled")
    for engine in (baseline, candidate):
        output = subprocess.run([str(engine)], input="uci\nquit\n",
                                text=True, capture_output=True, check=True, timeout=15)
        if "id name Stockfish 19" not in output.stdout:
            raise RuntimeError(f"Unexpected engine identity for {engine}")
    report = {
        "upstream": f"official-stockfish/Stockfish@{SOURCE_SHA}",
        "experiment": "late quiet checks: LMR reduced by 1024 (one ply) at non-root depth>=5, moveCount>2",
        "baseline": str(baseline),
        "baseline_sha256": fingerprint(baseline),
        "candidate": str(candidate),
        "candidate_sha256": fingerprint(candidate),
        "disclaimer": "No evidence of increased Elo until adequately powered head-to-head games",
    }
    (RESEARCH / "build_metadata.json").write_text(json.dumps(report, indent=2) + "\n")
    print("BUILD SUMMARY", json.dumps(report), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--clean", action="store_true", help="Replace previous experimental source checkout")
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    build(clean=args.clean, jobs=args.jobs)
