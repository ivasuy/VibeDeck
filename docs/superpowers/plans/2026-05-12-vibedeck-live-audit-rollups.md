# VibeDeck Live Audit Rollups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Live page show correct active-session state plus durable project, worktree, branch, provider, model, token, and cost audit totals from canonical SQLite.

**Architecture:** Provider logs and hooks keep streaming through the existing sync/session pipeline, but `vibedeck.sqlite3` becomes the only durable read source for Live audit totals. The live stream should send current active rows and backend-authored rollups; the browser should render those rollups instead of rebuilding project history from active rows only. `updated_at` remains row mutation metadata, while `last_observed_at` becomes the activity clock for live eligibility, stale reaping, and historical closure.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, existing session pipeline and cost-estimation helpers, local API SSE, React/Vite/TypeScript, Vitest, Node test runner, `rtk`.

---

## Actual File Review

Backend findings:

- `src/lib/local-api.js` currently builds `/functions/vibedeck-sessions-live-snapshot` from `vibedeck_sessions WHERE ended_at IS NULL OR ended_at >= ?`. That query includes stale historical rows if rebuild refreshed `updated_at` but left `ended_at` null.
- `src/lib/local-api.js` sets `last_sync_at` from `queue.jsonl` mtime. An empty compatibility export can look like a successful parse.
- `src/lib/local-api.js` calls `enrichLiveSessionCost(row)`, which ignores stored session cost for active rows by passing `stored_cost_usd: active ? null : row.total_cost_usd`. This can drop persisted cost quality and make Live cost diverge from `/usage`.
- `src/lib/local-api.js` sends `workstreams: buildLiveWorkstreams(sessions)` in the SSE snapshot, but those workstreams are derived only from snapshot rows, not all historical sessions for the active project/worktree.
- `src/lib/sessions/reaper.js` selects `started_at, updated_at` and uses `max(updated_at, started_at)` as activity time. That is the root stale-session bug after rebuild because `updated_at` is a mutation timestamp.
- `src/lib/sessions/writer.js` already writes `last_observed_at` from events and bumps `updated_at` only when rows change. That is the correct separation, but downstream code does not consistently respect it.
- `src/lib/sessions/bucket-facts.js` already persists bucket token/cost facts and recomputes `vibedeck_sessions.total_cost_usd`, `total_tokens`, and `last_observed_at`. This should be the Live audit source of truth.
- `src/lib/project-usage.js` works better because it builds provider/model/project/worktree totals from canonical sessions and stored costs, using `last_observed_at` in `activity_at`.
- `src/lib/branch-usage.js` falls back to session rows when branch windows are missing, but active sessions do not have finalized windows yet. Live branch audit totals need provisional read-time windows or branch-group rollups from canonical session/bucket facts.
- `src/commands/sync.js` only prints `Session live-state sync: N event(s) failed`; `createSessionEventProcessor()` stores raw errors without event identity. Rebuild cannot be audited from that output.
- `src/lib/local-api.js` `scopedQueueRows()` uses DB rows if any rows exist, otherwise queue rows. That is unsafe when canonical facts are partially backfilled.

Frontend findings:

- `dashboard/src/hooks/use-vibedeck-live-sessions.ts` stores only `sessions`; it ignores `event.workstreams` and has no state for backend rollups or aggregate totals.
- `dashboard/src/hooks/use-vibedeck-live-sessions.ts` sorts by `updated_at` before `last_observed_at`, repeating the backend activity-clock bug in the UI.
- `dashboard/src/lib/live-workstreams.js` rebuilds workstreams from the rows currently in memory. It uses `ended_at || updated_at || last_observed_at` as session end and has no access to historical project totals.
- `dashboard/src/components/live/LiveWorkbenchOverview.jsx` filters to active sessions and sums only those rows. This explains why the top widget shows only active token/cost instead of active project audit totals.
- `dashboard/src/components/live/LiveSessionList.jsx` builds workstreams locally from `sessions` and filters to `active_session_count > 0`. Historical project/worktree/branch cost disappears unless an ended session is still inside the recent snapshot window.
- `dashboard/src/components/live/LiveWorkstreamDrawer.jsx` can display branch groups and sessions, but it is fed incomplete workstreams.
- `/usage` project usage gets backend-authored provider/model/project rollups, so its distribution is more trustworthy. Live should use the same backend-owned rollup pattern.

## Data Contract Decision

Use two clocks and two total families:

- `updated_at`: internal row mutation time. Never use for live eligibility, session recency, or stale closure.
- `last_observed_at`: provider activity time. Use for active eligibility, stale reaping, sorting, and historical idle closure.
- `active_*`: tokens/cost/models from sessions that are truly active after stale reaping.
- `audit_*`: durable historical plus active totals for projects/worktrees/branches that currently have at least one active session.

Live should answer these separate questions:

- "What is running now?" from active sessions after `last_observed_at` eligibility.
- "What has this active project/worktree/branch spent, including the current run?" from canonical DB audit rollups.
- "What has just finished?" from recent-ended sessions, shown as stale/recent context but not counted as active.

The browser must not infer project audit totals from active rows. It can keep a local fallback for older backend payloads, but the authoritative path is backend rollups.

## File Structure

Create:

- `src/lib/sessions/activity-state.js`
  Central helpers for session activity time, live eligibility, stale cutoff checks, and stable sort time.
- `src/lib/sessions/live-rollups.js`
  Backend read model for active sessions, recent sessions, active project/workstream audit rollups, branch groups, provider/model groups, and aggregate totals.
- `src/lib/sessions/canonical-completeness.js`
  Shared checks for whether canonical bucket facts are complete enough to be used as DB-first read models.
- `src/lib/sessions/reconciliation.js`
  Canonical-vs-queue reconciliation report by day, provider, model, and project/worktree where project queue data exists.
- `test/sessions-activity-state.test.js`
- `test/sessions-live-rollups.test.js`
- `test/local-api-vibedeck-live-rollups.test.js`
- `test/sync-session-event-failures.test.js`
- `test/canonical-completeness.test.js`
- `test/canonical-reconciliation.test.js`
- `dashboard/src/lib/live-workstreams.test.js`

Modify:

- `src/lib/sessions/reaper.js`
  Use `last_observed_at` for activity and support rebuild-specific historical idle closure.
- `src/lib/sessions/workstreams.js`
  Keep as the compatibility fallback grouper for payloads that do not include backend rollups.
- `src/lib/local-api.js`
  Return backend-authored live rollups, reliable freshness, and canonical completeness metadata from snapshot and SSE endpoints.
- `src/commands/sync.js`
  Add detailed session-event failure diagnostics, rebuild progress phases, canonical completeness marking, and reconciliation command/report entry point.
- `src/lib/branch-usage.js`
  Include active/provisional branch attribution using `ended_at || last_observed_at` where branch windows do not exist.
- `src/lib/project-usage.js`
  Extract project/worktree label and scope helpers that `live-rollups.js` can reuse without duplicating grouping rules.
- `src/lib/usage-read-models.js`
  Gate DB-first reads on canonical completeness instead of "any bucket facts exist".
- `dashboard/src/hooks/use-vibedeck-live-sessions.ts`
  Store the full Live payload: sessions, workstreams, totals, freshness, completeness, status, and error.
- `dashboard/src/lib/live-workstreams.js`
  Keep as compatibility fallback and align activity sorting with `last_observed_at`.
- `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
  Render active totals and active-project audit totals separately.
- `dashboard/src/components/live/LiveOperationsPanel.jsx`
  Pass backend workstreams/totals to Live session list.
- `dashboard/src/components/live/LiveSessionList.jsx`
  Prefer backend rollups over local fallback workstream generation.
- `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
  Display audit totals, active totals, provider/model groups, branch groups, and unknown-cost status.
- `dashboard/src/pages/LivePage.jsx`
  Consume the richer hook return and preserve session selection against active rows.
- `dashboard/src/lib/vibedeck-api.ts`
  Add exported Live payload types for sessions, workstreams, totals, freshness, and canonical completeness.
- `dashboard/src/content/copy.csv`
  Add short labels for "Project total", "Live now", "History + live", "Unknown cost", and canonical incomplete warning.

Do not modify:

- `src/lib/rollout.js` parser math, token normalization, or provider pricing semantics. If a parser bug is found while executing this plan, document it separately and stop before changing parser behavior.

---

### Task 1: Centralize Session Activity Semantics

**Files:**
- Create: `src/lib/sessions/activity-state.js`
- Modify: `src/lib/sessions/reaper.js`
- Modify: `src/lib/sessions/workstreams.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/live-workstreams.js`
- Test: `test/sessions-activity-state.test.js`
- Test: `test/local-api-vibedeck-sessions-live-snapshot.test.js`
- Test: `dashboard/src/lib/live-workstreams.test.js`

