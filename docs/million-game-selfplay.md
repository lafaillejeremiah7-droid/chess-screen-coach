# Million-game self-play campaign

**1,000,000 is the target, not a completed result.** The workflow's most recent
`summary.json` gives the actual count. An incomplete game never counts as a win,
a draw, or a finished game.

The previous 80-game experiment combined a short-search run and a 20-game
one-second run, most of which stopped at an artificial move limit. This campaign
uses **one second per engine move**, one thread and 16 MiB hash, and plays until
an actual python-chess outcome (including a claimable repetition/50-move draw).
The 1,024-ply emergency cutoff is recorded separately and does not advance the
target. A repeatedly unfinished slot stops for investigation after three tries.

The fixed schedule is:

- 200,000 training games. Agent 1 may use its correction book; Agent 2 is frozen.
- 400,000 control games: unchanged Stockfish against unchanged Stockfish.
- 400,000 candidate games: frozen learned book plus Stockfish against Agent 2.

Every evaluation start has both colors for both control and candidate. Half the
evaluation groups use training opening families; half use held-out families.
Teacher review uses an additional 1.5 seconds for up to two positions per training
game. This changes a stored move book, **not Stockfish's neural weights**. No
candidate is automatically installed into the screen coach.

The 12 starting positions are inherited from the earlier experiment, with two
seeded random legal moves added for variety. These are not balanced, rated or
representative openings; some are endgames. The campaign measures completed
continuations from these positions. Repeated starts and trajectories are possible.
It does not establish performance against humans or a human Elo rating.

Training completes before evaluation starts. No evaluation outcome is used to
update the book. The report compares candidate and control scores by matched
starting-position/color groups, separately for familiar and held-out families.
An approximate group interval appears after 30 complete groups; shared opening
families and repeated positions limit its interpretation.

## Run or resume

Install Python 3.12, `python-chess==1.999`, `chess==1.11.2` and the official engine:

```bash
python scripts/install_campaign_engine.py
python scripts/selfplay_campaign.py --engine .campaign-engine/stockfish \
  --games 1000000 --seconds 1 --teacher-seconds 1.5 \
  --workers 4 --max-seconds 10800 --output campaign
```

Run the same command again to resume. The SQLite checkpoint preserves finished
results, learning updates, pending moves, unique game slots and engine identity.
Settings or executable changes are rejected. Move history is saved every eight
half-moves and at a graceful pause. Hard kills can replay up to eight uncommitted
moves, but cannot count a finished slot twice. Engine search/hash state is not
saved, so resumed time-limited games are not bitwise reproducible.

```bash
python scripts/selfplay_campaign.py --status --output campaign
```

`--max-seconds` bounds one invocation. `--stop-after N` bounds newly finished
games for an invocation. Ctrl+C requests a graceful pause. Use a worker count
no higher than available CPU cores. Each worker has three engine processes,
with at most one searching at a time. The SQLite coordinator is for one host;
copy the checkpoint to a larger host to use more cores, rather than running
multiple coordinators against the same file.

## GitHub campaign

The experiment branch's `Million-game self-play campaign` workflow starts with
a three-minute batch to validate the environment, saves its database, then
requests three-hour batches until the count reaches 1,000,000. It uses up to
four available workers. Every continuation restores the previous checkpoint;
missing checkpoints, failed tests, changed engine binaries or worker errors
stop the chain. A successful workflow only means that batch ran successfully.
**Only `summary.json` with `state: complete` means the million games finished.**

To stop, cancel the active campaign run (and any already queued continuation).
To resume, dispatch the workflow on `experiment/million-game-selfplay` with
`resume_run_id` set to the run holding the latest checkpoint. It can also locate
the latest non-expired checkpoint automatically. `continue_campaign=false`
executes a single bounded batch. Keep a local copy of the checkpoint if pausing
for more than the 90-day artifact retention window.

The workflow keeps the latest two compressed checkpoints. This limits stored
copies; artifact storage still uses GitHub's storage allowance. It runs only
in a public repository on standard hosted runners. It does not purchase runners
or enable paid services. Public runner availability and account quotas still apply.

At 100 searched half-moves per game, one million games need roughly **27,778
engine-hours**, plus teacher review and orchestration. Four fully utilized
workers imply roughly **289 days** before overhead. Book moves and early
terminal outcomes reduce that time; longer games increase it. This is a workload
estimate, not a completion date or an assurance of improved strength.

References: [Actions limits](https://docs.github.com/en/actions/reference/limits),
[Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).
