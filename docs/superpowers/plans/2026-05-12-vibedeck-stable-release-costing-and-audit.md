# VibeDeck Stable Release Costing And Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a stable release where Live, Branches, Usage, and Entire checkpoint views use canonical SQLite for tokens/cost, Entire checkpoints get durable cost links, reconciliation reports audit truth instead of false cost failures, and release smoke catches stale live/event regressions.

**Architecture:** Canonical SQLite remains the source of truth for cost and audit rollups. Provider logs/runtime events update canonical sessions and bucket facts; dashboard APIs read canonical rows; queue files remain compatibility exports; reconciliation only reports drift and never drives streaming or UI totals. Entire checkpoint files provide checkpoint/model metadata, but VibeDeck computes checkpoint cost by linking checkpoint metadata to canonical sessions.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, existing VibeDeck session pipeline, Entire checkpoint bridge, local API, React/Vite, Vitest, Node test runner, `rtk`.

---

## Release Rules

- Do not change parser math or pricing formulas in `src/lib/rollout.js`.
- Do not make reconciliation part of the live path.
- Do not show missing checkpoint cost as `$0`.
- Do not create fake checkpoint/session links when a match is ambiguous.
- Do not let historical catch-up SSE events look like new live starts.
- Keep queue files as compatibility/audit inputs only.

---

## File Map

### Backend

- Create: `src/lib/db/migrations/010-entire-checkpoint-matches.js`
  - Adds durable checkpoint match status rows for linked, overlap, ambiguous, and unmatched checkpoints.

- Create: `src/lib/sessions/entire-checkpoint-backfill.js`
  - Scans checkpoint metadata, matches it to canonical sessions, upserts safe links, and records ambiguous/unmatched status.

- Modify: `src/lib/sessions/entire-links.js`
  - Accepts `match_confidence` values `exact`, `overlap`, and keeps compatibility with old `high`.

- Modify: `src/lib/entire-checkpoint-usage.js`
  - Reads match table first, then safe links, then optional API-time overlap fallback.
  - Returns explicit `status` and `reason` for unmatched/ambiguous groups.

- Modify: `src/lib/local-api.js`
  - Extends `/functions/vibedeck-checkpoints` and `/functions/vibedeck-checkpoint` to return usage status/cost quality.
  - Adds stale-SSE delta guard if not already handled in the session pipeline task.

- Modify: `src/commands/sync.js`
  - Runs checkpoint backfill during rebuild and lightweight incremental sync.
  - Writes diagnostics under `~/.vibedeck/tracker/diagnostics/`.
  - Treats Cursor API timeout as warning while preserving local fallback/canonical freshness.

- Modify: `src/lib/sessions/reconciliation.js`
  - Reports token drift and queue-cost availability separately.
  - Marks queue cost unavailable when queue cost is all zero/missing.

- Modify: `src/lib/doctor.js`
  - Adds canonical completeness, cost quality, checkpoint link coverage, and unmatched/ambiguous checkpoint checks.

### Frontend

- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
  - Shows linked cost, unknown cost, estimated/stored quality, or `Usage not linked`.

- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
  - Shows usage status and cost quality in metadata preview.

- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`

- Modify: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
  - Adds provider icons in model summary/session rows, matching Live drawer treatment.
  - If branch model summaries do not carry provider directly, derive the provider icon set from drawer sessions with the same model instead of changing the Branches API only for decoration.

- Modify: `dashboard/src/pages/BranchesPage.test.jsx`

- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
  - Removes the top `Branches` metric tile because branch groups below provide the real branch breakdown and the tile truncates.
  - Rebalances the summary metric grid after removing the tile so audit/live token and cost counters have enough inline spacing.

- Modify: `dashboard/src/components/live/LiveSessionList.test.jsx` or `dashboard/src/components/live/LiveWorkbenchOverview.test.jsx`
  - Adds coverage that the drawer no longer renders the top branch metric.

- Modify: `dashboard/src/content/copy.csv`
  - Adds copy for Entire `Usage not linked`, `Ambiguous usage`, `Stored cost`, `Estimated cost`, and checkpoint coverage warnings if needed.

### Tests

- Create: `test/sessions-entire-checkpoint-backfill.test.js`
- Modify: `test/local-api-vibedeck-checkpoints.test.js`
- Modify: `test/canonical-reconciliation.test.js`
- Modify: `test/doctor.test.js` or existing doctor-focused test file.
- Modify: `test/local-api-vibedeck-sessions-live.test.js`
- Modify: focused dashboard tests listed above.

---

## Data Contracts

### `vibedeck_entire_checkpoint_matches`

Create a table for checkpoint group status even when no safe session link exists:

```sql
CREATE TABLE vibedeck_entire_checkpoint_matches (
  repo_root TEXT NOT NULL,
  checkpoint_group_id TEXT NOT NULL,
  checkpoint_id TEXT,
  metadata_path TEXT NOT NULL,
  checkpoint_tip TEXT,
  entire_session_id TEXT,
  agent TEXT,
  provider TEXT,
  model TEXT,
  branch TEXT,
  started_at TEXT,
  ended_at TEXT,
  session_provider TEXT,
  session_id TEXT,
  match_status TEXT NOT NULL,
  match_confidence TEXT NOT NULL,
  reason TEXT,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (repo_root, checkpoint_group_id)
);
```

Allowed values:

```js
const MATCH_STATUS = {
  LINKED: "linked",
  AMBIGUOUS: "ambiguous",
  UNMATCHED: "unmatched",
};

