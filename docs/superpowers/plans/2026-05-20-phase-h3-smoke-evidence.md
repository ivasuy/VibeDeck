# Phase H.3 Smoke Evidence

Date: 2026-05-20

Plan: `docs/superpowers/plans/2026-05-20-phase-h3-defer-branch-fact-rebuild.md`

Artifacts:

- `docs/superpowers/plans/phase-h3-smoke-artifacts/phase-h3-rebuild-summary.json`
- `docs/superpowers/plans/phase-h3-smoke-artifacts/phase-h3-rebuild-profile.json`

## Outcome

H.3 reduced the dominant flush stage enough to pass the explicit flush-stage target, but the phase did not meet the overall wall-clock target. The benchmark result is `fail` because wall clock remained above `300,000ms` and the branch-fact gate regressed versus the H.2 baseline.

Raw artifact values for consistency checks: `wall_clock_ms=337412`, `wall_clock_target_ms=300000`, `flush_stage_ms=218370.394`, `branch_fact_stage_ms=27321.343`.

| Gate | Status | Evidence |
|---|---|---|
| H.3 benchmark wall clock | Fail | `337,412ms`, target `300,000ms`, missed by `37,412ms` |
| `recent_lane_session_event_flush` duration | Pass | `218,370.394ms`, target `220,000ms`, beat by `1,629.606ms` |
| `branch_fact_rebuild_pass` duration | Fail | `27,321.343ms`, baseline/target `25,939.595ms`, regressed by `1,381.748ms` |
| Rebuild/parity test command | Uncovered | The current H.3 artifacts only record the benchmark summary/profile, not test output |
| Dashboard `/usage` and `/branches` targeted command | Uncovered | No H.3 dashboard smoke artifact is present in the current evidence set |
| No-token-loss proof | Uncovered | No H.3 no-token-loss proof artifact is present in the current evidence set |

## Commands

### H.3 benchmark

Command recorded by the H.3 artifact:

```bash
/opt/homebrew/Cellar/node/26.0.0/bin/node "/Users/vasuyadav/Downloads/Projects/VibeDeck/.worktrees/phase-h3-defer-branch-facts/bin/vibedeck.js" "sync" "--rebuild-vibedeck-db"
```

Status: fail

The rebuild command exited `0`, but the H.3 smoke result is `fail` because measured gates missed their targets.

| Metric | H.2 baseline | H.3 result | Target | Status |
|---|---:|---:|---:|---|
| Wall clock | `366,301ms` | `337,412ms` | `300,000ms` | Fail |
| `recent_lane_session_event_flush` | `307,974.929ms` | `218,370.394ms` | `220,000ms` | Pass |
| `branch_fact_rebuild_pass` | `25,939.595ms` | `27,321.343ms` | `25,939.595ms` | Fail |

Top profile stages:

| Stage | Duration |
|---|---:|
| `recent_lane_session_event_flush` | `218,370.394ms` |
| `repair_pass` | `65,127.053ms` |
| `branch_fact_rebuild_pass` | `27,321.343ms` |
| `recent_codex_parse` | `1,196.842ms` |
| `recent_claude_parse` | `1,012.835ms` |
| `historical_codex_parse` | `1,008.648ms` |
| `historical_claude_parse` | `465.974ms` |

Relevant counters:

- Recent session events flushed: `23,620`
- Historical session events flushed: `24,486`
- Slice threshold flush count: `10`
- Historical slice threshold flush count: `10`
- Repair candidates attempted: `896`
- Dirty branch facts rebuilt: `1,141`

## Conclusion

H.3 is a flush-stage improvement, not a complete speed win. The flush-stage gate passed at `218,370.394ms`, but the measured wall clock was `337,412ms`, so no target-success claim is made. The remaining time is concentrated in `repair_pass` and `branch_fact_rebuild_pass`, and the branch-fact gate failed because the dirty branch-fact rebuild pass took `27,321.343ms`, which is slower than the H.2 baseline target.
