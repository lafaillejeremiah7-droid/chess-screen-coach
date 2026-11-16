# Experiment 001 — Protect late quiet checks from aggressive LMR

**Baseline:** pristine Stockfish 19 source, tag `sf_19`, commit `edb0d9db6731067ec50ce619ff372b463bc4dd5d`.

**Candidate:** same source/compiler/build architecture, with exactly one search change applied to `src/search.cpp` just before late-move reductions are applied:

```cpp
if (!rootNode && depth >= 5 && moveCount > 2 && givesCheck && !capture)
    r -= 1024;
```

Stockfish's reduction value is scaled in units of 1024. This aims to search late *quiet checking moves* one ply deeper. It could strengthen tactical detection but could also waste nodes and reduce strength; **no advantage is assumed**. It is deliberately absent from the main working coach.

## Build both engines

```bash
python3 scripts/build_sf19_check_lmr.py
```

Requires Linux, git, make, C++20 compiler, and network access for the official NNUE network. This verifies the upstream commit, clones pristine source, builds the baseline, makes the single targeted edit, and rebuilds the candidate with identical settings.

Engine paths:

- `.stockfish/research/stockfish19-baseline`
- `.stockfish/research/stockfish19-check-lmr`

## Controlled game match

```bash
python3 scripts/compare_engines.py \
  --baseline .stockfish/research/stockfish19-baseline \
  --candidate .stockfish/research/stockfish19-check-lmr \
  --games 1000 --seconds 1 --max-plies 300 \
  --output check_lmr_report.json
```

The included GitHub Actions workflow does only a **4-game, 0.2-second-per-move pipeline smoke test**. Its result cannot establish whether the modification improves chess strength. To accept a change, run many paired games with confidence intervals or SPRT and corroborate at the desired 1-second time control. Preserve independent opening sets for final validation.

The Stockfish project is GPL-3.0; distribute modified engines only with their corresponding license and source.