- [ ] **Step 1: Write failing backend activity tests**

Add `test/sessions-activity-state.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  sessionActivityIso,
  isSessionEnded,
  isLiveEligibleSession,
  shouldReapIdleSession,
  liveSortIso,
} = require("../src/lib/sessions/activity-state");

test("sessionActivityIso prefers last_observed_at over updated_at", () => {
  const row = {
    started_at: "2026-04-01T00:00:00.000Z",
    last_observed_at: "2026-04-01T00:05:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
  };
  assert.equal(sessionActivityIso(row), "2026-04-01T00:05:00.000Z");
});

test("live eligibility rejects old open rows even if updated_at is fresh", () => {
  const row = {
    ended_at: null,
    state: "live",
    started_at: "2026-04-01T00:00:00.000Z",
    last_observed_at: "2026-04-01T00:05:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
  };
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:00:00.000Z",
    idleTimeoutMin: 60,
  }), false);
  assert.equal(shouldReapIdleSession(row, {
    now: "2026-05-12T00:00:00.000Z",
    idleTimeoutMin: 60,
  }), true);
});

test("live eligibility keeps fresh open rows", () => {
  const row = {
    ended_at: null,
    state: "live",
    started_at: "2026-05-12T00:00:00.000Z",
    last_observed_at: "2026-05-12T00:15:00.000Z",
    updated_at: "2026-05-12T00:16:00.000Z",
  };
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:30:00.000Z",
    idleTimeoutMin: 60,
  }), true);
});

test("ended sessions are never live eligible but still sort by observed activity", () => {
  const row = {
    ended_at: "2026-05-12T00:20:00.000Z",
    last_observed_at: "2026-05-12T00:19:00.000Z",
    updated_at: "2026-05-12T00:30:00.000Z",
  };
  assert.equal(isSessionEnded(row), true);
  assert.equal(isLiveEligibleSession(row, {
    now: "2026-05-12T00:30:00.000Z",
    idleTimeoutMin: 60,
  }), false);
  assert.equal(liveSortIso(row), "2026-05-12T00:19:00.000Z");
});
```

Run: `rtk node --test test/sessions-activity-state.test.js`

Expected: FAIL with `Cannot find module '../src/lib/sessions/activity-state'`.

- [ ] **Step 2: Implement activity helpers**

Create `src/lib/sessions/activity-state.js`:

```js
'use strict';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function validIso(value) {
  if (!isNonEmptyString(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? value : null;
}

function isoMs(value) {
  const iso = validIso(value);
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

function sessionActivityIso(row) {
  return (
    validIso(row?.last_observed_at) ||
    validIso(row?.observed_at) ||
    validIso(row?.ended_at) ||
    validIso(row?.started_at) ||
    validIso(row?.created_at) ||
    null
  );
}

function liveSortIso(row) {
  return sessionActivityIso(row) || validIso(row?.updated_at) || '';
}

function isSessionEnded(row) {
  if (!row) return false;
  if (isNonEmptyString(row.ended_at)) return true;
  return String(row.state || '').trim().toLowerCase() === 'ended';
}

function isLiveEligibleSession(row, { now = new Date(), idleTimeoutMin } = {}) {
  if (!row || isSessionEnded(row)) return false;
  const timeout = Number(idleTimeoutMin);
  if (!Number.isFinite(timeout) || timeout <= 0) return true;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const activityMs = isoMs(sessionActivityIso(row));
  if (!Number.isFinite(nowMs) || !Number.isFinite(activityMs)) return false;
  return nowMs - activityMs <= timeout * 60 * 1000;
}

function shouldReapIdleSession(row, { now = new Date(), idleTimeoutMin } = {}) {
  if (!row || isSessionEnded(row)) return false;
  const timeout = Number(idleTimeoutMin);
  if (!Number.isFinite(timeout) || timeout <= 0) return false;
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now));
  const activityMs = isoMs(sessionActivityIso(row));
  if (!Number.isFinite(nowMs) || !Number.isFinite(activityMs)) return false;
  return nowMs - activityMs > timeout * 60 * 1000;
}

module.exports = {
  sessionActivityIso,
  liveSortIso,
  isSessionEnded,
  isLiveEligibleSession,
  shouldReapIdleSession,
};
```

- [ ] **Step 3: Update stale reaper to use `last_observed_at`**

Modify `src/lib/sessions/reaper.js`:

```js
const { sessionActivityIso, shouldReapIdleSession } = require('./activity-state');
```

Change the live query:

```sql
SELECT provider, session_id, started_at, last_observed_at, updated_at
FROM vibedeck_sessions
WHERE ended_at IS NULL
```

Change the loop:

```js
const lastActivityIso = sessionActivityIso(row);
if (!lastActivityIso) continue;
if (shouldReapIdleSession(row, { now: nowDate, idleTimeoutMin: timeoutMin })) {
  update.run(lastActivityIso, endReason, nowDate.toISOString(), row.provider, row.session_id);
  reaped += 1;
}
```

Extend the function signature:

```js
function reapOrphanedSessions(dbPath, { now, idleTimeoutMin, endReason = 'orphan_reaped' } = {}) {
```

- [ ] **Step 4: Update backend workstream fallback ordering**

Modify `src/lib/sessions/workstreams.js`:

```js
const {
  isSessionEnded,
  sessionActivityIso,
  liveSortIso,
} = require('./activity-state');
```

Change `isActiveSession(row)` to:

```js
function isActiveSession(row) {
  return !isSessionEnded(row);
}
```

Change `sessionEnd(row, fallbackNow)` so `updated_at` is not activity:

```js
function sessionEnd(row, fallbackNow) {
  return parseTime(row?.ended_at)
    ?? parseTime(sessionActivityIso(row))
    ?? sessionStart(row, fallbackNow);
}
```

Change final sort:

```js
}).sort((a, b) => String(liveSortIso(b.primary_session) || b.updated_at || '').localeCompare(
  String(liveSortIso(a.primary_session) || a.updated_at || ''),
));
```

- [ ] **Step 5: Update frontend fallback workstream ordering**

Modify `dashboard/src/lib/live-workstreams.js`:

```js
function sessionActivityAt(row) {
  return row?.last_observed_at || row?.observed_at || row?.ended_at || row?.started_at || row?.created_at || null;
}

function sessionEnd(row, now = Date.now()) {
  return parseTime(row?.ended_at)
    ?? parseTime(sessionActivityAt(row))
    ?? sessionStart(row, now);
}
```

Do not use `updated_at` in `sessionEnd()`. Keep it only as a final display fallback where no activity time exists.

- [ ] **Step 6: Add live snapshot stale-regression test**

Modify `test/local-api-vibedeck-sessions-live-snapshot.test.js` with a test that inserts an open row whose `last_observed_at` is old and `updated_at` is fresh:

```js
test("GET /functions/vibedeck-sessions-live-snapshot reaps old open rows using last_observed_at", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-snapshot-reap-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const oldObserved = "2026-04-01T00:05:00.000Z";
  const freshMutation = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      created_at, updated_at
    ) VALUES (
      'claude', 'old-open', '2026-04-01T00:00:00.000Z', NULL, NULL,
      '/tmp/repo', '/tmp/repo', NULL, NULL,
      'main', 'A', 'high', NULL,
      'claude-sonnet-4', 1000, 0.01, '${oldObserved}',
      '2026-04-01T00:00:00.000Z', '${freshMutation}'
    );
  `);
  db.close();

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest({ method: "GET" });
  const res = createResponse();
  await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  const payload = parseResponseJson(res);
  assert.deepEqual(payload.sessions.map((row) => row.session_id), []);

  const verify = new DatabaseSync(dbPath, { readOnly: true });
  const row = verify.prepare("SELECT ended_at, end_reason FROM vibedeck_sessions WHERE session_id = 'old-open'").get();
  verify.close();
  assert.equal(row.ended_at, oldObserved);
  assert.equal(row.end_reason, "orphan_reaped");

  await fs.rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 7: Run activity tests**

Run:

```bash
rtk node --test test/sessions-activity-state.test.js test/local-api-vibedeck-sessions-live-snapshot.test.js
rtk npm --prefix dashboard run test -- src/lib/live-workstreams.test.js
```

Expected: all listed tests pass after implementation.

- [ ] **Step 8: Commit**

```bash
rtk git add src/lib/sessions/activity-state.js src/lib/sessions/reaper.js src/lib/sessions/workstreams.js src/lib/local-api.js dashboard/src/lib/live-workstreams.js test/sessions-activity-state.test.js test/local-api-vibedeck-sessions-live-snapshot.test.js dashboard/src/lib/live-workstreams.test.js
rtk git commit -m "fix: use observed activity for live sessions"
```