const MATCH_CONFIDENCE = {
  EXACT: "exact",
  OVERLAP: "overlap",
  AMBIGUOUS: "ambiguous",
  UNMATCHED: "unmatched",
};
```

Safe cost display rule:

```js
const canShowUsage = match_status === "linked"
  && (match_confidence === "exact" || match_confidence === "overlap");
```

### Checkpoint Usage API

`checkpoint_usage[groupId]` should exist for all scanned metadata groups, not only linked groups:

```js
{
  checkpoint_id: "e2abdc1ec6",
  checkpoint_group_id: "e2/abdc1ec6",
  metadata_path: "e2/abdc1ec6/metadata.json",
  status: "linked",
  confidence: "exact",
  reason: null,
  agent: "codex",
  provider: "codex",
  model: "gpt-5.5",
  branch: "main",
  total_tokens: 1000,
  total_cost_usd: 1.23,
  known_cost_usd: 1.23,
  cost_unknown_count: 0,
  cost_quality: "stored",
  providers: [],
  models: [],
  session_count: 1
}
```

For ambiguous/unmatched:

```js
{
  checkpoint_id: "e2abdc1ec6",
  checkpoint_group_id: "e2/abdc1ec6",
  status: "ambiguous",
  confidence: "ambiguous",
  reason: "multiple_matching_sessions",
  total_tokens: null,
  total_cost_usd: null,
  cost_quality: "unknown",
  session_count: 0
}
```

### Reconciliation Report

Reconciliation remains an audit artifact:

```js
{
  generated_at,
  summary: {
    canonical_tokens,
    queue_tokens,
    token_delta,
    token_delta_pct,
    token_drift_status: "ok" | "warn",
    queue_cost_available: false,
    canonical_cost_usd,
    queue_cost_usd: null,
    cost_delta_usd: null,
    top_token_mismatches: []
  },
  groups: []
}
```

If queue cost is all zero/missing, group rows should set:

```js
{
  queue_cost_available: false,
  queue_cost_usd: null,
  cost_delta_usd: null
}
```

---

## Task 1: Add Durable Entire Checkpoint Match Schema

**Files:**
- Create: `src/lib/db/migrations/010-entire-checkpoint-matches.js`
- Modify: `test/db-ensure-schema.test.js`
- Test: `test/db-migration-010-entire-checkpoint-matches.test.js`

- [x] **Step 1: Write the failing migration test**

Create `test/db-migration-010-entire-checkpoint-matches.test.js`:

```js
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema } = require("../src/lib/db");

