# Phase 1 Fast First Paint Snapshot Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.
> Execution workflow: one isolated worktree, one implementer and one reviewer per task, same implementer/reviewer reused until reviewer returns GREEN, then an auditor smoke gate.

**Goal:** Make serve/startup able to return a useful last-known VibeDeck snapshot immediately, without waiting for provider sync or historical rebuild.

**Branch/worktree:** `agent/fast-startup-rebuild` in `.worktrees/fast-startup-rebuild`.

**Architecture:** Add a small snapshot module that writes a compact JSON file from the projection DB after successful sync/rebuild and lets the local API read it before fresh data is fully ready. Snapshot is advisory only. It never replaces canonical DB reads after fresh projection data is available.

**Non-negotiable safety rules:**

- Snapshot values must be marked `source: "snapshot"` and `fresh: false` unless explicitly refreshed from DB.
- Snapshot must not alter `vibedeck_sessions`, branch facts, usage buckets, `Unknown branch`, or `Historical unknown`.
- Serve must not block on snapshot creation.
- If snapshot read fails, API returns a valid empty payload and sync proceeds normally.
- Existing endpoint payloads remain backward-compatible.

## Task P1-T1 Snapshot Module And API

**Files:**
- Create: `src/lib/startup-snapshot.js`
- Modify: `src/lib/local-api.js`
- Modify: `src/commands/sync.js`
- Test: `test/startup-snapshot.test.js`
- Test: focused local API smoke if endpoint is added.

**Instructions:**

Implement a compact startup snapshot helper with:

```js
function buildStartupSnapshotFromDb({ dbPath, now = new Date() } = {}) {}
function writeStartupSnapshot({ trackerDir, dbPath, now = new Date() } = {}) {}
function readStartupSnapshot({ trackerDir } = {}) {}
function emptyStartupSnapshot({ now = new Date(), reason = "missing" } = {}) {}
```

Expose a read-only local API route:

```text
GET /functions/vibedeck-startup-snapshot
```

The payload must include:

```json
{
  "ok": true,
  "source": "snapshot",
  "fresh": false,
  "generated_at": "ISO",
  "totals": { "today_cost_usd": 0, "week_cost_usd": 0, "today_tokens": 0, "week_tokens": 0 },
  "active_sessions": [],
  "recent_sessions": [],
  "top_providers": [],
  "recent_projects": [],
  "freshness": {
    "mode": "snapshot",
    "recent_ready": false,
    "historical_ready": false,
    "active_rebuild": false
  }
}
```

Call `writeStartupSnapshot` after successful `cmdSync` completion. Failure to write the snapshot must be a warning at most.

**Acceptance:**

- Missing snapshot returns `ok: true` with empty payload and `reason: "missing"`.
- Snapshot builder reads only projection tables and preserves unknown/historical unknown labels as stored.
- `cmdSync(["--auto"])` attempts snapshot write after normal work.
- Existing usage/local API tests still pass.

**Checks:**

- `node --test test/startup-snapshot.test.js`
- `node -c src/lib/startup-snapshot.js src/lib/local-api.js src/commands/sync.js`

**Reviewer focus:**

- No snapshot data is treated as canonical.
- No startup path blocks on provider sync.
- No change to final totals or branch attribution.

**Auditor smoke:**

- Run the focused tests.
- Hit the new route through `createLocalApiHandler` or equivalent test helper.
- Confirm `git diff --check`.

