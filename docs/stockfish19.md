# Stockfish 19 upgrade and controlled experiments

The current official stable release is **Stockfish 19** (GitHub tag `sf_19`, September 5, 2026). The repository originally used whichever Stockfish version `apt install stockfish` provided, which does **not** guarantee version 19.

## Install on your Chromebook (Linux terminal)

From the **updated** `chess-screen-coach` checkout:

```bash
python3 scripts/install_stockfish19.py
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py
```

If the repository has not yet been cloned:

```bash
git clone https://github.com/lafaillejeremiah7-droid/chess-screen-coach.git
cd chess-screen-coach
```

If you are testing the feature branch, switch to `feature/stockfish19-baseline-ab` first. Run `git fetch origin` before switching to it.

The installer selects the correct official Linux universal release for x86_64, aarch64 or riscv64, verifies the published SHA-256 digest, and checks the executable's UCI version **before** replacing an existing binary. It installs to `.stockfish/bin/stockfish`, which the Python server prefers over an older system package. `STOCKFISH_PATH` continues to override the path explicitly. The existing one-second default, thread limit and RAM-conscious 16 MiB hash remain unchanged.

Verify with:

```bash
printf 'uci\nquit\n' | .stockfish/bin/stockfish | grep '^id name '
curl -s http://127.0.0.1:8765/api/health
```

The release is about 80 MB compressed. GitHub Actions does not install software on your Chromebook; you must run the installer there. Do not commit the binaries to Git.

## Actual engine experiment: paired A/B tests

The *baseline* is the pinned Stockfish 19 binary. A different executable is the *candidate* (a later patched and compiled search-engine build). Do not label a change stronger until it passes match testing.

```bash
.venv/bin/python scripts/compare_engines.py \
  --baseline .stockfish/bin/stockfish \
  --candidate /path/to/compiled-candidate-stockfish \
  --games 20 --seconds 1 --output engine_ab_report.json
```

The script plays each opening twice with colors swapped, uses one thread and 16 MiB hash for each engine, gives each move the same thinking time, tracks incomplete games separately, and produces a JSON report. This is **not** a million-game run, nor evidence of an Elo gain by itself. Small differences need a much larger statistically sound test, preferably official Fishtest-style SPRT.

Next research candidate: a narrowly scoped **threat-sensitive late-move reduction** modification to Stockfish's C++ search. It must be compared against the unmodified engine at the same time limit and hardware. The baseline build is *not* modified in this change.

Stockfish license: GPL-3.0. If distributing a modified executable, comply with its source and license obligations.

Official release: https://github.com/official-stockfish/Stockfish/releases/tag/sf_19
