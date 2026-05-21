# Phase H.2 Smoke Evidence

Date: 2026-05-20

Plan: `docs/superpowers/plans/2026-05-20-phase-h2-mixed-lane-flush-splitting.md`

Artifacts:

- `docs/superpowers/plans/phase-h2-smoke-artifacts/phase-h2-rebuild-summary.json`
- `docs/superpowers/plans/phase-h2-smoke-artifacts/phase-h2-rebuild-profile.json`
- `docs/superpowers/plans/phase-h2-smoke-artifacts/phase-h2-no-token-loss-proof.json`

## Outcome

H.2 preserved the rebuild/parity checks, but the speed gate still failed. The benchmark improved slightly versus H.1, but it missed both the wall-clock target and the `recent_lane_session_event_flush` target.

| Gate | Status | Evidence |
|---|---|---|
| Rebuild/parity test command | Pass | `24` tests passed, `0` failed |
| H.2 benchmark wall clock | Fail | `366,301ms`, target `300,000ms`, missed by `66,301ms` |
| `recent_lane_session_event_flush` duration | Fail | `307,974.929ms`, target `180,000ms`, missed by `127,974.929ms` |
| Flush count | Pass | `11`, target `<=120` |
| Dashboard `/usage` and `/branches` targeted command | Uncovered | `vitest` is not installed in this worktree; `UsageOverview.test.jsx` is absent on this branch |
| No-token-loss proof | Uncovered | Proof script returned `missing_collect_rollout_source_deltas_api` |

## Commands

### Rebuild/parity suites

Command:

```bash
node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js
```

Status: pass

Summary:

- Tests: `24`
- Passed: `24`
- Failed: `0`
- Duration: `4057.169708ms`

### H.2 benchmark

Command recorded by the H.2 artifact:

```bash
/opt/homebrew/Cellar/node/26.0.0/bin/node "/Users/vasuyadav/Downloads/Projects/VibeDeck/.worktrees/phase-h2-mixed-lane-flush-splitting/bin/vibedeck.js" "sync" "--rebuild-vibedeck-db"
```

Status: fail

The rebuild command exited `0`, but the H.2 smoke result is `fail` because the measured gates missed their targets.

| Metric | H.1 baseline | H.2 result | Target | Status |
|---|---:|---:|---:|---|
| Wall clock | `368,366ms` | `366,301ms` | `300,000ms` | Fail |
| `recent_lane_session_event_flush` | `309,554.010ms` | `307,974.929ms` | `180,000ms` | Fail |
| Flush count | `10` | `11` | `<=120` | Pass |

Top profile stages:

| Stage | Duration |
|---|---:|
| `recent_lane_session_event_flush` | `307,974.929ms` |
| `branch_fact_rebuild_pass` | `26,571.741ms` |
| `repair_pass` | `25,135.490ms` |
| `recent_codex_parse` | `1,236.388ms` |
| `historical_codex_parse` | `1,097.936ms` |

### Dashboard targeted command

Command:

```bash
npm --prefix dashboard test -- src/pages/BranchesPage.test.jsx src/ui/matrix-a/components/UsageOverview.test.jsx
```

Status: uncovered

Reason:

- The command could not execute because `dashboard/node_modules/.bin/vitest` is not present in this worktree (`sh: vitest: command not found`).
- `dashboard/src/pages/BranchesPage.test.jsx` exists.
- `dashboard/src/ui/matrix-a/components/UsageOverview.jsx` exists, but `dashboard/src/ui/matrix-a/components/UsageOverview.test.jsx` is absent on this branch.

### No-token-loss proof

Command:

```bash
node scripts/smoke/no-token-loss-proof.cjs --no-sync --output docs/superpowers/plans/phase-h2-smoke-artifacts/phase-h2-no-token-loss-proof.json
```

Status: uncovered

Reason: `missing_collect_rollout_source_deltas_api`

The proof script exited `2` and wrote `phase-h2-no-token-loss-proof.json` with `status: "uncovered"`. No source-vs-canonical token preservation claim is made for H.2.

## Conclusion

H.2 is a correctness-preserving implementation of mixed-lane flush splitting and grouped batch chunking, but it is not a rebuild-speed win. The next phase should treat `recent_lane_session_event_flush` itself as the bottleneck and profile or redesign the per-event work inside that stage.