test("migration 010 creates durable Entire checkpoint match status table", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-entire-matches-"));
  const dbPath = path.join(dir, "vibedeck.sqlite3");
  try {
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      const cols = db.prepare("PRAGMA table_info(vibedeck_entire_checkpoint_matches)").all().map((row) => row.name);
      assert.ok(cols.includes("repo_root"));
      assert.ok(cols.includes("checkpoint_group_id"));
      assert.ok(cols.includes("match_status"));
      assert.ok(cols.includes("match_confidence"));
      assert.ok(cols.includes("reason"));
      assert.ok(cols.includes("candidate_count"));

      db.prepare(`
        INSERT INTO vibedeck_entire_checkpoint_matches (
          repo_root, checkpoint_group_id, checkpoint_id, metadata_path,
          match_status, match_confidence, reason, candidate_count,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "/repo",
        "e2/abdc1ec6",
        "e2abdc1ec6",
        "e2/abdc1ec6/metadata.json",
        "unmatched",
        "unmatched",
        "no_matching_session",
        0,
        "2026-05-12T00:00:00.000Z",
        "2026-05-12T00:00:00.000Z",
      );

      const row = db.prepare("SELECT match_status, match_confidence FROM vibedeck_entire_checkpoint_matches").get();
      assert.deepEqual(row, { match_status: "unmatched", match_confidence: "unmatched" });
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/db-migration-010-entire-checkpoint-matches.test.js
```

Expected: fails because `vibedeck_entire_checkpoint_matches` does not exist.

- [x] **Step 3: Add migration**

Create `src/lib/db/migrations/010-entire-checkpoint-matches.js` with the schema from the Data Contracts section.

Also update `test/db-ensure-schema.test.js` expected table list to include:

```js
"vibedeck_entire_checkpoint_matches"
```

- [x] **Step 4: Verify**

```bash
rtk node --test test/db-migration-010-entire-checkpoint-matches.test.js test/db-ensure-schema.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/db/migrations/010-entire-checkpoint-matches.js test/db-migration-010-entire-checkpoint-matches.test.js test/db-ensure-schema.test.js
rtk git commit -m "feat: add entire checkpoint match schema"
```

---

## Task 2: Add Shared Canonical Cost Summary Helper

**Files:**
- Create: `src/lib/canonical-cost-summary.js`
- Test: `test/canonical-cost-summary.test.js`
- Modify later consumers only after this task passes.

- [x] **Step 1: Write failing helper tests**

Create `test/canonical-cost-summary.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { summarizeCanonicalUsageRows } = require("../src/lib/canonical-cost-summary");

test("summarizeCanonicalUsageRows preserves known stored cost and provider/model breakdowns", () => {
  const summary = summarizeCanonicalUsageRows([
    { provider: "codex", model: "gpt-5.5", total_tokens: 100, total_cost_usd: 1.25, cost_quality: "stored" },
    { provider: "claude", model: "claude-sonnet-4-6", total_tokens: 50, total_cost_usd: 0.75, cost_quality: "token_buckets" },
  ]);

  assert.equal(summary.total_tokens, 150);
  assert.equal(summary.total_cost_usd, 2);
  assert.equal(summary.known_cost_usd, 2);
  assert.equal(summary.cost_unknown_count, 0);
  assert.equal(summary.cost_quality, "mixed_known");
  assert.deepEqual(summary.providers.map((row) => row.provider), ["claude", "codex"]);
  assert.deepEqual(summary.models.map((row) => row.model), ["claude-sonnet-4-6", "gpt-5.5"]);
});

test("summarizeCanonicalUsageRows never converts unknown positive-token cost to zero", () => {
  const summary = summarizeCanonicalUsageRows([
    { provider: "codex", model: "unknown-model", total_tokens: 100, total_cost_usd: null, cost_quality: "pricing_missing" },
  ]);

  assert.equal(summary.total_tokens, 100);
  assert.equal(summary.total_cost_usd, null);
  assert.equal(summary.known_cost_usd, 0);
  assert.equal(summary.cost_unknown_count, 1);
  assert.equal(summary.cost_quality, "unknown");
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/canonical-cost-summary.test.js
```

Expected: fails because helper does not exist.

- [x] **Step 3: Implement helper**

Create `src/lib/canonical-cost-summary.js`:

```js
"use strict";

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function qualityForGroup(qualities, hasUnknown) {
  if (hasUnknown) return "unknown";
  const values = Array.from(qualities).filter(Boolean);
  if (values.length === 0) return "unknown";
  if (values.length === 1) return values[0];
  return "mixed_known";
}

function summarizeGroup(rows, keyName) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row?.[keyName] || "unknown").trim() || "unknown";
    if (!map.has(key)) {
      map.set(key, {
        [keyName]: key,
        total_tokens: 0,
        known_cost_usd: 0,
        cost_unknown_count: 0,
        session_count: 0,
        _qualities: new Set(),
      });
    }
    const target = map.get(key);
    const tokens = toNumberOrNull(row?.total_tokens) || 0;
    const cost = toNumberOrNull(row?.total_cost_usd);
    target.total_tokens += tokens;
    target.session_count += 1;
    if (cost == null && tokens > 0) target.cost_unknown_count += 1;
    else target.known_cost_usd += cost || 0;
    if (cost != null) target._qualities.add(String(row?.cost_quality || "stored"));
  }

  return Array.from(map.values())
    .map((row) => {
      const unknown = row.cost_unknown_count > 0;
      const qualities = row._qualities;
      delete row._qualities;
      return {
        ...row,
        total_cost_usd: unknown ? null : row.known_cost_usd,
        cost_quality: qualityForGroup(qualities, unknown),
      };
    })
    .sort((a, b) => String(a[keyName]).localeCompare(String(b[keyName])));
}

function summarizeCanonicalUsageRows(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  let totalTokens = 0;
  let knownCostUsd = 0;
  let costUnknownCount = 0;
  const qualities = new Set();

  for (const row of safeRows) {
    const tokens = toNumberOrNull(row?.total_tokens) || 0;
    const cost = toNumberOrNull(row?.total_cost_usd);
    totalTokens += tokens;
    if (cost == null && tokens > 0) costUnknownCount += 1;
    else knownCostUsd += cost || 0;
    if (cost != null) qualities.add(String(row?.cost_quality || "stored"));
  }

  const unknown = costUnknownCount > 0;
  const providers = summarizeGroup(safeRows, "provider");
  const models = summarizeGroup(safeRows, "model");

  return {
    total_tokens: totalTokens,
    total_cost_usd: unknown ? null : knownCostUsd,
    known_cost_usd: knownCostUsd,
    cost_unknown_count: costUnknownCount,
    cost_quality: qualityForGroup(qualities, unknown),
    providers,
    models,
    provider_breakdown: providers,
    model_breakdown: models,
    session_count: safeRows.length,
  };
}

module.exports = { summarizeCanonicalUsageRows };
```

- [x] **Step 4: Verify**

```bash
rtk node --test test/canonical-cost-summary.test.js
```

Expected: pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/canonical-cost-summary.js test/canonical-cost-summary.test.js
rtk git commit -m "feat: add canonical cost summary helper"
```

---

## Task 3: Implement Entire Checkpoint Historical Backfill

**Files:**
- Create: `src/lib/sessions/entire-checkpoint-backfill.js`
- Modify: `src/lib/sessions/entire-links.js`
- Test: `test/sessions-entire-checkpoint-backfill.test.js`

- [x] **Step 1: Write failing backfill tests**

Create `test/sessions-entire-checkpoint-backfill.test.js` with these test cases:

```js
test("backfill links a checkpoint to one exact repo/provider/model/branch/time session", async () => {});
test("backfill records ambiguous when two canonical sessions match the same checkpoint", async () => {});
test("backfill records unmatched when no canonical session overlaps the checkpoint", async () => {});
test("backfill does not create vibedeck_session_entire_links for ambiguous or unmatched checkpoints", async () => {});
```

Use a temporary DB via `ensureSchema(dbPath)`. Insert canonical sessions with:

```sql
INSERT INTO vibedeck_sessions (
  provider, session_id, started_at, ended_at, end_reason,
  cwd, repo_root, repo_common_dir, parent_repo,
  branch, branch_resolution_tier, confidence, override_user,
  model, total_tokens, total_cost_usd, last_observed_at,
  cost_estimated, cost_quality, created_at, updated_at
) VALUES (...)
```

Use stub checkpoint metadata:

```js
{
  path: "e2/abdc1ec6/metadata.json",
  kind: "json",
  parsed: {
    checkpoint_id: "e2abdc1ec6",
    entire_session_id: "entire-session-1",
    agent: "codex",
    model: "gpt-5.5",
    branch: "main",
    started_at: "2026-05-12T01:00:00.000Z",
    ended_at: "2026-05-12T01:05:00.000Z"
  }
}
```

Expected linked row:

```js
{
  match_status: "linked",
  match_confidence: "exact",
  session_provider: "codex",
  session_id: "sess-1",
  reason: null,
  candidate_count: 1
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/sessions-entire-checkpoint-backfill.test.js
```

Expected: fails because `backfillEntireCheckpointLinks` does not exist.

- [x] **Step 3: Implement matcher**

Create `src/lib/sessions/entire-checkpoint-backfill.js` exporting:

```js
async function backfillEntireCheckpointLinks({
  dbPath,
  repoRoot,
  checkpointTip = null,
  listCheckpointsCached,
  readCheckpoint,
  now = () => new Date(),
} = {}) {}
```

Matching rules:

- Group files with existing `checkpointGroupId()`.
- Read only group-level `metadata.json`.
- Normalize `agent` to provider with the same mapping used by `entire-checkpoint-usage.js`.
- Candidate sessions must have `repo_root = repoRoot`.
- If metadata provider exists, candidate provider must match.
- Candidate must overlap checkpoint `[started_at, ended_at]`.
- If metadata model exists, prefer matching model.
- If metadata branch exists, prefer exact `branch` or same attribution branch after removing `~N`.
- `exact`: one candidate matches provider, model, branch, and time.
- `overlap`: one candidate matches provider and time, but model/branch metadata is missing.
- `ambiguous`: multiple plausible candidates remain after scoring.
- `unmatched`: zero candidates.

On `exact` or safe `overlap`:

- Upsert `vibedeck_entire_checkpoint_matches`.
- Upsert `vibedeck_session_entire_links`.

On `ambiguous` or `unmatched`:

- Upsert `vibedeck_entire_checkpoint_matches`.
- Do not insert `vibedeck_session_entire_links`.

Return:

```js
{
  scanned: 10,
  linked: 7,
  ambiguous: 2,
  unmatched: 1,
  skipped: 0
}
```

- [x] **Step 4: Verify**

```bash
rtk node --test test/sessions-entire-checkpoint-backfill.test.js test/sessions-entire-links.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/sessions/entire-checkpoint-backfill.js src/lib/sessions/entire-links.js test/sessions-entire-checkpoint-backfill.test.js
rtk git commit -m "feat: backfill entire checkpoint session links"
```

---

## Task 4: Wire Checkpoint Backfill Into Rebuild And Incremental Sync

**Files:**
- Modify: `src/commands/sync.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Optional Test: create `test/sync-entire-checkpoint-backfill.test.js` if the existing file becomes too large.

- [x] **Step 1: Write failing sync tests**

Add tests that assert:

- `sync --rebuild-vibedeck-db` runs checkpoint backfill after session events are drained.
- Backfill diagnostics are written to `tracker/diagnostics/entire-checkpoint-backfill.json`.
- Normal `sync` runs lightweight backfill only for repos with checkpoint tip changes or known active Entire state.

Expected diagnostics shape:

```js
{
  generated_at: "2026-05-12T00:00:00.000Z",
  repos: [
    {
      repo_root: "/repo/switchyard",
      checkpoint_tip: "abc123",
      scanned: 40,
      linked: 35,
      ambiguous: 3,
      unmatched: 2
    }
  ],
  totals: {
    scanned: 40,
    linked: 35,
    ambiguous: 3,
    unmatched: 2
  }
}
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/sync-rebuild-vibedeck-db.test.js
```

Expected: fails because sync does not run backfill.

- [x] **Step 3: Implement sync wiring**

In `src/commands/sync.js`:

- After `sessionEventDrain` and `recoverActiveSessionMetadata(dbPath)`, run backfill.
- During rebuild, scan known repo roots from `vibedeck_repos` and distinct non-null `vibedeck_sessions.repo_root`.
- During normal sync, scan repos whose Entire checkpoint tip changed or repos with active/recent sessions.
- Catch per-repo checkpoint errors and write diagnostics; do not fail entire sync unless the DB write itself fails.
- Print concise output in non-auto mode:

```text
Entire checkpoint backfill: 40 scanned, 35 linked, 3 ambiguous, 2 unmatched
Diagnostics: /Users/.../.vibedeck/tracker/diagnostics/entire-checkpoint-backfill.json
```

- [x] **Step 4: Verify**

```bash
rtk node --test test/sync-rebuild-vibedeck-db.test.js test/sessions-entire-checkpoint-backfill.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/commands/sync.js test/sync-rebuild-vibedeck-db.test.js
rtk git commit -m "feat: run entire checkpoint backfill during sync"
```

---

## Task 5: Expose Stable Checkpoint Usage Status And Cost Quality

**Files:**
- Modify: `src/lib/entire-checkpoint-usage.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-checkpoints.test.js`

- [x] **Step 1: Write failing API tests**

Add tests for:

```js
test("vibedeck checkpoints include linked cost quality from checkpoint match table", async () => {});
test("vibedeck checkpoints expose ambiguous status without showing zero cost", async () => {});
test("vibedeck checkpoint metadata exposes unmatched usage status", async () => {});
```

Expected linked usage:

```js
assert.equal(body.checkpoint_usage["e2/abdc1ec6"].status, "linked");
assert.equal(body.checkpoint_usage["e2/abdc1ec6"].confidence, "exact");
assert.equal(body.checkpoint_usage["e2/abdc1ec6"].total_cost_usd, 1.23);
assert.equal(body.checkpoint_usage["e2/abdc1ec6"].cost_quality, "stored");
```

Expected ambiguous usage:

```js
assert.equal(body.checkpoint_usage["e2/ambiguous"].status, "ambiguous");
assert.equal(body.checkpoint_usage["e2/ambiguous"].total_cost_usd, null);
assert.equal(body.checkpoint_usage["e2/ambiguous"].reason, "multiple_matching_sessions");
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/local-api-vibedeck-checkpoints.test.js
```

Expected: fails because API only emits usage for linked rows.

- [x] **Step 3: Implement API contract**

Update `src/lib/entire-checkpoint-usage.js`:

- Use `vibedeck_entire_checkpoint_matches` first.
- If match status is `ambiguous` or `unmatched`, return status object with null cost/tokens.
- If match status is `linked`, join canonical session rows and summarize with `summarizeCanonicalUsageRows`.
- Keep link-table fallback for existing installed DBs before migration 010 is populated.
- Keep overlap fallback only when explicitly enabled by API-time option; backfill should be preferred.

Update `src/lib/local-api.js`:

- `/functions/vibedeck-checkpoints` returns `checkpoint_usage` containing status for every scanned metadata group.
- `/functions/vibedeck-checkpoint` returns `usage` for metadata files, including status even when unmatched.

- [x] **Step 4: Verify**

```bash
rtk node --test test/local-api-vibedeck-checkpoints.test.js test/canonical-cost-summary.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/entire-checkpoint-usage.js src/lib/local-api.js test/local-api-vibedeck-checkpoints.test.js
rtk git commit -m "feat: expose entire checkpoint usage status"
```

---

## Task 6: Show Entire Linked, Unknown, Ambiguous, And Unmatched States In UI

**Files:**
- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/pages/EntirePage.test.jsx`
- Test: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`

- [x] **Step 1: Write failing UI tests**

Add checkpoint card test cases:

```js
checkpoint_usage: {
  "e2/linked": {
    status: "linked",
    confidence: "exact",
    total_tokens: 12345,
    total_cost_usd: 0.42,
    cost_quality: "stored",
    models: [{ model: "gpt-5.5", total_tokens: 12345, total_cost_usd: 0.42 }],
    providers: [{ provider: "codex", total_tokens: 12345, total_cost_usd: 0.42 }]
  },
  "e2/unmatched": {
    status: "unmatched",
    confidence: "unmatched",
    total_tokens: null,
    total_cost_usd: null,
    cost_quality: "unknown",
    reason: "no_matching_session"
  },
  "e2/ambiguous": {
    status: "ambiguous",
    confidence: "ambiguous",
    total_tokens: null,
    total_cost_usd: null,
    cost_quality: "unknown",
    reason: "multiple_matching_sessions"
  }
}
```

Assertions:

- linked card shows `12,345`, `$0.42`, `gpt-5.5`, `Stored cost`.
- unmatched card shows `Usage not linked`.
- ambiguous card shows `Ambiguous usage`.
- no unmatched/ambiguous card shows `$0.00`.

Add inspector assertions for metadata `file.usage.status`.

- [x] **Step 2: Run tests to verify they fail**

```bash
rtk npm --prefix dashboard run test -- src/pages/EntirePage.test.jsx src/components/entire/CheckpointFileInspector.test.jsx
```

Expected: fails because status labels are not rendered.

- [x] **Step 3: Implement UI states**

Rules:

- `status === "linked"`: show tokens, cost, model, provider, and cost quality.
- `total_cost_usd == null && cost_unknown_count > 0`: show `Unknown cost`.
- `status === "ambiguous"`: show `Ambiguous usage`.
- `status === "unmatched"` or no usage: show `Usage not linked`.
- Never render `$0.00` for missing cost.

- [x] **Step 4: Verify**

```bash
rtk npm --prefix dashboard run test -- src/pages/EntirePage.test.jsx src/components/entire/CheckpointFileInspector.test.jsx
rtk npm --prefix dashboard run typecheck
rtk npm --prefix dashboard run lint
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add dashboard/src/components/entire/CheckpointList.jsx dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/content/copy.csv dashboard/src/pages/EntirePage.test.jsx dashboard/src/components/entire/CheckpointFileInspector.test.jsx
rtk git commit -m "feat: show entire checkpoint usage status"
```

---

## Task 7: Fix Canonical Reconciliation Semantics

**Files:**
- Modify: `src/lib/sessions/reconciliation.js`
- Test: `test/canonical-reconciliation.test.js`

- [x] **Step 1: Write failing reconciliation tests**

Update `test/canonical-reconciliation.test.js` with:

```js
test("compareGrouped marks queue cost unavailable when queue costs are all zero", () => {
  const groups = compareGrouped(
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "codex", model: "gpt-5.5", total_tokens: 100, total_cost_usd: 1.5 }],
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "codex", model: "gpt-5.5", total_tokens: 100, total_cost_usd: 0 }],
  );

  assert.equal(groups.summary.queue_cost_available, false);
  assert.equal(groups.groups[0].queue_cost_usd, null);
  assert.equal(groups.groups[0].cost_delta_usd, null);
  assert.equal(groups.summary.canonical_cost_usd, 1.5);
});

test("compareGrouped reports top token mismatches without treating small drift as failure", () => {
  const result = compareGrouped(
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "opencode", model: "big-pickle", total_tokens: 0, total_cost_usd: 0 }],
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "opencode", model: "big-pickle", total_tokens: 31054, total_cost_usd: 0 }],
    { tokenWarnPct: 0.0001, tokenWarnAbsolute: 100000 },
  );

  assert.equal(result.summary.token_delta, -31054);
  assert.equal(result.summary.token_drift_status, "ok");
  assert.equal(result.summary.top_token_mismatches.length, 1);
});
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/canonical-reconciliation.test.js
```

Expected: fails because `compareGrouped` returns only an array today.

- [x] **Step 3: Implement reconciliation report object**

Change `compareGrouped(canonicalRows, queueRows, options)` to return:

```js
{
  summary,
  groups
}
```

Update `reconcileCanonicalUsage()` to write this object directly.

Backwards compatibility:

- If any tests require old array behavior, update them to read `.groups`.
- Keep group fields `canonical_tokens`, `queue_tokens`, and `token_delta`.

Queue cost availability:

- `queue_cost_available = true` only if at least one queue row has a positive or explicit non-zero cost.
- If unavailable, set every group `queue_cost_usd` and `cost_delta_usd` to `null`.
- Do not compare canonical cost against zero-cost queue exports.

- [x] **Step 4: Verify**

```bash
rtk node --test test/canonical-reconciliation.test.js test/sync-rebuild-vibedeck-db.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/sessions/reconciliation.js test/canonical-reconciliation.test.js test/sync-rebuild-vibedeck-db.test.js
rtk git commit -m "fix: report queue cost availability in reconciliation"
```

---

## Task 8: Prevent Historical SSE Catch-Up Deltas From Looking Live

**Files:**
- Modify: `src/lib/local-api.js`
- Modify if needed: `src/lib/sessions/pipeline.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [x] **Step 1: Write failing SSE test**

Add a test that:

- Connects to `/functions/vibedeck-sessions-live`.
- Receives initial snapshot.
- Emits a historical `session:start`/`session:end` with `last_observed_at` older than the live idle window and `ended_at` set.
- Asserts the client does not receive a `session:start` delta for that old ended session.
- Emits a current active update.
- Asserts the current active update is received.

Test name:

```js
test("vibedeck-sessions-live suppresses stale historical catch-up deltas after snapshot", async () => {});
```

- [x] **Step 2: Run test to verify it fails**

```bash
rtk node --test test/local-api-vibedeck-sessions-live.test.js
```

Expected: fails because stale historical deltas can still stream after snapshot.

- [x] **Step 3: Implement stale delta guard**

Preferred backend rule:

- Live SSE clients should receive:
  - initial snapshot
  - current active session updates
  - recently completed session updates inside the configured recent/live window
  - rollup updates for active/recent workstreams
- Live SSE clients should not receive:
  - old ended historical `session:start`/`session:end` replay events from backfill/catch-up.

Implementation options:

- Add event metadata from session pipeline: `event_age_class: "live" | "historical"`.
- Or filter in `src/lib/local-api.js` before enqueueing SSE event:

```js
const observed = Date.parse(String(event.last_observed_at || event.observed_at || event.ended_at || event.started_at || ""));
const ended = Boolean(event.ended_at);
const staleEnded = ended && Number.isFinite(observed) && Date.now() - observed > getIdleTimeoutMin() * 60_000;
if (staleEnded && event.type !== "rollup:update") return;
```

Do not suppress active session updates.

- [x] **Step 4: Verify**

```bash
rtk node --test test/local-api-vibedeck-sessions-live.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/local-api.js src/lib/sessions/pipeline.js test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "fix: suppress stale live sse catch-up deltas"
```

---

## Task 9: Add Stable Release Doctor Checks

**Files:**
- Modify: `src/lib/doctor.js`
- Test: existing doctor test file or create `test/doctor-stable-release-checks.test.js`

- [x] **Step 1: Write failing doctor tests**

Add tests for these check IDs:

```js
db.canonical_completeness
db.session_cost_quality
db.entire_checkpoint_coverage
db.entire_checkpoint_unmatched
```

Expected behavior:

- `db.canonical_completeness` is `ok` when no positive-token session is missing bucket facts.
- `db.session_cost_quality` is `warn` when positive-token sessions have `total_cost_usd IS NULL` and `cost_quality` is `pricing_missing`.
- `db.entire_checkpoint_coverage` is `info` when there are no checkpoint match rows.
- `db.entire_checkpoint_coverage` is `warn` when linked/scanned ratio is below 80%.
- `db.entire_checkpoint_unmatched` is `warn` when ambiguous or unmatched rows exist.

- [x] **Step 2: Run tests to verify they fail**

```bash
rtk node --test test/doctor*.test.js
```

Expected: fails because checks are not present.

- [x] **Step 3: Implement doctor checks**

In `src/lib/doctor.js`, extend `buildDbHealthChecks()`:

- Query canonical completeness using existing table logic or `readCanonicalCompleteness()`.
- Query cost quality:

```sql
SELECT COUNT(*) AS c
FROM vibedeck_sessions
WHERE COALESCE(total_tokens, 0) > 0
  AND total_cost_usd IS NULL
```

- Query checkpoint match coverage:

```sql
SELECT
  COUNT(*) AS scanned,
  SUM(CASE WHEN match_status = 'linked' THEN 1 ELSE 0 END) AS linked,
  SUM(CASE WHEN match_status = 'ambiguous' THEN 1 ELSE 0 END) AS ambiguous,
  SUM(CASE WHEN match_status = 'unmatched' THEN 1 ELSE 0 END) AS unmatched
FROM vibedeck_entire_checkpoint_matches
```

- [x] **Step 4: Verify**

```bash
rtk node --test test/doctor*.test.js
```

Expected: all pass.

- [x] **Step 5: Commit**

```bash
rtk git add src/lib/doctor.js test/doctor-stable-release-checks.test.js
rtk git commit -m "feat: add stable release audit doctor checks"
```

---

## Task 10: Polish Branch And Live Drawer UI Parity

**Files:**
- Modify: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Test: `dashboard/src/pages/BranchesPage.test.jsx`
- Test: `dashboard/src/components/live/LiveSessionList.test.jsx`

- [x] **Step 1: Write failing Branches drawer icon test**

In `dashboard/src/pages/BranchesPage.test.jsx`, after opening the branch drawer, assert provider logos are present:

```js
fireEvent.click(screen.getAllByRole("button", { name: /view sessions/i })[0]);
const drawer = await screen.findByRole("dialog", { name: copy("branches.drawer.title") });
expect(within(drawer).getAllByAltText("").length).toBeGreaterThan(0);
expect(within(drawer).getByText("codex")).toBeTruthy();
expect(within(drawer).getByText("claude")).toBeTruthy();
```

If `ProviderIcon` is decorative without alt text, prefer a stable wrapper label:

```js
expect(within(drawer).getByLabelText("Provider codex")).toBeTruthy();
```

- [x] **Step 2: Write failing Live drawer branch metric removal test**

In `dashboard/src/components/live/LiveSessionList.test.jsx`, open the Live workstream drawer and assert the top metric no longer has a `Branches` label while branch group headings remain:

```js
const drawer = await screen.findByRole("dialog", { name: /workstream breakdown/i });
expect(within(drawer).queryByText(/^Branches$/)).toBeNull();
expect(within(drawer).getByText("main")).toBeTruthy();
```

- [x] **Step 3: Run tests to verify they fail**

```bash
rtk npm --prefix dashboard run test -- src/pages/BranchesPage.test.jsx src/components/live/LiveSessionList.test.jsx
```

Expected: Branches drawer lacks provider icon parity; Live drawer still renders top `Branches` metric.

- [x] **Step 4: Implement UI changes**

In `BranchSessionDrawer.jsx`:

- Import `ProviderIcon`:

```js
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
```

- In model summary cards, show provider icon if `modelEntry.provider` exists.
- If `modelEntry.provider` is absent, derive the provider list from `sessions.filter((session) => session.model === modelEntry.model)` and render one compact icon per provider.
- In session rows, replace the plain `Server` icon provider chip with `ProviderIcon`.
- Keep text labels so users can still read provider names.

In `LiveWorkstreamDrawer.jsx`:

- Remove:

```jsx
<Metric icon={GitBranch} label="Branches" value={workstream.branches.join(", ") || "—"} />
```

- Keep branch group sections below unchanged.
- Change the summary grid from the old five-column layout to a balanced layout for the remaining six metrics, for example `sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`.

- [x] **Step 5: Verify**

```bash
rtk npm --prefix dashboard run test -- src/pages/BranchesPage.test.jsx src/components/live/LiveSessionList.test.jsx
rtk npm --prefix dashboard run lint
```

Expected: all pass.

- [x] **Step 6: Commit**

```bash
rtk git add dashboard/src/components/branches/BranchSessionDrawer.jsx dashboard/src/components/live/LiveWorkstreamDrawer.jsx dashboard/src/pages/BranchesPage.test.jsx dashboard/src/components/live/LiveSessionList.test.jsx
rtk git commit -m "fix: align branch and live drawer identity UI"
```

---

## Task 11: Release Verification And Real-Data Smoke

**Files:**
- No planned code changes.

- [ ] **Step 1: Focused backend**

```bash
rtk node --test test/sessions-entire-checkpoint-backfill.test.js test/local-api-vibedeck-checkpoints.test.js test/canonical-cost-summary.test.js test/canonical-reconciliation.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected: all pass.

- [ ] **Step 2: Focused dashboard**

```bash
rtk npm --prefix dashboard run test -- src/pages/EntirePage.test.jsx src/components/entire/CheckpointFileInspector.test.jsx src/pages/BranchesPage.test.jsx src/components/live/LiveSessionList.test.jsx
```

Expected: all pass.

- [ ] **Step 3: Full automated checks**

```bash
rtk node --test test/*.test.js
rtk npm --prefix dashboard run lint
rtk npm --prefix dashboard run typecheck
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run build
```

Expected:

- Backend full suite passes.
- Dashboard full suite passes.
- Lint/typecheck/build pass.
- Existing React `act(...)` warnings may remain but must not increase due to this plan.

- [ ] **Step 4: Real rebuild smoke**

```bash
rtk node bin/vibedeck.js sync --rebuild-vibedeck-db
```

Expected:

- Rebuild finishes.
- Entire checkpoint backfill prints scanned/linked/ambiguous/unmatched counts.
- `~/.vibedeck/tracker/diagnostics/entire-checkpoint-backfill.json` exists.
- `~/.vibedeck/tracker/diagnostics/canonical-reconciliation.json` reports `queue_cost_available: false` when queue cost is unavailable.
- Token drift summary is present and bounded.

- [ ] **Step 5: Real serve smoke**

```bash
rtk node bin/vibedeck.js serve --port 7690
```

In a second terminal:

```bash
curl -s http://127.0.0.1:7690/functions/vibedeck-sessions-live-snapshot
curl -s 'http://127.0.0.1:7690/functions/vibedeck-checkpoints?repo=/Users/vasuyadav/Downloads/Projects/switchyard'
curl -s http://127.0.0.1:7690/functions/vibedeck-branch-usage
```

Expected:

- No `MaxListenersExceededWarning`.
- Live snapshot has `canonical_incomplete: false` when scoped canonical data is complete.
- Switchyard checkpoints include `checkpoint_usage` entries.
- Linked Switchyard checkpoint groups show cost; unmatched groups show explicit status.
- Branch drawer provider/model icons render.
- Live drawer no longer shows the top truncated `Branches` metric.

- [ ] **Step 6: Commit only if verification requires small fixes**

```bash
rtk git status --short
rtk git add <exact changed files>
rtk git commit -m "test: verify stable release costing audit"
```

---

## Acceptance Criteria

- Switchyard Entire checkpoint cards show cost when a safe canonical session link exists.
- Entire checkpoint cards never show `$0` for missing cost.
- Ambiguous/unmatched checkpoints are visible as audit states, not silently empty.
- `vibedeck_session_entire_links` is populated by rebuild when safe matches exist.
- `vibedeck_entire_checkpoint_matches` records linked, ambiguous, and unmatched checkpoint groups.
- Live, Branches, Usage, and Entire cost totals come from canonical DB cost fields or canonical pricing helpers.
- Reconciliation reports queue cost as unavailable when queue cost is all zero/missing.
- Reconciliation reports token drift with top mismatch rows and threshold status.
- Historical SSE catch-up events do not appear as new live starts after snapshot.
- `doctor` reports canonical completeness, cost quality, checkpoint coverage, and unmatched/ambiguous checkpoint health.
- Branches side drawer uses provider icons like Live.
- Live side drawer removes the top truncated `Branches` metric while keeping branch groups below.
- Full backend and dashboard checks pass.

## Known Non-Goals

- Do not change token parser math.
- Do not use reconciliation as a live data source.
- Do not require queue cost to become authoritative.
- Do not invent checkpoint costs when no safe session link exists.
- Do not force unversioned directories into fake git repos.
