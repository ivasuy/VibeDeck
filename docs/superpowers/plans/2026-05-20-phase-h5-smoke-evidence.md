# Phase H.5 Smoke Evidence

Source artifacts:

- `docs/superpowers/plans/phase-h5-smoke-artifacts/phase-h5-rebuild-summary.json`
- `docs/superpowers/plans/phase-h5-smoke-artifacts/phase-h5-rebuild-profile.json`

## Summary

The Phase H.5 smoke run completed the rebuild command with `exit_code=0`, but the artifact overall result is `fail`. The wall-clock and `branch_fact_rebuild_pass` gates passed. The `repair_pass` gate failed, so H.5 must not be described as an overall rebuild-speed success.

## Gates

| Gate | Baseline / target | H.5 measured | Result |
|---|---:|---:|---|
| Overall result | n/a | `fail` | Fail |
| Wall-clock gate | `300,000ms` target | `285,133ms` | Pass |
| `repair_pass` gate | `36,400.351ms` target | `37,710.939ms` | Fail |
| `branch_fact_rebuild_pass` gate | `28,946.879ms` target | `25,900.448ms` | Pass |

## Deltas

| Metric | H.4 baseline | H.5 measured | Delta |
|---|---:|---:|---:|
| Wall clock | `284,982ms` | `285,133ms` | `+151ms` |
| `repair_pass` | `36,400.351ms` | `37,710.939ms` | `+1,310.588ms` |
| `branch_fact_rebuild_pass` | `28,946.879ms` | `25,900.448ms` | `-3,046.431ms` |

## Bottleneck Transition

H.5 addressed the dirty branch-fact bottleneck targeted by the phase: `branch_fact_rebuild_pass` improved by `3,046.431ms` and passed its H.4 baseline gate. The overall result remains `fail` because `repair_pass` regressed by `1,310.588ms` versus the H.4 target.

The largest measured stage in the profile remains `recent_lane_session_event_flush` at `213,642.585ms`. The next phase should not claim H.5 solved the full rebuild hot path; it should treat H.5 as a branch-fact-pass improvement with a remaining `repair_pass` gate failure and a still-dominant flush stage.

## Raw Artifact Values

- `overall result=fail`
- `wall_clock_ms=285133`
- `wall_clock_target_ms=300000`
- `repair_pass_ms=37710.939`
- `repair_pass_target_ms=36400.351`
- `branch_fact_rebuild_pass_ms=25900.448`
- `branch_fact_rebuild_pass_target_ms=28946.879`
