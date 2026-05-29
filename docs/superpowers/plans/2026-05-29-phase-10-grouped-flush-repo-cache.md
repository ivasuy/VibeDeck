# Phase 10 Grouped Flush Repo Cache Plan

**Branch:** `agent/rebuild-flush-repair-optimization`
**Worktree:** `.worktrees/rebuild-flush-repair-optimization`
**Base:** `a4f2ade`

## Context

After Phase 9, the live DB rebuild measured `10.81s`.
The remaining dominant stage is:

- `recent_lane_session_event_flush`: about `6.54s`

Instrumentation of a real local rebuild showed:

- `resolveRepo` calls: `159`
- `resolveRepo` time: about `5.65s`
- `resolveBranchForSession` calls: `127`
- `resolveBranchForSession` time: about `0.45s`

## Task Graph

### P10-T1-rebuild-repo-resolution-cache

**Title:** Cache cwd repo resolution across grouped rebuild batches.

**Files:**
- `src/lib/sessions/pipeline.js`
- `test/sessions-pipeline-batch.test.js`
- `PROJECT.md`
- `agent-runs/rebuild-flush-repair-optimization/audit/phase-10-report.md`

**Instructions:**
- Add a shared `repoResolutionByCwd` map under the existing rebuild cache object.
- Use it inside `processSessionEventBatch` when resolving the latest cwd for a batch.
- Cache both successful repo objects and null results, matching current catch-and-null behavior.
- Preserve existing behavior when no cache object is provided.
- Do not cache `existingRepoStillApplies` skips as repo resolutions.
- Keep current live-event, branch-resolution, bucket, ledger, dirty post-drain, historical unknown, GitHub unknown, and provider-log branch behavior.

**Acceptance:**
- Multiple grouped batches with the same cwd and shared cache call `resolveRepo` only once.
- Existing batch and rebuild parity tests pass.
- Live DB rebuild is measured after the change.

**Checks:**
- `node --test test/sessions-pipeline-batch.test.js test/sync-rebuild-vibedeck-db.test.js`
- `node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
- `node -c src/lib/sessions/pipeline.js`
- `git diff --check`