---

### Task 2: Build Backend Live Audit Rollups

**Files:**
- Create: `src/lib/sessions/live-rollups.js`
- Modify: `src/lib/local-api.js`
- Test: `test/sessions-live-rollups.test.js`
- Test: `test/local-api-vibedeck-live-rollups.test.js`

- [ ] **Step 1: Write failing live rollup tests**

Add `test/sessions-live-rollups.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { readLiveAuditRollups } = require("../src/lib/sessions/live-rollups");

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-live-rollups-"));
  const dbPath = path.join(dir, "vibedeck.sqlite3");
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, @end_reason,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens, @output_tokens, @reasoning_output_tokens,
      @cost_estimated, @cost_quality, @created_at, @updated_at
    )
  `).run({
    end_reason: null,
    cwd: null,
    repo_common_dir: null,
    parent_repo: null,
    branch_resolution_tier: "A",
    confidence: "high",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_estimated: 0,
    cost_quality: "stored",
    created_at: row.started_at,
    updated_at: row.last_observed_at || row.ended_at || row.started_at,
    ...row,
  });
}

test("rollups include historical plus active cost for projects with active sessions", () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, {
      provider: "codex",
      session_id: "past-main",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:20:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 1000,
      total_cost_usd: 1.25,
      last_observed_at: "2026-05-12T00:20:00.000Z",
    });
    insertSession(db, {
      provider: "claude",
      session_id: "active-feature",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "feature/live",
      model: "claude-sonnet-4",
      total_tokens: 2000,
      total_cost_usd: 2.75,
      last_observed_at: "2026-05-12T01:10:00.000Z",
    });
    db.close();

    const payload = readLiveAuditRollups(tmp.dbPath, {
      now: "2026-05-12T01:15:00.000Z",
      idleTimeoutMin: 60,
      recentEndedMs: 60 * 60 * 1000,
    });

    assert.equal(payload.sessions.length, 2);
    assert.equal(payload.active_sessions.length, 1);
    assert.equal(payload.workstreams.length, 1);
    assert.equal(payload.workstreams[0].project_ref, "/repo/VibeDeck");
    assert.equal(payload.workstreams[0].active_total_tokens, 2000);
    assert.equal(payload.workstreams[0].active_total_cost_usd, 2.75);
    assert.equal(payload.workstreams[0].audit_total_tokens, 3000);
    assert.equal(payload.workstreams[0].audit_total_cost_usd, 4.0);
    assert.deepEqual(payload.workstreams[0].providers.map((row) => row.provider).sort(), ["claude", "codex"]);
    assert.deepEqual(payload.workstreams[0].branch_groups.map((row) => row.branch).sort(), ["feature/live", "main"]);
    assert.equal(payload.totals.active_tokens, 2000);
    assert.equal(payload.totals.audit_tokens, 3000);
  } finally {
    tmp.cleanup();
  }
});

test("rollups do not attach unrelated historical projects without active sessions", () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, {
      provider: "codex",
      session_id: "old-other",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:10:00.000Z",
      repo_root: "/repo/Other",
      parent_repo: "/repo/Other",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 999,
      total_cost_usd: 9.99,
      last_observed_at: "2026-05-12T00:10:00.000Z",
    });
    db.close();

    const payload = readLiveAuditRollups(tmp.dbPath, {
      now: "2026-05-12T01:15:00.000Z",
      idleTimeoutMin: 60,
      recentEndedMs: 60 * 60 * 1000,
    });

    assert.equal(payload.active_sessions.length, 0);
    assert.equal(payload.workstreams.length, 0);
    assert.equal(payload.totals.audit_tokens, 0);
  } finally {
    tmp.cleanup();
  }
});
```

Run: `rtk node --test test/sessions-live-rollups.test.js`

Expected: FAIL with `Cannot find module '../src/lib/sessions/live-rollups'`.

- [ ] **Step 2: Implement the live rollup read model**

Create `src/lib/sessions/live-rollups.js` with these exported functions:

```js
module.exports = {
  readLiveAuditRollups,
  buildLiveAuditRollups,
  projectScopeKey,
};
```

Core implementation rules:

- Query `vibedeck_sessions` only after calling `reapOrphanedSessions()`.
- Active rows are open rows where `isLiveEligibleSession(row, { now, idleTimeoutMin })` is true.
- Recent-ended rows are ended rows where `ended_at >= now - recentEndedMs`.
- Active project scopes are derived from active rows:
  - If `parent_repo || repo_common_dir || repo_root` exists, scope by project root.
  - Else if `repo_root` exists, scope by repo root.
  - Else if `cwd` exists, scope by cwd and set `audit_scope: "cwd_only"`.
  - Else scope by `provider:session_id` and set `audit_scope: "session_only"`.
- Audit rows include every session whose project scope matches an active project scope. They include ended and active sessions.
- The payload `sessions` includes active rows plus recent-ended rows only. The payload `workstreams` includes audit totals for active scopes.
- Cost totals must use stored canonical session/bucket facts first. Use `resolveUsageCost()` only when stored cost is missing, and expose unknown cost counts rather than converting unknowns to zero.
- Branch null, empty, or whitespace becomes `"unattributed"`.
- Model null, empty, or whitespace becomes `"unknown"`.

Required output shape:

```js
{
  sessions: [],
  active_sessions: [],
  recent_sessions: [],
  workstreams: [
    {
      id: "project:<stable hash>",
      audit_scope: "project",
      project_key: "VibeDeck",
      project_ref: "/repo/VibeDeck",
      repo_root: "/repo/VibeDeck",
      cwd: null,
      branches: ["feature/live", "main"],
      sessions: [],
      primary_session: {},
      active_session_count: 1,
      recently_completed_count: 0,
      audit_session_count: 2,
      active_total_tokens: 2000,
      active_total_cost_usd: 2.75,
      active_known_cost_usd: 2.75,
      active_cost_unknown_count: 0,
      audit_total_tokens: 3000,
      audit_total_cost_usd: 4.0,
      audit_known_cost_usd: 4.0,
      audit_cost_unknown_count: 0,
      providers: [],
      models: [],
      branch_groups: [],
      updated_at: "2026-05-12T01:10:00.000Z"
    }
  ],
  totals: {
    active_sessions: 1,
    active_projects: 1,
    active_tokens: 2000,
    active_cost_usd: 2.75,
    active_known_cost_usd: 2.75,
    active_cost_unknown_count: 0,
    audit_tokens: 3000,
    audit_cost_usd: 4.0,
    audit_known_cost_usd: 4.0,
    audit_cost_unknown_count: 0
  }
}
```

- [ ] **Step 3: Make `readLiveSessionsSnapshot()` use backend rollups**

Modify `src/lib/local-api.js`:

```js
const { readLiveAuditRollups } = require("./sessions/live-rollups");
```

Replace the body of `readLiveSessionsSnapshot(queuePath)` after `dbPath` resolution with:

```js
const generatedAt = new Date().toISOString();
const rollups = readLiveAuditRollups(dbPath, {
  now: generatedAt,
  idleTimeoutMin: getIdleTimeoutMin(),
  recentEndedMs: LIVE_RECENT_ENDED_MS,
});
return {
  ...rollups,
  generated_at: generatedAt,
  last_sync_at: rollups.last_sync_at || null,
};
```

Keep `enrichLiveSessionCost()` only if `live-rollups.js` calls it for session row display. Do not use it as the source of project/workstream totals.

- [ ] **Step 4: Add endpoint contract test**

Add `test/local-api-vibedeck-live-rollups.test.js`:

```js
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");

