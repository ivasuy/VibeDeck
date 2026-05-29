# Phase 8 Audit: Rebuild Flush + Repair Optimization

**Date:** 2026-05-29
**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Plan:** `docs/superpowers/plans/2026-05-29-rebuild-flush-repair-optimization.md`

## Verdict

GREEN with one performance note: correctness and instrumentation passed, but live DB wall-clock is effectively flat within run noise.

## Task Results

| Task | Implementer Commit | Reviewer Verdict | Result |
|---|---|---|---|
| P8-T1 repair scope fast path | `4f8c206` | GREEN | Repo resolution is skipped for fact-only repair candidates while branch facts still rebuild. |
| P8-T2 flush hot-path counters | `f2341d8` | GREEN | Batch flush summaries and profile counters now expose events, groups, branch resolutions, and repo reuse. |

## Checks

| Check | Result |
|---|---:|
| `node -c src/lib/sessions/pipeline.js` | pass |
| `node -c src/lib/sessions/branch-usage-facts.js` | pass |
| `node -c src/commands/sync.js` | pass |
| `git diff --check` | pass |
| Consolidated backend/parity suite | `68/68` passed |

Consolidated suite command:

```sh
node --test test/sessions-branch-usage-facts.test.js test/sessions-pipeline-batch.test.js test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js
```

## Live DB Timing

The local provider logs changed since the previous `26.48s` measurement, so an apples-to-apples comparison was run on the current logs.

| Branch | Command | Result |
|---|---|---:|
| `agent/fast-startup-rebuild` | `/usr/bin/time -p node bin/vibedeck.js sync --auto --rebuild-vibedeck-db` | `24.51s` |
| `agent/rebuild-flush-repair-optimization` | same command | `25.03s` |
| `agent/rebuild-flush-repair-optimization` earlier run | same command | `24.34s` |

Conclusion: wall-clock is flat within local run variance.

## Final Profile Snapshot

| Stage | Duration | Key Counters |
|---|---:|---|
| `recent_lane_session_event_flush` | `14390.86ms` | `8355` events, `128` groups, `127` branch resolutions, `1` existing repo reuse |
| `repair_pass` | `7536.914ms` | `52` repair candidates |
| `historical_claude_parse` | `1513.895ms` | `108` files, `4578` events |
| `recent_codex_parse` | `187.99ms` | `24` files, `3107` events |

## Residual Risk

- The implemented repair fast path helps fact-only repair candidates, but the current live DB still has `52` repair candidates and only `1` existing repo reuse in the flush path.
- The dominant remaining flush cost is branch resolution inside grouped session batch processing: `127` branch resolutions for `128` groups.
- The next performance phase should defer, cache, or bulk-process branch resolution during rebuild while preserving branch attribution honesty and canonical parity.
