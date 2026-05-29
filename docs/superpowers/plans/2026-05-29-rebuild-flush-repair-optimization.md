# Rebuild Flush + Repair Optimization Plan

**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Base:** `agent/fast-startup-rebuild`

## Context

The latest real rebuild profile on the local tracker DB measured:

- DB rebuild wall time: `26.48s`
- `recent_lane_session_event_flush`: `14451.142ms`
- `repair_pass`: `7623.62ms`
- `recent_codex_parse`: `183.533ms`
- `historical_claude_parse`: `1495.075ms`

The next optimization phase targets post-parse DB work only. It must preserve the existing project -> worktrees/repos -> sessions umbrella, historical unknown and GitHub unknown behavior, shard readiness data, dirty post-drain semantics, and canonical parity.

## Task Graph

### P8-T1-repair-scope-fast-path

**Title:** Split repair metadata lookup from branch-fact rebuild candidates.

**Files:**
- `src/lib/sessions/branch-usage-facts.js`
- `test/sessions-branch-usage-facts.test.js`
- `test/sync-rebuild-vibedeck-db.test.js`

**Dependencies:** none

**Instructions:**
- In `repairMissingProjectAttribution`, avoid `resolveRepo` for rows that already have non-empty `repo_root`.
- Keep rows with missing branch facts eligible for branch-fact rebuild when `rebuildFacts` is true.
- Keep rows with missing repo metadata eligible for repo repair.
- Preserve scoped `sessions`, provider filtering, progress callback shape, transaction behavior, and return count semantics.
- Add regression coverage proving a session with existing repo metadata but missing facts rebuilds facts without invoking repo resolution.
- Add sync-level coverage that dirty post-drain repair continues to pass the dirty session scope and keeps parity.

**Acceptance:**
- Repair no longer performs filesystem repo resolution for fact-only candidates.
- Missing repo candidates still persist repo metadata and can rebuild facts.
- Existing counts/totals in rebuild tests remain unchanged.
- Focused tests pass.

**Checks:**
- `node --test test/sessions-branch-usage-facts.test.js`
- `node --test test/sync-rebuild-vibedeck-db.test.js`
- `node -c src/lib/sessions/branch-usage-facts.js`

**Error rescue map:**
- If fact-only rows stop rebuilding facts, split candidate metadata into `needs_repo_repair` and `needs_fact_rebuild` columns and gate only the repo lookup.
- If return counts change, preserve `rows.length` for now and add a later metrics-only counter.
- If scoped repairs regress, keep the temp scope joins unchanged and only adjust selected columns/HAVING output.

**Observability:**
- Existing `repair_pass` timing remains the success metric.
- Existing `repair_candidates` counter remains the compatibility metric.

**Test cases:**
- fact-only candidate: existing `repo_root`, no facts, `rebuildFacts: true`, no repo lookup, facts rebuilt.
- metadata candidate: missing `repo_root`, cwd under git repo, repo metadata persisted.
- dirty scope: only dirty sessions are considered during rebuild repair.

**Integration contracts:**
- Export unchanged: `repairMissingProjectAttribution(dbPath, options) -> Promise<number>`.
- No schema change.

### P8-T2-flush-hot-path-counters

**Title:** Add flush hot-path counters and remove avoidable post-commit DB read.

**Files:**
- `src/lib/sessions/pipeline.js`
- `src/commands/sync.js`
- `src/lib/rebuild-profile.js`
- `test/sessions-pipeline-batch.test.js`
- `test/sync-rebuild-profile.test.js`
- `test/sync-rebuild-vibedeck-db.test.js`

**Dependencies:**
- `P8-T1-repair-scope-fast-path`

**Instructions:**
- Avoid unnecessary extra session loads in `processSessionEventBatch` where the already-loaded latest row is equivalent for event emission.
- Preserve terminal-end, orphan-reopen, checkpoint-open, provider branch, bucket fact, ledger, and deferred branch-fact behavior.
- Add low-cardinality flush counters that expose groups processed, events processed, sessions with branch resolution, and sessions that skipped repo resolution because existing repo metadata still applied.
- Make counters appear under the existing `recent_lane_session_event_flush` profile stage without changing profile shape for callers that do not care.
- Add regression tests for emit/latest correctness and profile counters.

**Acceptance:**
- Batch processing does not read the latest session again after commit unless needed for correctness.
- Profile JSON includes the new counters when rebuild profiling is enabled.
- Existing rebuild parity and grouped processor tests pass.

**Checks:**
- `node --test test/sessions-pipeline-batch.test.js`
- `node --test test/sync-rebuild-profile.test.js`
- `node --test test/sync-rebuild-vibedeck-db.test.js`
- `node -c src/lib/sessions/pipeline.js src/commands/sync.js src/lib/rebuild-profile.js`

**Error rescue map:**
- If emit semantics depend on the post-commit reload, keep the reload only when branch resolution or terminal-state preservation updates the row.
- If profile merging gets noisy, record counters only from grouped processor flush summaries.
- If tests monkeypatch `processSessionEventBatch`, keep the monkeypatch compatibility branch untouched.

**Observability:**
- Existing real rebuild measurement remains `/usr/bin/time -p node bin/vibedeck.js sync --auto --rebuild-vibedeck-db`.
- Target is a lower `recent_lane_session_event_flush` stage or, at minimum, enough counters to identify the remaining write hot path.

**Test cases:**
- multi-event batch emits all expected events with latest metadata after commit.
- grouped rebuild profile records new flush counters.
- dirty post-drain still defers branch facts and reports dirty scope.

**Integration contracts:**
- `processSessionEventBatch` remains backward-compatible.
- `createGroupedSessionEventProcessor` summary may add fields but must not remove existing fields.

## Final Audit

The orchestrator will:

- Run all task checks.
- Run `node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`.
- Run `git diff --check`.
- Run a real local rebuild timing command and compare DB build time/stage profile against the previous `26.48s` baseline.
- Verify branch/worktree cleanliness after commits.