function createRequest({ method = "GET" } = {}) {
  const req = new EventEmitter();
  req.method = method;
  process.nextTick(() => req.emit("end"));
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

test("live snapshot returns backend workstreams with active and audit totals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-rollup-api-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES
    ('codex', 'past', '2026-05-12T00:00:00.000Z', '2026-05-12T00:30:00.000Z', 'complete',
     '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
     'main', 'A', 'high', NULL,
     'gpt-5.5', 1000, 1.25, '2026-05-12T00:30:00.000Z',
     0, 'stored', '2026-05-12T00:00:00.000Z', '2026-05-12T00:30:00.000Z'),
    ('claude', 'active', '2026-05-12T01:00:00.000Z', NULL, NULL,
     '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
     'feature/live', 'A', 'high', NULL,
     'claude-sonnet-4', 2000, 2.75, '${new Date().toISOString()}',
     0, 'stored', '2026-05-12T01:00:00.000Z', '${new Date().toISOString()}');
  `);
  db.close();

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest();
  const res = createResponse();
  await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body.toString("utf8"));
  assert.equal(Array.isArray(payload.workstreams), true);
  assert.equal(payload.workstreams.length, 1);
  assert.equal(payload.workstreams[0].active_total_tokens, 2000);
  assert.equal(payload.workstreams[0].audit_total_tokens, 3000);
  assert.equal(payload.workstreams[0].audit_total_cost_usd, 4);
  assert.equal(payload.totals.active_tokens, 2000);
  assert.equal(payload.totals.audit_tokens, 3000);

  await fs.rm(root, { recursive: true, force: true });
});
```

- [ ] **Step 5: Run rollup tests**

Run:

```bash
rtk node --test test/sessions-live-rollups.test.js test/local-api-vibedeck-live-rollups.test.js
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/sessions/live-rollups.js src/lib/local-api.js test/sessions-live-rollups.test.js test/local-api-vibedeck-live-rollups.test.js
rtk git commit -m "feat: add canonical live audit rollups"
```

---

### Task 3: Fix Live SSE Payloads and Freshness

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `src/commands/sync.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`
- Test: `test/local-api-vibedeck-sessions-live-snapshot.test.js`

- [ ] **Step 1: Add failing freshness and SSE contract tests**

Modify `test/local-api-vibedeck-sessions-live-snapshot.test.js` so the first test expects an empty queue file not to become freshness:

```js
assert.equal(payload.last_sync_at, null);
```

Add a row to `cursors.json` in a separate test:

```js
await fs.writeFile(path.join(trackerDir, "cursors.json"), JSON.stringify({
  updatedAt: "2026-05-12T01:00:00.000Z",
}), "utf8");
```

Then assert:

```js
assert.equal(payload.last_sync_at, "2026-05-12T01:00:00.000Z");
```

Modify `test/local-api-vibedeck-sessions-live.test.js` to assert snapshot SSE payloads contain `workstreams` and `totals` from backend rollups:

```js
const snapshot = events.find((event) => event.type === "snapshot");
assert.equal(Array.isArray(snapshot.workstreams), true);
assert.equal(typeof snapshot.totals, "object");
assert.equal(snapshot.totals.active_sessions, 1);
```

Run:

```bash
rtk node --test test/local-api-vibedeck-sessions-live-snapshot.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected: FAIL because queue mtime is still used and SSE updates do not carry rollup state.

- [ ] **Step 2: Replace queue mtime freshness**

In `src/lib/local-api.js`, add:

```js
function readCanonicalLastSyncAt(trackerDir) {
  try {
    const cursorsPath = path.join(trackerDir, "cursors.json");
    const parsed = JSON.parse(fs.readFileSync(cursorsPath, "utf8"));
    const value = typeof parsed?.updatedAt === "string" ? parsed.updatedAt : null;
    if (value && Number.isFinite(Date.parse(value))) return value;
  } catch {}
  return null;
}
```

Use it in `readLiveSessionsSnapshot()`:

```js
const lastSyncAt = readCanonicalLastSyncAt(trackerDir);
```

Do not call `fs.statSync(queuePath).mtime` for Live freshness.

- [ ] **Step 3: Send backend rollups in SSE snapshots and updates**

Create a local helper in `src/lib/local-api.js`:

```js
function readLiveSnapshotForSse(queuePath) {
  return readLiveSessionsSnapshot(queuePath);
}
```

Change the initial SSE snapshot to spread the snapshot:

```js
enqueue({
  type: "snapshot",
  ...readLiveSnapshotForSse(qp),
});
```

Change `session:start`, `session:update`, and `session:end` handlers so they enqueue the event row for low-latency row updates and a coalesced backend rollup update:

```js
function enqueueRollupUpdate() {
  if (client.rollupScheduled) return;
  client.rollupScheduled = true;
  setTimeout(() => {
    client.rollupScheduled = false;
    if (client.closed) return;
    try {
      enqueue({
        type: "rollup:update",
        ...readLiveSnapshotForSse(qp),
      });
    } catch (cause) {
      enqueue({
        type: "rollup:error",
        message: cause?.message || String(cause),
      });
    }
  }, 500);
}
```

Call `enqueueRollupUpdate()` after each session event enqueue.

This coalescing keeps Live accurate without recomputing canonical rollups for every bus event burst.

- [ ] **Step 4: Run endpoint tests**

Run:

```bash
rtk node --test test/local-api-vibedeck-sessions-live-snapshot.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/local-api.js test/local-api-vibedeck-sessions-live.test.js test/local-api-vibedeck-sessions-live-snapshot.test.js
rtk git commit -m "fix: stream canonical live rollups"
```

---

### Task 4: Update Frontend Live State to Use Backend Rollups

**Files:**
- Modify: `dashboard/src/hooks/use-vibedeck-live-sessions.ts`
- Modify: `dashboard/src/lib/live-workstreams.js`
- Modify: `dashboard/src/pages/LivePage.jsx`
- Test: `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`
- Test: `dashboard/src/lib/live-workstreams.test.js`

- [ ] **Step 1: Write failing hook tests for rollup state**

Modify `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`:

```ts
it("stores backend workstreams and totals from snapshot events", () => {
  const { result } = renderHook(() => useVibeDeckLiveSessions());
  const source = MockEventSource.instances[0];

  act(() => {
    source.emitMessage(JSON.stringify({
      type: "snapshot",
      sessions: [{ provider: "codex", session_id: "s1", total_tokens: 1 }],
      workstreams: [{
        id: "project:vibedeck",
        active_session_count: 1,
        active_total_tokens: 1,
        audit_total_tokens: 101,
        audit_total_cost_usd: 4.5,
      }],
      totals: {
        active_sessions: 1,
        active_tokens: 1,
        audit_tokens: 101,
        audit_cost_usd: 4.5,
      },
      generated_at: "2026-05-12T00:00:00.000Z",
      last_sync_at: "2026-05-12T00:00:00.000Z",
    }));
  });

  expect(result.current.sessions).toHaveLength(1);
  expect(result.current.workstreams).toHaveLength(1);
  expect(result.current.totals.audit_tokens).toBe(101);
  expect(result.current.generatedAt).toBe("2026-05-12T00:00:00.000Z");
  expect(result.current.lastSyncAt).toBe("2026-05-12T00:00:00.000Z");
});

it("replaces backend rollups on rollup:update while preserving session rows", () => {
  const { result } = renderHook(() => useVibeDeckLiveSessions());
  const source = MockEventSource.instances[0];

  act(() => {
    source.emitMessage(JSON.stringify({
      type: "snapshot",
      sessions: [{ provider: "codex", session_id: "s1", total_tokens: 1 }],
      workstreams: [],
      totals: { active_tokens: 1, audit_tokens: 1 },
    }));
  });

  act(() => {
    source.emitMessage(JSON.stringify({
      type: "rollup:update",
      sessions: [{ provider: "codex", session_id: "s1", total_tokens: 2 }],
      workstreams: [{ id: "project:vibedeck", audit_total_tokens: 200 }],
      totals: { active_tokens: 2, audit_tokens: 200 },
    }));
  });

  expect(result.current.sessions[0].total_tokens).toBe(2);
  expect(result.current.workstreams[0].audit_total_tokens).toBe(200);
  expect(result.current.totals.audit_tokens).toBe(200);
});
```

Run: `rtk npm --prefix dashboard run test -- src/hooks/use-vibedeck-live-sessions.test.ts`

Expected: FAIL because the hook returns only `sessions`, `status`, and `error`.

- [ ] **Step 2: Replace array reducer with payload reducer**

In `dashboard/src/hooks/use-vibedeck-live-sessions.ts`, add:

```ts
type LivePayloadState = {
  sessions: LiveSession[];
  workstreams: Record<string, any>[];
  totals: Record<string, any>;
  generatedAt: string | null;
  lastSyncAt: string | null;
  canonicalIncomplete: boolean;
};

const EMPTY_TOTALS: Record<string, any> = {};

const EMPTY_STATE: LivePayloadState = {
  sessions: [],
  workstreams: [],
  totals: EMPTY_TOTALS,
  generatedAt: null,
  lastSyncAt: null,
  canonicalIncomplete: false,
};
```

Keep `reduceLiveSessionEvent(prevSessions, event)` exported for compatibility tests, but implement a new exported reducer:

```ts
export function reduceLivePayloadEvent(prev: LivePayloadState, event: LiveSessionEvent): LivePayloadState {
  if (!isRecord(event)) return prev;
  if (event.type === "snapshot" || event.type === "rollup:update") {
    return {
      sessions: reduceLiveSessionEvent(prev.sessions, { ...event, type: "snapshot" }),
      workstreams: Array.isArray(event.workstreams) ? event.workstreams.filter(isRecord) : prev.workstreams,
      totals: isRecord(event.totals) ? { ...event.totals } : prev.totals,
      generatedAt: typeof event.generated_at === "string" ? event.generated_at : prev.generatedAt,
      lastSyncAt: typeof event.last_sync_at === "string" ? event.last_sync_at : prev.lastSyncAt,
      canonicalIncomplete: Boolean(event.canonical_incomplete ?? prev.canonicalIncomplete),
    };
  }
  if (event.type === "rollup:error") return prev;
  return {
    ...prev,
    sessions: reduceLiveSessionEvent(prev.sessions, event),
  };
}
```

Change the hook state:

```ts
const [payload, setPayload] = useState<LivePayloadState>(EMPTY_STATE);
```

Change message handling:

```ts
setPayload((prev) => reduceLivePayloadEvent(prev, parsed));
```

Return:

```ts
return useMemo(() => ({
  ...payload,
  status,
  error,
}), [payload, status, error]);
```

- [ ] **Step 3: Fix hook sorting to prefer observed activity**

Change `sortByRecent()`:

```ts
function sortKey(row: LiveSession): string {
  return String(row.last_observed_at || row.observed_at || row.ended_at || row.started_at || row.created_at || row.updated_at || "");
}

function sortByRecent(rows: LiveSession[]): LiveSession[] {
  return rows.slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}
```

- [ ] **Step 4: Update `LivePage` to pass rollups**

Modify `dashboard/src/pages/LivePage.jsx`:

```js
const { sessions, workstreams, totals, status, error, canonicalIncomplete } = useVibeDeckLiveSessions();
```

Pass:

```jsx
<LiveWorkbenchOverview
  sessions={sessions}
  workstreams={workstreams}
  totals={totals}
  canonicalIncomplete={canonicalIncomplete}
  status={status}
  limits={usageLimits}
/>
```

Pass to `LiveOperationsPanel`:

```jsx
<LiveOperationsPanel
  sessions={sessions}
  workstreams={workstreams}
  totals={totals}
  ...
/>
```

- [ ] **Step 5: Run frontend hook tests**

Run:

```bash
rtk npm --prefix dashboard run test -- src/hooks/use-vibedeck-live-sessions.test.ts src/lib/live-workstreams.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
rtk git add dashboard/src/hooks/use-vibedeck-live-sessions.ts dashboard/src/lib/live-workstreams.js dashboard/src/pages/LivePage.jsx dashboard/src/hooks/use-vibedeck-live-sessions.test.ts dashboard/src/lib/live-workstreams.test.js
rtk git commit -m "feat: keep live rollup state in dashboard"
```

---

### Task 5: Render Active Totals and Audit Totals Separately

**Files:**
- Modify: `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
- Modify: `dashboard/src/components/live/LiveOperationsPanel.jsx`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/components/live/LiveWorkbenchOverview.test.jsx`
- Test: `dashboard/src/components/live/LiveSessionList.test.jsx`

- [ ] **Step 1: Write failing overview test**

Modify `dashboard/src/components/live/LiveWorkbenchOverview.test.jsx`:

```jsx
it("shows active-session totals separately from active-project audit totals", () => {
  render(
    <LiveWorkbenchOverview
      status="connected"
      sessions={[
        {
          provider: "codex",
          session_id: "active",
          repo_root: "/repo/vibedeck",
          branch: "main",
          confidence: "high",
          total_tokens: 100,
          estimated_total_cost_usd: 0.5,
          cost_quality: "estimated_total_tokens",
        },
      ]}
      totals={{
        active_sessions: 1,
        active_tokens: 100,
        active_cost_usd: 0.5,
        audit_tokens: 1100,
        audit_cost_usd: 5.5,
        active_projects: 1,
      }}
      workstreams={[
        {
          id: "project:vibedeck",
          audit_total_tokens: 1100,
          audit_total_cost_usd: 5.5,
          active_total_tokens: 100,
          active_total_cost_usd: 0.5,
        },
      ]}
      limits={{}}
    />,
  );

  expect(screen.getByText("Project total")).toBeTruthy();
  expect(screen.getByText("Live now")).toBeTruthy();
  expect(screen.getByText("$5.50")).toBeTruthy();
  expect(screen.getByText("$0.50")).toBeTruthy();
});
```

Run: `rtk npm --prefix dashboard run test -- src/components/live/LiveWorkbenchOverview.test.jsx`

Expected: FAIL because the component only computes active row totals.

- [ ] **Step 2: Update overview component**

Modify `LiveWorkbenchOverview` props:

```js
export function LiveWorkbenchOverview({
  sessions = [],
  workstreams = [],
  totals = null,
  status = "idle",
  limits = null,
  canonicalIncomplete = false,
}) {
```

Compute display totals:

```js
const activeTokens = Number(totals?.active_tokens ?? model.tokens ?? 0) || 0;
const activeCost = Number(totals?.active_cost_usd ?? model.cost ?? 0) || 0;
const auditTokens = Number(totals?.audit_tokens ?? activeTokens) || 0;
const auditCost = Number(totals?.audit_cost_usd ?? activeCost) || 0;
const activeProjectCount = Number(totals?.active_projects ?? workstreams.length ?? 0) || 0;
```

Render the large counter as project audit tokens and the cost line as project audit cost:

```jsx
<Counter value={auditTokens} displayValue={toDisplayNumber(auditTokens)} ... />
...
<Counter value={auditCost} displayValue={formatUsdCurrency(auditCost.toFixed(2), { decimals: 2 })} ... />
<span className="ml-1">project total</span>
```

Add tiles:

```jsx
<OverviewTile icon={Radio} label="Live sessions" value={model.active.length} />
<OverviewTile icon={Activity} label="Active projects" value={activeProjectCount} />
<OverviewTile icon={Cpu} label="Live now" value={formatCompactNumber(activeTokens, { decimals: 1 })} />
<OverviewTile icon={CircleDollarSign} label="Live cost" value={formatUsdCurrency(activeCost.toFixed(2))} />
<OverviewTile icon={Cpu} label="Project total" value={formatCompactNumber(auditTokens, { decimals: 1 })} />
<OverviewTile icon={ShieldCheck} label="Limit sources" value={limitSummary.recorded} />
```

If `canonicalIncomplete` is true, show a small warning:

```jsx
{canonicalIncomplete ? (
  <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
    Canonical backfill is incomplete. Live audit totals may exclude older sessions until rebuild finishes.
  </div>
) : null}
```

- [ ] **Step 3: Write failing workstream list test for backend rollups**

Modify `dashboard/src/components/live/LiveSessionList.test.jsx`:

```jsx
it("prefers backend workstream audit totals over locally rebuilt active rows", () => {
  render(
    <LiveSessionList
      streamStatus="connected"
      selectedKey="codex:active"
      onSelectSession={() => {}}
      sessions={[
        {
          provider: "codex",
          session_id: "active",
          repo_root: "/repo/VibeDeck",
          branch: "main",
          total_tokens: 100,
          total_cost_usd: 0.5,
        },
      ]}
      workstreams={[
        {
          id: "project:vibedeck",
          repo_root: "/repo/VibeDeck",
          branches: ["main", "feature/past"],
          primary_session: { provider: "codex", session_id: "active", model: "gpt-5.5" },
          sessions: [{ provider: "codex", session_id: "active", model: "gpt-5.5" }],
          active_session_count: 1,
          recently_completed_count: 0,
          active_total_tokens: 100,
          active_total_cost_usd: 0.5,
          audit_total_tokens: 1100,
          audit_total_cost_usd: 5.5,
          audit_cost_unknown_count: 0,
          branch_groups: [],
        },
      ]}
    />,
  );

  expect(screen.getByText("1,100")).toBeTruthy();
  expect(screen.getByText("$5.50")).toBeTruthy();
  expect(screen.getByText(/feature\/past, main|main, feature\/past/)).toBeTruthy();
});
```

- [ ] **Step 4: Update `LiveOperationsPanel` and `LiveSessionList` props**

Modify `LiveOperationsPanel`:

```jsx
export function LiveOperationsPanel({
  sessions,
  workstreams,
  totals,
  selectedKey,
  ...
}) {
```

Pass through:

```jsx
<LiveSessionList
  sessions={sessions}
  workstreams={workstreams}
  totals={totals}
  ...
/>
```

Modify `LiveSessionList`:

```js
export function LiveSessionList({
  sessions = [],
  workstreams: backendWorkstreams = [],
  totals = null,
  ...
}) {
```

Prefer backend workstreams:

```js
const fallbackWorkstreams = React.useMemo(() => buildLiveWorkstreams(sessions), [sessions]);
const workstreams = Array.isArray(backendWorkstreams) && backendWorkstreams.length > 0
  ? backendWorkstreams
  : fallbackWorkstreams;
const visibleWorkstreams = workstreams.filter((workstream) => Number(workstream.active_session_count || 0) > 0);
```

Display audit totals on the card:

```js
function workstreamTokens(workstream) {
  return Number(workstream?.audit_total_tokens ?? workstream?.total_tokens ?? 0) || 0;
}

function formatWorkstreamCost(workstream) {
  const unknown = Number(workstream?.audit_cost_unknown_count ?? workstream?.cost_unknown_count ?? 0);
  if (unknown > 0) return "—";
  const n = Number(workstream?.audit_total_cost_usd ?? workstream?.total_cost_usd);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUsdCurrency(n.toFixed(2));
  return formatted === "-" ? "—" : formatted;
}
```

Use labels:

```jsx
<MetaItem icon={Radio} label="Project tokens" value={toDisplayNumber(workstreamTokens(workstream))} />
<MetaItem icon={CircleDollarSign} label="Project cost" value={formatWorkstreamCost(workstream)} />
<MetaItem icon={CirclePlay} label="Live now" value={toDisplayNumber(workstream.active_total_tokens ?? 0)} />
```

- [ ] **Step 5: Update drawer to show audit plus active**

Modify `LiveWorkstreamDrawer.jsx`:

```js
const auditCost = workstream && Number(workstream?.audit_cost_unknown_count ?? workstream?.cost_unknown_count ?? 0) > 0
  ? null
  : (workstream?.audit_total_cost_usd ?? workstream?.total_cost_usd);
const activeCost = workstream && Number(workstream?.active_cost_unknown_count || 0) > 0
  ? null
  : workstream?.active_total_cost_usd;
```

Render metrics:

```jsx
<Metric icon={Radio} label="Project tokens" value={toDisplayNumber(workstream.audit_total_tokens ?? workstream.total_tokens ?? 0)} />
<Metric icon={CircleDollarSign} label="Project cost" value={formatCost(auditCost)} />
<Metric icon={Radio} label="Live tokens" value={toDisplayNumber(workstream.active_total_tokens ?? 0)} />
<Metric icon={CircleDollarSign} label="Live cost" value={formatCost(activeCost)} />
```

For each branch group, display branch audit totals:

```jsx
<span>{toDisplayNumber(group.audit_total_tokens ?? group.total_tokens ?? 0)} tokens</span>
<span>{formatCost(group.audit_total_cost_usd ?? group.total_cost_usd)}</span>
```

- [ ] **Step 6: Add copy strings**

Add to `dashboard/src/content/copy.csv`:

```csv
live.metric.project_total,dashboard,LivePage,LiveWorkbenchOverview,metric_project_total,Project total,,active
live.metric.live_now,dashboard,LivePage,LiveWorkbenchOverview,metric_live_now,Live now,,active
live.metric.project_cost,dashboard,LivePage,LiveSessionList,metric_project_cost,Project cost,,active
live.metric.project_tokens,dashboard,LivePage,LiveSessionList,metric_project_tokens,Project tokens,,active
live.warning.canonical_incomplete,dashboard,LivePage,LiveWorkbenchOverview,canonical_incomplete,Canonical backfill is incomplete. Live audit totals may exclude older sessions until rebuild finishes.,,active
```

- [ ] **Step 7: Run component tests**

Run:

```bash
rtk npm --prefix dashboard run test -- src/components/live/LiveWorkbenchOverview.test.jsx src/components/live/LiveSessionList.test.jsx
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
rtk git add dashboard/src/components/live/LiveWorkbenchOverview.jsx dashboard/src/components/live/LiveOperationsPanel.jsx dashboard/src/components/live/LiveSessionList.jsx dashboard/src/components/live/LiveWorkstreamDrawer.jsx dashboard/src/content/copy.csv dashboard/src/components/live/LiveWorkbenchOverview.test.jsx dashboard/src/components/live/LiveSessionList.test.jsx
rtk git commit -m "feat: show live audit totals in dashboard"
```

---

### Task 6: Preserve Branch Audit Totals for Active Sessions

**Files:**
- Modify: `src/lib/branch-usage.js`
- Modify: `src/lib/sessions/live-rollups.js`
- Test: `test/local-api-vibedeck-branch-usage.test.js`
- Test: `test/sessions-live-rollups.test.js`

- [ ] **Step 1: Add failing branch usage test for active sessions**

Modify `test/local-api-vibedeck-branch-usage.test.js` with a DB fixture where a session is open and has no row in `vibedeck_session_branch_windows`:

```js
test('GET /functions/vibedeck-branch-usage uses last_observed_at for open-session branch rows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-open-observed-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['feature/live', 'main']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd, last_observed_at,
        cost_estimated, cost_quality, created_at, updated_at
      ) VALUES (
        'claude', 'open-branch', '2026-05-12T01:00:00.000Z', NULL, NULL,
        '${repoRoot}', '${repoRoot}', NULL, '${repoRoot}',
        'feature/live', 'A', 'high', NULL,
        'claude-sonnet-4', 2000, 2.5, '2026-05-12T01:15:00.000Z',
        0, 'stored', '2026-05-12T01:00:00.000Z', '2026-05-12T01:16:00.000Z'
      );
    `);
    db.close();

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1'),
    );

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body.toString('utf8'));
    const repo = payload.repos.find((row) => row.repo_root === repoRoot);
    const branch = repo.branches.find((row) => row.branch === 'feature/live');
    assert.equal(branch.total_tokens, 2000);
    assert.equal(branch.total_cost_usd, 2.5);
    assert.equal(branch.last_seen_at, '2026-05-12T01:15:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
```

Run: `rtk node --test test/local-api-vibedeck-branch-usage.test.js`

Expected: FAIL if `last_seen_at` or active session attribution uses `started_at`/`ended_at` incorrectly.

- [ ] **Step 2: Update branch source rows**

Modify `src/lib/branch-usage.js` fallback `SELECT` to expose a provisional end:

```sql
COALESCE(s.ended_at, s.last_observed_at, s.started_at) AS ended_at
```

Change filters to use activity, not only start:

```sql
COALESCE(s.last_observed_at, s.ended_at, s.started_at) AS activity_at
```

Apply date filtering against `activity_at` when present. Do not exclude open sessions just because `ended_at` is null.

- [ ] **Step 3: Ensure live rollup branch groups include audit plus active**

In `src/lib/sessions/live-rollups.js`, each branch group must include:

```js
{
  branch,
  active_session_count,
  recently_completed_count,
  audit_session_count,
  active_total_tokens,
  active_total_cost_usd,
  active_cost_unknown_count,
  audit_total_tokens,
  audit_total_cost_usd,
  audit_cost_unknown_count,
  providers,
  models,
  sessions,
}
```

Add a test to `test/sessions-live-rollups.test.js` that an active `feature/live` session plus ended `main` session produce two branch groups with correct audit totals.

- [ ] **Step 4: Run branch tests**

Run:

```bash
rtk node --test test/local-api-vibedeck-branch-usage.test.js test/sessions-live-rollups.test.js
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/branch-usage.js src/lib/sessions/live-rollups.js test/local-api-vibedeck-branch-usage.test.js test/sessions-live-rollups.test.js
rtk git commit -m "fix: include active sessions in branch audit totals"
```

---

### Task 7: Add Rebuild Failure Diagnostics and Historical Closure

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/sessions/reaper.js`
- Test: `test/sync-session-event-failures.test.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Write failing processor diagnostics test**

Add `test/sync-session-event-failures.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSessionEventProcessor } = require("../src/commands/sync");

test("createSessionEventProcessor records event context for failures", async () => {
  const processor = createSessionEventProcessor(async () => {
    throw new Error("boom");
  });
  processor.onSessionEvent({
    provider: "codex",
    session_id: "s1",
    kind: "update",
    observed_at: "2026-05-12T00:00:00.000Z",
  });
  const drain = await processor.drain();

  assert.equal(drain.errors.length, 1);
  assert.equal(drain.errors[0].provider, "codex");
  assert.equal(drain.errors[0].session_id, "s1");
  assert.equal(drain.errors[0].kind, "update");
  assert.equal(drain.errors[0].observed_at, "2026-05-12T00:00:00.000Z");
  assert.match(drain.errors[0].message, /boom/);
});
```

Run: `rtk node --test test/sync-session-event-failures.test.js`

Expected: FAIL because only raw errors are stored.

- [ ] **Step 2: Store event failure records**

Modify `createSessionEventProcessor()` in `src/commands/sync.js`:

```js
function eventFailureRecord(event, err) {
  return {
    provider: event?.provider || null,
    session_id: event?.session_id || null,
    kind: event?.kind || null,
    observed_at: event?.observed_at || null,
    message: err?.message || String(err),
    stack: err?.stack || null,
  };
}
```

Change catch:

```js
.catch((err) => {
  errors.push(eventFailureRecord(event, err));
})
```

- [ ] **Step 3: Persist diagnostics JSONL**

Add in `src/commands/sync.js`:

```js
async function writeSessionFailureDiagnostics(trackerDir, failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const diagnosticsDir = path.join(trackerDir, "diagnostics");
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(diagnosticsDir, `session-event-failures-${stamp}.jsonl`);
  const body = failures.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fs.writeFile(outPath, body, "utf8");
  return outPath;
}
```

After drain:

```js
let failureDiagnosticsPath = null;
if (sessionEventDrain.errors.length > 0) {
  failureDiagnosticsPath = await writeSessionFailureDiagnostics(trackerDir, sessionEventDrain.errors);
}
```

For non-auto output:

```js
if (!opts.auto && sessionEventDrain.errors.length > 0) {
  const examples = sessionEventDrain.errors.slice(0, 5)
    .map((row) => `- ${row.provider || "unknown"} ${row.session_id || "unknown"} ${row.kind || "event"} ${row.observed_at || "unknown-time"}: ${row.message}`)
    .join("\n");
  process.stderr.write(
    `Session live-state sync: ${sessionEventDrain.errors.length} event(s) failed\n${examples}\nDiagnostics: ${failureDiagnosticsPath || "not written"}\n`,
  );
}
```

For rebuild:

```js
if (opts.rebuildVibedeckDb && sessionEventDrain.errors.length > 0) {
  throw new Error(`rebuild completed with ${sessionEventDrain.errors.length} failed session event(s); diagnostics: ${failureDiagnosticsPath || "not written"}`);
}
```

- [ ] **Step 4: Add historical idle closure during rebuild**

After rebuild drain succeeds, call:

```js
if (opts.rebuildVibedeckDb) {
  const closure = reapOrphanedSessions(dbPath, {
    idleTimeoutMin: getIdleTimeoutMin(),
    endReason: "historical_idle_reaped",
  });
  if (!opts.auto && closure.reaped > 0) {
    process.stderr.write(`Historical idle closure: ${closure.reaped} open session(s) closed\n`);
  }
}
```

Keep normal sync using `endReason: "orphan_reaped"`.

- [ ] **Step 5: Add rebuild progress phase labels**

In `cmdSync`, around rebuild-specific branches, print progress labels when `opts.rebuildVibedeckDb` and `!opts.auto`:

```js
process.stderr.write("Rebuild phase: clearing canonical tables\n");
process.stderr.write("Rebuild phase: parsing provider logs\n");
process.stderr.write("Rebuild phase: draining session events\n");
process.stderr.write("Rebuild phase: closing historical idle sessions\n");
process.stderr.write("Rebuild phase: validating canonical facts\n");
```

Do not spam per-event output when the existing progress bar is active.

- [ ] **Step 6: Run sync diagnostics tests**

Run:

```bash
rtk node --test test/sync-session-event-failures.test.js test/sync-rebuild-vibedeck-db.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
rtk git add src/commands/sync.js src/lib/sessions/reaper.js test/sync-session-event-failures.test.js test/sync-rebuild-vibedeck-db.test.js
rtk git commit -m "fix: make rebuild session failures diagnosable"
```

---

### Task 8: Add Canonical Completeness and Queue Reconciliation

**Files:**
- Create: `src/lib/sessions/canonical-completeness.js`
- Create: `src/lib/sessions/reconciliation.js`
- Modify: `src/lib/local-api.js`
- Modify: `src/lib/usage-read-models.js`
- Modify: `src/commands/sync.js`
- Test: `test/canonical-completeness.test.js`
- Test: `test/canonical-reconciliation.test.js`
- Test: `test/local-api-usage-summary-db-first.test.js`

- [ ] **Step 1: Write failing canonical completeness test**

Add `test/canonical-completeness.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { readCanonicalCompleteness } = require("../src/lib/sessions/canonical-completeness");

test("canonical completeness is false when sessions exist without bucket facts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-complete-"));
  const dbPath = path.join(dir, "vibedeck.sqlite3");
  try {
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd, created_at, updated_at
      ) VALUES (
        'codex', 'missing-bucket', '2026-05-12T00:00:00.000Z', '2026-05-12T00:01:00.000Z', 'complete',
        '/repo', '/repo', NULL, '/repo',
        'main', 'A', 'high', NULL,
        'gpt-5.5', 1000, NULL, '2026-05-12T00:00:00.000Z', '2026-05-12T00:01:00.000Z'
      );
    `);
    db.close();

    const result = readCanonicalCompleteness(dbPath);
    assert.equal(result.complete, false);
    assert.equal(result.sessions_missing_bucket_facts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

Run: `rtk node --test test/canonical-completeness.test.js`

Expected: FAIL because module does not exist.

- [ ] **Step 2: Implement completeness checks**

Create `src/lib/sessions/canonical-completeness.js`:

```js
'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function readCanonicalCompleteness(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || !fs.existsSync(dbPath)) {
    return { complete: false, reason: 'db_missing' };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sessionCount = db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get().c;
    const eventCount = db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_events').get().c;
    const bucketCount = db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_buckets').get().c;
    const missingBucketFacts = db.prepare(`
      SELECT COUNT(*) AS c
      FROM vibedeck_sessions s
      WHERE COALESCE(s.total_tokens, 0) > 0
        AND NOT EXISTS (
          SELECT 1 FROM vibedeck_session_buckets b
          WHERE b.provider = s.provider AND b.session_id = s.session_id
        )
    `).get().c;
    const missingStoredCost = db.prepare(`
      SELECT COUNT(*) AS c
      FROM vibedeck_sessions
      WHERE COALESCE(total_tokens, 0) > 0
        AND total_cost_usd IS NULL
    `).get().c;
    return {
      complete: sessionCount === 0 || (bucketCount > 0 && missingBucketFacts === 0),
      session_count: sessionCount,
      event_count: eventCount,
      bucket_fact_count: bucketCount,
      sessions_missing_bucket_facts: missingBucketFacts,
      sessions_missing_stored_cost: missingStoredCost,
    };
  } catch (cause) {
    return { complete: false, reason: cause?.message || String(cause) };
  } finally {
    db.close();
  }
}

module.exports = { readCanonicalCompleteness };
```

- [ ] **Step 3: Gate DB-first usage rows**

Modify `src/lib/usage-read-models.js`:

```js
const { readCanonicalCompleteness } = require('./sessions/canonical-completeness');
```

At the top of `readUsageRowsFromDb(dbPath)`:

```js
const completeness = readCanonicalCompleteness(dbPath);
if (!completeness.complete) return [];
```

Modify `src/lib/local-api.js` `scopedQueueRows()` to expose metadata:

```js
const completeness = readCanonicalCompleteness(dbPath);
...
return {
  scope,
  allRows,
  rows: filterRowsByUsageScope(allRows, scope),
  excludedSources: listExcludedSources(allRows, scope),
  canonical: completeness,
  canonical_incomplete: !completeness.complete,
};
```

- [ ] **Step 4: Surface canonical incomplete in Live snapshot**

In `readLiveSessionsSnapshot()`, include:

```js
const canonical = readCanonicalCompleteness(dbPath);
return {
  ...rollups,
  canonical,
  canonical_incomplete: !canonical.complete,
  ...
};
```

- [ ] **Step 5: Implement reconciliation report**

Create `src/lib/sessions/reconciliation.js`:

```js
'use strict';

const { readUsageRowsFromDb } = require('../usage-read-models');

function dayKey(iso) {
  const value = String(iso || '');
  return value.length >= 10 ? value.slice(0, 10) : 'unknown';
}

function groupRows(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [
      dayKey(row.hour_start),
      String(row.source || 'unknown'),
      String(row.model || 'unknown'),
    ].join('|');
    if (!grouped.has(key)) grouped.set(key, {
      day: dayKey(row.hour_start),
      source: String(row.source || 'unknown'),
      model: String(row.model || 'unknown'),
      total_tokens: 0,
      total_cost_usd: 0,
    });
    const entry = grouped.get(key);
    entry.total_tokens += Number(row.total_tokens || 0) || 0;
    entry.total_cost_usd += Number(row.total_cost_usd || 0) || 0;
  }
  return grouped;
}

function compareGrouped(canonicalRows, queueRows) {
  const canonical = groupRows(canonicalRows);
  const queue = groupRows(queueRows);
  const keys = new Set([...canonical.keys(), ...queue.keys()]);
  return Array.from(keys).sort().map((key) => {
    const a = canonical.get(key) || {};
    const b = queue.get(key) || {};
    return {
      key,
      day: a.day || b.day,
      source: a.source || b.source,
      model: a.model || b.model,
      canonical_tokens: Number(a.total_tokens || 0),
      queue_tokens: Number(b.total_tokens || 0),
      token_delta: Number(a.total_tokens || 0) - Number(b.total_tokens || 0),
      canonical_cost_usd: Number(a.total_cost_usd || 0),
      queue_cost_usd: Number(b.total_cost_usd || 0),
      cost_delta_usd: Number(a.total_cost_usd || 0) - Number(b.total_cost_usd || 0),
    };
  });
}

function reconcileCanonicalUsage({ dbPath, queueRows }) {
  return {
    generated_at: new Date().toISOString(),
    groups: compareGrouped(readUsageRowsFromDb(dbPath), queueRows),
  };
}

module.exports = { reconcileCanonicalUsage, compareGrouped };
```

- [ ] **Step 6: Add sync command report path**

Modify `src/commands/sync.js` so `--rebuild-vibedeck-db` runs reconciliation after a successful drain:

```js
const { reconcileCanonicalUsage } = require("../lib/sessions/reconciliation");
```

After queues are written and canonical drain succeeds:

```js
if (opts.rebuildVibedeckDb) {
  const queueRows = readQueueRowsForAudit(queuePath);
  const report = reconcileCanonicalUsage({ dbPath, queueRows });
  const diagnosticsDir = path.join(trackerDir, "diagnostics");
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const outPath = path.join(diagnosticsDir, "canonical-reconciliation.json");
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  if (!opts.auto) process.stderr.write(`Canonical reconciliation: ${outPath}\n`);
}
```

Add a small local `readQueueRowsForAudit(queuePath)` helper in `sync.js` that skips blank lines, skips malformed JSON lines, and returns parsed row objects. Keep it private to `sync.js` so this reconciliation path does not make queue files authoritative again.

- [ ] **Step 7: Run completeness and reconciliation tests**

Run:

```bash
rtk node --test test/canonical-completeness.test.js test/canonical-reconciliation.test.js test/local-api-usage-summary-db-first.test.js
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
rtk git add src/lib/sessions/canonical-completeness.js src/lib/sessions/reconciliation.js src/lib/local-api.js src/lib/usage-read-models.js src/commands/sync.js test/canonical-completeness.test.js test/canonical-reconciliation.test.js test/local-api-usage-summary-db-first.test.js
rtk git commit -m "feat: audit canonical completeness and reconciliation"
```

---

### Task 9: Validate End-to-End Product Behavior

**Files:**
- No planned code changes in this task.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
rtk node --test test/sessions-activity-state.test.js test/sessions-live-rollups.test.js test/local-api-vibedeck-live-rollups.test.js test/local-api-vibedeck-sessions-live-snapshot.test.js test/local-api-vibedeck-sessions-live.test.js test/sync-session-event-failures.test.js test/canonical-completeness.test.js test/canonical-reconciliation.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-project-worktree-usage.test.js test/local-api-usage-summary-db-first.test.js
```

Expected: all pass.

- [ ] **Step 2: Run focused frontend tests**

Run:

```bash
rtk npm --prefix dashboard run test -- src/hooks/use-vibedeck-live-sessions.test.ts src/lib/live-workstreams.test.js src/components/live/LiveWorkbenchOverview.test.jsx src/components/live/LiveSessionList.test.jsx
```

Expected: all pass.

- [ ] **Step 3: Build dashboard**

Run:

```bash
rtk npm --prefix dashboard run build
```

Expected: build exits with code `0`.

- [ ] **Step 4: Run full backend suite if focused tests pass**

Run:

```bash
rtk node --test test/*.test.js
```

Expected: no regressions caused by this plan. Existing unrelated failures must be listed with exact file names and failure summaries.

- [ ] **Step 5: Run rebuild on copied tracker data**

Use copied tracker data, not the user's only tracker directory:

```bash
rtk node bin/vibedeck.js sync --rebuild-vibedeck-db
```

Acceptance checks:

- Rebuild prints phase labels.
- Rebuild exits with code `0` or prints a diagnostics file and exits non-zero when event failures occur.
- `diagnostics/canonical-reconciliation.json` exists after rebuild.
- `Session live-state sync: N event(s) failed` is no longer the only failure detail.
- Old April and early-May open rows are closed with `end_reason = "historical_idle_reaped"` or `end_reason = "orphan_reaped"` depending on run mode.

- [ ] **Step 6: Serve and smoke test endpoints**

Run:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

In another shell:

```bash
curl -s http://127.0.0.1:7690/functions/vibedeck-sessions-live-snapshot
curl -s http://127.0.0.1:7690/functions/vibedeck-project-usage-summary
curl -s http://127.0.0.1:7690/functions/vibedeck-branch-usage
```

Acceptance checks:

- Live snapshot has `sessions`, `workstreams`, `totals`, `canonical`, `generated_at`, and `last_sync_at`.
- `workstreams[].audit_total_tokens` is at least `workstreams[].active_total_tokens`.
- `workstreams[].audit_total_cost_usd` is at least `workstreams[].active_total_cost_usd` when both are known.
- Live active session count excludes stale old open rows.
- Project usage totals and Live audit totals match for the active project over the same canonical scope.
- Branch totals include active branch usage without waiting for the session to end.

- [ ] **Step 7: Browser smoke test**

Open `http://127.0.0.1:7690/` and check:

- `/usage` still shows project/provider/model cost distribution.
- `/branches` still shows branch cost intelligence.
- `/live` top widget shows project audit total and a separate live-now value.
- `/live` active workstream card shows historical plus active project tokens/cost.
- `/live` drawer shows branch groups with provider/model history.
- Closed sessions remain in historical project/branch totals after they disappear from active/recent rows.

- [ ] **Step 8: Final commit if verification required changes**

Only if Task 9 required small fixes:

```bash
rtk git status --short
rtk git add <exact changed files>
rtk git commit -m "test: verify live audit rollups"
```

## Acceptance Criteria

- `/functions/vibedeck-sessions-live-snapshot` returns only truly active sessions plus intentionally recent-ended rows.
- Old historical open rows do not appear as active after rebuild, even when `updated_at` is fresh.
- Live overview displays active session totals and active project audit totals separately.
- Active workstream cards and drawers use backend `audit_*` totals for history plus live usage.
- Live branch groups preserve historical and active model/provider/token/cost breakdowns.
- Closing a session does not remove its cost/tokens/models from project/worktree/branch audit totals.
- Reopening activity in the same project attaches new live sessions to existing project/worktree audit history.
- Claude, Codex, Cursor, Gemini, and other providers can contribute to the same project/worktree rollup when repo/cwd attribution matches.
- Unattributed provider sessions remain visible as `cwd_only` or `session_only` scopes and do not pollute an unrelated project.
- Rebuild event failures include provider, session id, kind, observed timestamp, message, and diagnostics path.
- DB-first usage reads are disabled or flagged when canonical bucket facts are incomplete.
- Canonical-vs-queue reconciliation is generated after rebuild and reports day/provider/model deltas.
- Focused backend tests pass.
- Focused frontend tests pass.
- `rtk npm --prefix dashboard run build` passes.

## Specific Cases Covered

- Fresh `updated_at` from rebuild with old `last_observed_at`.
- Open sessions without explicit provider end events.
- Active sessions with stored canonical cost and live token overlay.
- Sessions with bucket facts but missing session-level stored cost.
- Sessions with no bucket facts during partial backfill.
- Unknown pricing, missing tokens, and partial unknown cost quality.
- Null branch, empty branch, and branch names with `~N` attribution suffixes.
- Multiple providers in one project.
- Multiple models in one session/project.
- Same repo basename under different parent paths.
- Worktrees with `parent_repo`, `repo_common_dir`, and plain `repo_root`.
- CWD-only sessions where git repo attribution is unavailable.
- Session-only fallback where cwd is unavailable.
- Empty `queue.jsonl`.
- SSE rollup update burst coalescing.
- Dashboard fallback when an older backend does not send `workstreams`.

## Self-Review Notes

- Backend source of truth is canonical SQLite, not queue files.
- Live activity uses `last_observed_at`, not `updated_at`.
- Project and branch audit totals are computed in backend rollups, not inferred by React from active rows.
- Existing parser/pricing math in `src/lib/rollout.js` is intentionally untouched.
- Partial rebuilds become diagnosable and do not silently produce trusted Live audit totals.
