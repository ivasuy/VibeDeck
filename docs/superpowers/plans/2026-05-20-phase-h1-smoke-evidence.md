# Phase H.1 Smoke Evidence: Recent Flush Batching

**Date:** 2026-05-20  
**Worktree:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/.worktrees/phase-h1-recent-flush-batching`  
**Branch:** `agent/phase-h1-recent-flush-batching`  
**Plan:** `docs/superpowers/plans/2026-05-20-phase-h1-recent-flush-batching.md`  
**Artifacts:** `docs/superpowers/plans/phase-h1-smoke-artifacts/`

## Summary Verdict

Phase H.1 reduced grouped rebuild flush count, but the **performance gate failed** on this corpus.

- Phase H baseline wall clock: `348,982ms` (`5m 48.98s`)
- Phase H.1 measured wall clock: `368,366ms` (`6m 08.37s`)
- Phase H.1 target wall clock: `240,000ms` (`4m 00s`)
- Result: `fail` (`+19,384ms` vs Phase H baseline, `+128,366ms` vs target)

## Required Commands And Outputs

| Command | Result | Output summary |
|---|---|---|
| `npm --prefix dashboard test -- UsageOverview.test.jsx BranchesPage.test.jsx` | Uncovered | Failed before test collection: `sh: vitest: command not found`. This worktree has no `dashboard/node_modules`; the main checkout has dashboard dependencies, but the exact required command was run in the assigned worktree. Separate file check found `BranchesPage.test.jsx` present and `UsageOverview.test.jsx` absent, so requested UI coverage is not complete on this branch. |
| `node scripts/smoke/no-token-loss-proof.cjs --no-sync --output docs/superpowers/plans/phase-h1-smoke-artifacts/no-token-loss-proof.json` | Uncovered | Exited `2` after writing the artifact with `status: uncovered` and reason `missing_collect_rollout_source_deltas_api`. No source-vs-canonical token match is claimed. |

## Additional Verification

| Command | Result | Output summary |
|---|---|---|
| `node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js` | Passed | `21` tests passed, `0` failed. Covered rebuild profile counters, slice flush behavior, dirty post-drain scope, and canonical parity fixtures. |

## Baseline Vs H.1 Timing

From `phase-h1-rebuild-summary.json`:

| Metric | Phase H baseline | Phase H.1 result | Movement |
|---|---:|---:|---:|
| Wall clock | `348,982ms` | `368,366ms` | `+19,384ms` |
| Target wall clock | n/a | `240,000ms` | Missed by `128,366ms` |
| Performance gate | n/a | `fail` | n/a |

The H.1 wall clock is slower than Phase H and slower than the H.1 target. This should be treated as a failed performance gate.

## Top Stage Movement

| Stage | Phase H baseline | Phase H.1 result | Movement |
|---|---:|---:|---:|
| `recent_lane_session_event_flush` | `127,905.923ms` | `309,554.010ms` | `+181,648.087ms` |
| `branch_fact_rebuild_pass` | not in H.1 baseline table | `26,187.219ms` | n/a |
| `repair_pass` | not in H.1 baseline table | `25,256.559ms` | n/a |
| `recent_codex_parse` | not in H.1 baseline table | `1,352.082ms` | n/a |
| `historical_codex_parse` | not in H.1 baseline table | `1,024.148ms` | n/a |
| `recent_claude_parse` | not in H.1 baseline table | `1,019.071ms` | n/a |
| `historical_claude_parse` | not in H.1 baseline table | `472.321ms` | n/a |

The dominant stage is still `recent_lane_session_event_flush`, and it regressed by `181,648.087ms` against the Phase H baseline. The requested 40% stage reduction was not achieved; the reported reduction is `-142.02%`.

## Flush Count Movement

| Metric | Phase H baseline | Phase H.1 result | Gate |
|---|---:|---:|---|
| Flush count | `409` | `10` | Pass (`<= 120`) |
| Flush count delta | n/a | `-399` | n/a |
| Slice threshold flushes | n/a | `9` | Informational |
| Historical slice threshold flushes | n/a | `9` | Informational |

Flush count improved materially. This proves the batching control changed flush frequency, but the wall-clock result shows flush frequency was not the only bottleneck.

## Parity Status

- Rebuild/parity-focused suites passed in this worktree: `21` tests, `0` failed.
- Covered fixture-level canonical parity, rebuild profile contract, recent fast-path behavior, slice batching behavior, dirty post-drain scoping, and rebuild safety paths.
- This is test-fixture parity coverage, not a full proof over every local provider source file.

## No-Token-Loss Status

- Status: **uncovered**.
- Artifact: `docs/superpowers/plans/phase-h1-smoke-artifacts/no-token-loss-proof.json`.
- Reason: `missing_collect_rollout_source_deltas_api`.
- Summary counts are all zero because the proof harness could not collect source deltas on this branch lineage.
- No no-token-loss pass is claimed.

## UI Coverage Status

- Status: **uncovered at the exact required command**.
- The required dashboard command failed before test collection because `vitest` was not installed in this worktree's `dashboard/node_modules`.
- `dashboard/src/pages/BranchesPage.test.jsx` exists on this branch.
- `UsageOverview.test.jsx` is not present on this branch, so the requested `/usage` UI coverage is partial even if dashboard test tooling is installed.

## Residual Risks

| Risk | Severity | Impact | Next Action |
|---|---|---|---|
| Flush count improved but flush stage got slower | High | Blocks the H.1 speed target and makes rebuild slower than Phase H | Profile inside `recent_lane_session_event_flush` to separate SQLite write time, grouping overhead, branch fact side effects, and transaction boundaries |
| No-token-loss proof remains uncovered | Medium | Cannot prove full source-vs-canonical token preservation from the smoke harness on this branch | Restore or adapt `collectRolloutSourceDeltas` compatibility for this lineage |
| Requested `/usage` UI test file is absent | Medium | `/usage` dashboard smoke coverage is not represented by the required command | Add or port `UsageOverview.test.jsx` in a follow-up UI coverage task |

## Rollout Recommendation

- Do not claim Phase H.1 performance success.
- Keep the flush batching work only as a correctness-covered reduction in flush count.
- Treat the next performance task as a deeper flush-stage profiling and write-path reduction effort, not another flush-boundary-count-only change.
