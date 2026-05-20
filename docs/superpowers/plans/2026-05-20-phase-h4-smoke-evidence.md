# Phase H.4 Smoke Evidence

Source artifacts:

- `docs/superpowers/plans/phase-h4-smoke-artifacts/phase-h4-rebuild-summary.json`
- `docs/superpowers/plans/phase-h4-smoke-artifacts/phase-h4-rebuild-profile.json`

## Overall Result

The H.4 rebuild smoke artifact reports overall summary result: `fail`.

The command exited with code `0`, but the artifact gate result is still `fail` because `branch_fact_rebuild_pass` exceeded the H.3 baseline target.

## Gate Outcomes

| Gate | Target | Current | Status | Delta |
|---|---:|---:|---|---:|
| Wall clock | `300,000ms` | `284,982ms` | Pass | `-15,018ms` vs target |
| `repair_pass` | `65,127.053ms` | `36,400.351ms` | Pass | `-28,726.702ms` vs H.3 baseline |
| `branch_fact_rebuild_pass` | `27,321.343ms` | `28,946.879ms` | Fail | `+1,625.536ms` vs H.3 baseline |

## Profile Counters

| Counter | Value |
|---|---:|
| Recent session events flushed | `23,749` |
| Historical session events flushed | `24,486` |
| Slice threshold flush count | `10` |
| Historical slice threshold flush count | `10` |
| Repair candidates attempted | `900` |
| Dirty branch facts rebuilt | `1,145` |
| Profile stage total | `282,750ms` |
| Profile stage count | `7` |

## Top Stages

| Stage | Duration |
|---|---:|
| `recent_lane_session_event_flush` | `213,745.559ms` |
| `repair_pass` | `36,400.351ms` |
| `branch_fact_rebuild_pass` | `28,946.879ms` |
| `recent_codex_parse` | `1,202.351ms` |
| `historical_codex_parse` | `1,042.299ms` |
| `recent_claude_parse` | `955.613ms` |
| `historical_claude_parse` | `456.689ms` |

## Bottleneck Transition

H.4 reduced wall clock below the `300,000ms` target and reduced `repair_pass` from the H.3 baseline of `65,127.053ms` to `36,400.351ms`.

The bottleneck did not fully clear. `branch_fact_rebuild_pass` moved from the H.3 baseline of `27,321.343ms` to `28,946.879ms`, so the overall artifact result remains `fail`. The next bottleneck is dirty branch-fact rebuild cost after the repaired attribution pass.

## Coverage Notes

The H.4 artifacts contain benchmark summary/profile data only. They do not include parity, dashboard, or no-token-loss proof fields, so this evidence file does not claim those checks as covered.
