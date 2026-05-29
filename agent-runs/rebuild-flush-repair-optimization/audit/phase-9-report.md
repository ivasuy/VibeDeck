# Phase 9 Audit: Dirty Branch-Fact Materialization

**Date:** 2026-05-29
**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Plan:** `docs/superpowers/plans/2026-05-29-phase-9-dirty-branch-fact-materialization.md`

## Verdict

GREEN. The dirty branch-fact bottleneck was reduced from about `8.1s` to `0.58s` on the current live DB.

## Changes

| Task | Result |
|---|---|
| P9-T1 provider evidence cache reuse | Non-strict provider branch evidence reads now reuse cached strict reads when the strict result was unambiguous. Ambiguous strict reads are not reused. |
| P9-T2 project attribution cache | Branch-fact materialization now caches repeated project attribution shapes through the shared rebuild cache. |

## Checks

| Check | Result |
|---|---:|
| `node -c src/lib/sessions/branch-usage-facts.js` | pass |
| `node -c src/lib/sessions/provider-branch.js` | pass |
| `git diff --check` | pass |
| Focused branch-fact/rebuild parity suite | `58/58` passed |
| Consolidated backend/parity/freshness suite | `83/83` passed |

Consolidated suite command:

```sh
node --test test/sessions-branch-usage-facts.test.js test/sessions-pipeline-batch.test.js test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js test/projection-freshness.test.js
```

## Live DB Timing

| Run | Result |
|---|---:|
| Before Phase 9, dirty post-drain default | `17.93s` |
| After provider evidence cache reuse only | `17.78s` |
| After project attribution cache | `10.81s` |

## Final Profile Snapshot

| Stage | Duration | Key Counters |
|---|---:|---|
| `recent_lane_session_event_flush` | `6538.046ms` | `8456` events, `128` groups, `127` branch resolutions |
| `repair_pass` | `78.597ms` | `126` dirty repair candidates |
| `branch_fact_rebuild_pass` | `577.476ms` | `126` dirty branch facts rebuilt |

## Residual Risk

- Project attribution cache keys include provider/session fallback data plus cwd/repo fields, so unattributed rows remain session-specific.
- Provider branch cache reuse deliberately ignores ambiguous strict reads, preserving non-strict malformed-line recovery.
- The remaining rebuild bottleneck is now grouped session flush, not branch-fact materialization.
