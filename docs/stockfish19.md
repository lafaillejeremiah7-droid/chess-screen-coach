# Stockfish 19: installation and optional testing

The main bot uses the official **Stockfish 19** binary installed locally under `.stockfish/bin/stockfish`. A system `apt install stockfish` does not guarantee the correct version.

## Install and verify

From the updated repository root, with a Python environment created and dependencies installed:

```bash
.venv/bin/python scripts/check_stockfish19_ready.py --install
```

The installer selects a supported Linux release, validates its pinned SHA-256 checksum, checks the engine's UCI identity, and installs it without committing binaries. The readiness script verifies a legal one-second move. `STOCKFISH_PATH` can specify an existing Stockfish 19 executable.

Restart `server.py` after changing the executable. The health endpoint `http://127.0.0.1:8765/api/health` exposes `stockfish19`, `default_elo`, and `default_seconds`.

The **main coach** uses an approximate 1400 UCI Elo setting; the separate sparring game offers independently selected strength levels. Neither setting is an independently certified rating.

## Optional controlled engine A/B tests

Use this only if you have two distinct UCI engine executables and want to compare them:

```bash
.venv/bin/python scripts/compare_engines.py --baseline .stockfish/bin/stockfish --candidate /path/to/candidate --games 20 --seconds 1 --output engine_ab_report.json
```

The script swaps colors across paired openings, reports incomplete games separately, and produces a JSON summary. Small samples cannot support Elo or superiority claims. The engine version and hardware/time controls must be stated with any comparison.

Official Stockfish 19 release: https://github.com/official-stockfish/Stockfish/releases/tag/sf_19

Stockfish is distributed under GPL-3.0. Redistributing modified engines requires compliance with its licensing terms.
