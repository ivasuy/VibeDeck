# Phase 6 Source Cursors And Watermarks Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Skip unchanged provider sources aggressively while preserving correctness on rewritten files and provider SQLite stores.

## Task P6-T1 Provider Source Watermarks

**Files:**
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Create/modify tests around provider cursor behavior.

**Instructions:**

- Store source path, mtime, size, and offset/hash where supported.
- Prefer append-only reads when provider format supports it.
- Reparse rewritten files safely.
- Thread source groups into projection shard metadata when Phase 2 helpers exist.

**Acceptance:**

- Unchanged provider files are skipped.
- Rewritten provider files are reparsed correctly.
- Provider SQLite cases remain safe.

**Checks:**

- `node --test test/rollout-parser.test.js test/sync-rebuild-vibedeck-db.test.js`

