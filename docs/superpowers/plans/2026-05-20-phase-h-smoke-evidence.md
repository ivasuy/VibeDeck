# Phase H Smoke Evidence: Rebuild Hot-Path Reduction

**Date:** 2026-05-20  
**Worktree:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/.worktrees/phase-h-rebuild-hot-path-reduction`  
**Branch:** `agent/phase-h-rebuild-hot-path-reduction`  
**Plan:** `docs/superpowers/plans/2026-05-20-phase-h-rebuild-hot-path-reduction.md`  
**Artifacts:** `docs/superpowers/plans/phase-h-smoke-artifacts/`

## Summary Verdict

Phase H implementation tasks are complete and verified, but the **performance gate failed** on this corpus.

- Baseline wall clock: `268,890ms` (`4m 28.89s`)
- Phase H measured wall clock: `348,982ms` (`5m 48.98s`)
- Target wall clock: `195,000ms` (`3m 15s`)
- Result: `fail` (`+80,092ms` vs baseline, `+153,982ms` vs target)

## Commands And Outputs

| Command | Result | Evidence |
|---|---|---|
| `node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js` | Passed | `19` tests passed, `0` failed |
| `node scripts/smoke/rebuild-hot-path-phase-h.cjs` | Performance gate fail (script exit non-zero by design) | `phase-h-rebuild-summary.json`, `phase-h-rebuild-profile.json` |
| `node scripts/smoke/no-token-loss-proof.cjs --output docs/superpowers/plans/phase-h-smoke-artifacts/no-token-loss-proof.json` | Uncovered | Missing API compatibility on this branch lineage (`missing_collect_rollout_source_deltas_api`) |
| `npm --prefix dashboard test -- UsageOverview.test.jsx BranchesPage.test.jsx` | Passed | `17` tests passed, `0` failed |

## Top Stage Movement

From `phase-h-rebuild-summary.json`:

| Stage | Duration |
|---|---:|
| `recent_lane_session_event_flush` | `127,905.923ms` |
| `branch_fact_rebuild_pass` | `27,335.112ms` |
| `repair_pass` | `26,732.312ms` |
| `historical_codex_parse` | `1,240.289ms` |
| `recent_codex_parse` | `1,013.624ms` |
| `recent_claude_parse` | `946.854ms` |
| `historical_claude_parse` | `494.332ms` |

Hot-path diagnosis remains clear: synchronous recent-lane flush still dominates runtime despite Task 2 and Task 3 scoping.

## Integrity And Richness Checks

- Canonical correctness safeguards remained enabled through all rebuild runs (`staged quick-check` and promotion path intact).
- Branch/data richness paths touched in this phase remained under test coverage:
  - grouped flush semantics,
  - dirty-scoped repair + branch fact rebuild,
  - parity-focused rebuild tests,
  - branch-window preservation assertions in updated rebuild tests.
- UI integrity command passed for branches/usage test surfaces.

## No-Token-Loss Gate Status

- `no-token-loss-proof` is **uncovered** in this phase branch because the source-collector API expected by the Phase G harness is absent on this lineage.
- Artifact written with explicit reason: `missing_collect_rollout_source_deltas_api`.
- This is documented as a tooling-compatibility gap, not a silent pass.

## Residual Risks

| Risk | Severity | Impact | Next Action |
|---|---|---|---|
| `recent_lane_session_event_flush` still dominates runtime | High | Blocks Phase H speed target and worsens wall clock on this corpus | Implement lane-sliced bounded flush in next phase (Phase H.1) before additional parse tuning |
| No-token-loss proof harness API mismatch on this branch | Medium | Prevents full source-vs-canonical proof in this phase branch | Backport compatible source-delta collector or adapt harness to branch-local APIs |
| Dirty scope branch-fact rebuild still touches many sessions (`1119`) | Medium | Limits net speedup from scoping | Add narrower dirty keying and changed-file/session provenance reduction |

## Rollout Recommendation

- Do not claim Phase H performance success yet.
- Keep Phase H code changes (they improve observability and flush correctness boundaries), but treat this run as **diagnostic evidence for the next optimization phase**.
