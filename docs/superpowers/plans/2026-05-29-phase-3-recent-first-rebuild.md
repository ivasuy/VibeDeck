# Phase 3 Recent-First Rebuild Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Make rebuild process active/recent provider data before historical data, using the existing recent/historical lane foundation as default behavior.

## Task P3-T1 Rebuild Scheduler Priority

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/rollout.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/rebuild-parity-harness.test.js`

**Instructions:**

- Promote recent fast path behavior toward default rebuild behavior while preserving env overrides.
- Ensure active/recent provider files flush before historical files.
- Record shard metadata from Phase 2 when available, but make Phase 3 safe if shard table is absent during migration tests.
- Keep canonical parity with baseline rebuild.

**Acceptance:**

- Recent data is materialized before historical drain in profile output.
- Unknown and historical unknown buckets match baseline.
- Branch facts and sessions match baseline after rebuild completion.

**Checks:**

- `node --test test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js`

