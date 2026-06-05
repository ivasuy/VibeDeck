# Phase 8 Audit: Rebuild Flush + Repair Optimization

**Date:** 2026-05-29
**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Plan:** `docs/superpowers/plans/2026-05-29-rebuild-flush-repair-optimization.md`

## Verdict

GREEN. Correctness and instrumentation passed, and defaulting rebuilds to dirty post-drain reduced the current live DB rebuild from about `25s` to `17.93s`.

## Task Results

| Task | Implementer Commit | Reviewer Verdict | Result |
|---|---|---|---|
| P8-T1 repair scope fast path | `4f8c206` | GREEN | Repo resolution is skipped for fact-only repair candidates while branch facts still rebuild. |
| P8-T2 flush hot-path counters | `f2341d8` | GREEN | Batch flush summaries and profile counters now expose events, groups, branch resolutions, and repo reuse. |
| P8-T3 dirty post-drain default | this commit | local audit | Rebuilds now defer branch-fact materialization by default, with `VIBEDECK_REBUILD_DIRTY_POST_DRAIN=0` rollback. |

## Checks

| Check | Result |
|---|---:|
| `node -c src/lib/sessions/pipeline.js` | pass |
| `node -c src/lib/sessions/branch-usage-facts.js` | pass |
| `node -c src/commands/sync.js` | pass |
| `git diff --check` | pass |
| Consolidated backend/parity/freshness suite | `80/80` passed |

Consolidated suite command:

```sh
node --test test/sessions-branch-usage-facts.test.js test/sessions-pipeline-batch.test.js test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js test/projection-freshness.test.js
```

## Live DB Timing

The local provider logs changed since the previous `26.48s` measurement, so an apples-to-apples comparison was run on the current logs.

| Branch | Command | Result |
|---|---|---:|
| `agent/fast-startup-rebuild` | `/usr/bin/time -p node bin/vibedeck.js sync --auto --rebuild-vibedeck-db` | `24.51s` |
| `agent/rebuild-flush-repair-optimization` before dirty default | same command | `25.03s` |
| `agent/rebuild-flush-repair-optimization` after dirty default | same command | `17.93s` |
| `agent/rebuild-flush-repair-optimization` opt-in dirty pre-change | `env VIBEDECK_REBUILD_DIRTY_POST_DRAIN=1 ...` | `17.93s` |

Conclusion: making the already-covered dirty post-drain path the default removes about `7s` from this local rebuild.

## Final Profile Snapshot

| Stage | Duration | Key Counters |
|---|---:|---|
| `recent_lane_session_event_flush` | `6417.036ms` | `8410` events, `128` groups, `127` branch resolutions, `1` existing repo reuse |
| `repair_pass` | `95.639ms` | `126` dirty repair candidates |
| `branch_fact_rebuild_pass` | `8100.361ms` | `126` dirty branch facts rebuilt |

## Residual Risk

- The dominant remaining stage is now dirty `branch_fact_rebuild_pass`, not repair or grouped flush.
- The next performance phase should reduce branch-fact materialization cost while preserving provider-log evidence, historical unknown, GitHub unknown, and canonical parity.
