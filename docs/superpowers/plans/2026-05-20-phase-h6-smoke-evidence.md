# Phase H.6 Smoke Evidence

Sources:
- `docs/superpowers/plans/phase-h6-smoke-artifacts/phase-h6-rebuild-summary.json`
- `docs/superpowers/plans/phase-h6-smoke-artifacts/phase-h6-rebuild-profile.json`

## Overall Result

The H.6 smoke summary reports `overall result=pass` with command exit code `0`.

## Gate Results

| Gate | Baseline / target | H.6 measured | Delta | Status |
|---|---:|---:|---:|---|
| Wall clock | `300,000ms` target; `285,133ms` H.5 baseline | `242,596ms` | `-42,537ms` vs baseline; `-57,404ms` vs target | pass |
| `repair_pass` | `37,710.939ms` | `1,034.142ms` | `-36,676.797ms` | pass |
| `branch_fact_rebuild_pass` | `25,900.448ms` | `25,640.601ms` | `-259.847ms` | pass |

Raw artifact values:
- `wall_clock_ms=242596`
- `wall_clock_target_ms=300000`
- `repair_pass_ms=1034.142`
- `branch_fact_rebuild_pass_ms=25640.601`
- `overall result=pass`

## Bottleneck Movement

H.6 solved the H.5 failed `repair_pass` gate: the stage moved from the H.5 target/baseline of `37,710.939ms` to `1,034.142ms`, while preserving the H.5 `branch_fact_rebuild_pass` improvement at `25,640.601ms`.

The remaining dominant measured stage is `recent_lane_session_event_flush` at `208,729.248ms`. That stage now dominates the local rebuild profile again, even though the H.6 smoke gate itself passed.

## Profile Counters

| Counter | Value |
|---|---:|
| `recent_session_events_flushed` | `23,996` |
| `historical_session_events_flushed` | `24,486` |
| `slice_threshold_flush_count` | `10` |
| `historical_slice_threshold_flush_count` | `10` |
| `repair_candidates_attempted` | `902` |
| Dirty branch facts rebuilt | `1,147` |
| Profile stage total | `238,930ms` |
| Profile stage count | `7` |
