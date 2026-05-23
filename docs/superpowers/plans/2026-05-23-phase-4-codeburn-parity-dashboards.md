# Phase 4 Codeburn Parity Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Codeburn-parity read-side dashboards and endpoints without changing VibeDeck's canonical cost, token, branch, Unknown branch, Historical unknown, or grouping totals.

**Architecture:** Add only additive schema fields for future ordered-tool/task/skill enrichment, then build read models over existing `vibedeck_session_events`, `vibedeck_session_buckets`, and `vibedeck_branch_usage_facts`. New `/compare`, `/models`, `/status`, `/export`, `/yield`, and `/optimize/auto-detect` endpoints derive metrics from canonical facts and never write facts. Dashboard and Mac app surfaces are consumers only; `/dashboard`, `/usage`, `/branches`, and live routing stay unchanged except for additive panels/badges.

**Tech Stack:** Node.js CommonJS, SQLite `DatabaseSync`, Node test runner, React/Vite/Vitest dashboard, SwiftUI macOS app.

---

## Phase 4 Scope Lock

Phase 4 implements the spec's read-side dashboards and light additive fields only:

- Compare metrics: one-shot rate, retry rate, self-correction rate, cost/call, cost/edit, cache hit percent.
- Models view: per-model token/cost/session table, task-category drilldown when available.
- Status one-liner: canonical DB freshness + session/fact counts + active providers.
- Export CSV/JSON: date/source/model/provider filters with round-trip aggregate parity.
- Yield view: branch/session yield labels derived from branch facts plus best-effort git log state.
- Auto-detection: filesystem-only provider presence scan.
- MCP panel: read-side filter of `tools_json` keys beginning with `mcp__`.
- Light additive schema: `task_category`, `tools_sequence_json`, `skills_json`, `fast_mode`.

Explicit non-goals for this phase:

- No optimizer findings table; that is Phase 5.
- No plan/subscription billing changes; that is Phase 5.
- No currency conversion; that is Phase 5.
- No per-tool or per-activity dollar reallocation.
- No inheritance of parent branch/project into children or subagents.
- No direct provider adapter writes to `vibedeck_branch_usage_facts`.

## File Map

- `src/lib/db/migrations/014-codeburn-parity-fields.js` — additive schema fields on canonical session/fact tables.
- `src/lib/db/index.js` — registers migration 014.
- `src/lib/sessions/event.js` — accepts new nullable fields on update events.
- `src/lib/sessions/writer.js` — persists session-level `task_category`, `skills_json`, `tools_sequence_json`, `fast_mode`.
- `src/lib/sessions/bucket-facts.js` — aggregates task category/skills/fast mode into buckets; preserves tool sequence on events only.
- `src/lib/sessions/branch-usage-facts.js` — aggregates task category/skills/fast mode into branch facts.
- `src/lib/branch-usage.js` — exposes additive fields in branch drawer/date/model rollups without changing totals.
- `src/lib/codeburn-parity.js` — pure helpers for counters, task categories, compare metrics, exports, installed-provider detection, and yield classification.
- `src/lib/local-api.js` — routes the new read-only endpoints.
- `test/db-migration-014-codeburn-parity-fields.test.js` — schema test.
- `test/session-event-codeburn-parity.test.js` — event/writer/pipeline enrichment tests.
- `test/local-api-codeburn-parity.test.js` — endpoint tests.
- `dashboard/src/lib/api.ts`, `dashboard/src/lib/vibedeck-api.ts` — client functions.
- `dashboard/src/pages/ComparePage.jsx`, `dashboard/src/pages/ModelsPage.jsx`, `dashboard/src/pages/YieldPage.jsx`, `dashboard/src/pages/ExportPage.jsx` — new pages.
- `dashboard/src/pages/ComparePage.test.jsx`, `ModelsPage.test.jsx`, `YieldPage.test.jsx`, `ExportPage.test.jsx` — zero-data and sample-data render tests.
- `dashboard/src/App.jsx`, `dashboard/src/App.test.jsx`, `dashboard/src/ui/openai/components/Sidebar.jsx`, `dashboard/src/content/copy.csv` — route/nav/copy wiring.
- `dashboard/src/pages/DashboardPage.jsx`, `dashboard/src/pages/BranchesPage.jsx`, `dashboard/src/pages/SettingsPage.jsx` — MCP panel, yield badge, model alias/auto-detect controls.
- `VibeDeckMac/VibeDeckMac/Models/CodeburnParityModels.swift` — Swift decoders for compare/models/yield/status/export metadata.
- `VibeDeckMac/VibeDeckMac/Services/APIClient.swift` — read methods for new endpoints.
- `VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift` — state loaders.
- `VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift` and `VibeDeckMac/VibeDeckMac/Views/DashboardView.swift` — Compare/Models/Yield tabs.
- `PROJECT.md` — Phase 4 measured smoke record.

## Data Contract

All new API responses use this common envelope:

```js
{
  ok: true,
  as_of: "2026-05-23T00:00:00.000Z",
  range: { from: "2026-05-01", to: "2026-05-23", tz: "UTC" },
  totals: {
    session_count: 0,
    total_tokens: 0,
    total_cost_usd: "0.0000",
    cost_estimated: false,
    cost_quality: "zero_tokens"
  }
}
```

Cost remains string-formatted at response boundaries when existing endpoints already do so; internal math uses numbers. `cost_usd` in CSV export remains USD and is never converted in Phase 4.

## Task 1: Additive Schema And SessionEvent Contract

**Files:**
- Create: `src/lib/db/migrations/014-codeburn-parity-fields.js`
- Modify: `src/lib/db/index.js`
- Modify: `src/lib/sessions/event.js`
- Modify: `src/lib/sessions/writer.js`
- Modify: `src/lib/sessions/bucket-facts.js`
- Modify: `src/lib/sessions/branch-usage-facts.js`
- Modify: `src/lib/branch-usage.js`
- Create: `test/db-migration-014-codeburn-parity-fields.test.js`
- Create: `test/session-event-codeburn-parity.test.js`

- [ ] **Step 1: Add the migration test first**

Create `test/db-migration-014-codeburn-parity-fields.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-parity-'));
  return {
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
}

for (const table of ['vibedeck_session_events', 'vibedeck_sessions']) {
  test(`migration 014 adds event/session Codeburn fields to ${table}`, () => {
    const tmp = makeDb();
    try {
      ensureSchema(tmp.dbPath);
      const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
      try {
        const names = columns(db, table);
        for (const name of ['task_category', 'tools_sequence_json', 'skills_json', 'fast_mode']) {
          assert.ok(names.includes(name), `${table} missing ${name}`);
        }
      } finally {
        db.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
}

for (const table of ['vibedeck_session_buckets', 'vibedeck_branch_usage_facts']) {
  test(`migration 014 adds aggregate Codeburn fields to ${table}`, () => {
    const tmp = makeDb();
    try {
      ensureSchema(tmp.dbPath);
      const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
      try {
        const names = columns(db, table);
        for (const name of ['task_category', 'skills_json', 'fast_mode']) {
          assert.ok(names.includes(name), `${table} missing ${name}`);
        }
        assert.ok(!names.includes('tools_sequence_json'), `${table} must not aggregate ordered tool sequence`);
      } finally {
        db.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
}
```

Run:

```bash
node --test test/db-migration-014-codeburn-parity-fields.test.js
```

Expected: FAIL because migration 014 is not registered.

- [ ] **Step 2: Add migration 014**

Create `src/lib/db/migrations/014-codeburn-parity-fields.js`:

```js
'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 5,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_events ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN tools_sequence_json TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN fast_mode INTEGER;

      ALTER TABLE vibedeck_sessions ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN tools_sequence_json TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN fast_mode INTEGER;

      ALTER TABLE vibedeck_session_buckets ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
```

Modify `src/lib/db/index.js` to require and register it after migration 013:

```js
const m014 = require('./migrations/014-codeburn-parity-fields');
```

and:

```js
  registerMigration(m014);
```

- [ ] **Step 3: Add SessionEvent contract tests**

Create `test/session-event-codeburn-parity.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { makeStart, makeUpdate, makeEnd } = require('../src/lib/sessions/event');
const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');
const { upsertBucketFact } = require('../src/lib/sessions/bucket-facts');
const { rebuildBranchUsageFactsForSession } = require('../src/lib/sessions/branch-usage-facts');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-event-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dbPath, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('SessionEvent update accepts task category, ordered tools, skills, and fast mode', () => {
  const update = makeUpdate({
    provider: 'claude',
    session_id: 's1',
    observed_at: '2026-05-23T10:00:00.000Z',
    input_tokens: 100,
    output_tokens: 25,
    task_category: JSON.stringify({ Coding: 1 }),
    tools_sequence_json: JSON.stringify(['Read', 'Edit', 'Bash']),
    skills_json: JSON.stringify({ planner: 1 }),
    fast_mode: 1,
  });
  assert.equal(update.task_category, JSON.stringify({ Coding: 1 }));
  assert.equal(update.tools_sequence_json, JSON.stringify(['Read', 'Edit', 'Bash']));
  assert.equal(update.skills_json, JSON.stringify({ planner: 1 }));
  assert.equal(update.fast_mode, 1);
});

test('SessionEvent update rejects malformed Codeburn parity fields', () => {
  assert.throws(() => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', task_category: '{bad' }), /task_category/);
  assert.throws(() => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', tools_sequence_json: '{bad' }), /tools_sequence_json/);
  assert.throws(() => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', skills_json: '{bad' }), /skills_json/);
  assert.throws(() => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', fast_mode: -1 }), /fast_mode/);
});

test('writer and bucket/branch facts carry additive Codeburn fields without changing totals', async () => {
  const tmp = tmpDb();
  try {
    const events = [
      makeStart({ provider: 'claude', session_id: 's1', started_at: '2026-05-23T10:00:00.000Z', cwd: tmp.dir, model: 'claude-sonnet-4' }),
      makeUpdate({
        provider: 'claude',
        session_id: 's1',
        observed_at: '2026-05-23T10:05:00.000Z',
        input_tokens: 100,
        output_tokens: 25,
        delta_tokens: 125,
        model: 'claude-sonnet-4',
        task_category: JSON.stringify({ Coding: 1 }),
        tools_sequence_json: JSON.stringify(['Read', 'Edit']),
        skills_json: JSON.stringify({ planner: 1 }),
        fast_mode: 1,
      }),
      makeEnd({ provider: 'claude', session_id: 's1', ended_at: '2026-05-23T10:10:00.000Z', total_tokens: 125 }),
    ];
    upsertSessionFromEvents(tmp.dbPath, events);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      const session = db.prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.equal(session.total_tokens, 125);
      assert.equal(session.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(session.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(session.fast_mode, 1);
      assert.equal(session.tools_sequence_json, JSON.stringify(['Read', 'Edit']));

      assert.equal(upsertBucketFact(db, session, events[1]), true);
      const bucket = db.prepare('SELECT * FROM vibedeck_session_buckets WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.equal(bucket.total_tokens, 125);
      assert.equal(bucket.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(bucket.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(bucket.fast_mode, 1);

      await rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'claude', session_id: 's1' });
      const fact = db.prepare('SELECT * FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.ok(fact);
      assert.equal(fact.total_tokens, 125);
      assert.equal(fact.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(fact.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(fact.fast_mode, 1);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
```

Expected before implementation: FAIL because new event fields are rejected and persistence columns are unused.

- [ ] **Step 4: Extend `src/lib/sessions/event.js`**

Add `task_category`, `tools_sequence_json`, `skills_json`, and `fast_mode` to `makeUpdate`. Validate `task_category`, `tools_sequence_json`, and `skills_json` with the existing nullable JSON string validator. Validate `fast_mode` as nullable non-negative integer.

The update validator must include these messages:

```js
if (!isNullableJsonString(e.task_category)) {
  throw new TypeError('SessionEvent.task_category must be a valid JSON string or null');
}
if (!isNullableJsonString(e.tools_sequence_json)) {
  throw new TypeError('SessionEvent.tools_sequence_json must be a valid JSON string or null');
}
if (!isNullableJsonString(e.skills_json)) {
  throw new TypeError('SessionEvent.skills_json must be a valid JSON string or null');
}
assertNullableNonNegativeInteger('fast_mode', e.fast_mode);
```

- [ ] **Step 5: Extend writer/session/bucket/fact aggregation**

Implement the same aggregation style used for `tools_json` and `activity_json`:

- `task_category` is a counter JSON string such as `{"Coding":1}`.
- `skills_json` is a counter JSON string such as `{"planner":1}`.
- `fast_mode` sums update event integer values.
- `tools_sequence_json` is persisted on `vibedeck_session_events` and carried to `vibedeck_sessions` as the last non-null sequence observed. It is intentionally not aggregated into buckets/facts because sequence order across buckets/facts would be misleading.

Touch these code paths:

- `src/lib/sessions/writer.js`: compute `task_category`, `skills_json`, `tools_sequence_json`, `fast_mode`, include in `desired`, and add columns/bindings to the `INSERT INTO vibedeck_sessions` statement.
- `src/lib/sessions/bucket-facts.js`: read event fields, skip all-zero bucket only when these fields are also empty, merge `task_category`/`skills_json`, sum `fast_mode`, add columns/bindings to bucket upsert.
- `src/lib/sessions/branch-usage-facts.js`: add fields in session fallback and event groups, sum/merge them, and include columns/bindings in `INSERT INTO vibedeck_branch_usage_facts`.
- `src/lib/branch-usage.js`: add `task_category`, `skills_json`, `fast_mode` to `enrichmentShape`, `addEnrichment`, `stripEmptyEnrichment`, model/date/session drawer payloads.

- [ ] **Step 6: Run checks and commit**

```bash
node --test test/db-migration-014-codeburn-parity-fields.test.js test/session-event-codeburn-parity.test.js test/db-migration-012-session-enrichment.test.js test/db-migration-013-session-groups.test.js test/local-api-vibedeck-branch-usage-enrichment.test.js test/sessions-branch-usage-facts-enrichment.test.js test/sessions-bucket-facts-enrichment.test.js
git diff --check
git add src/lib/db/index.js src/lib/db/migrations/014-codeburn-parity-fields.js src/lib/sessions/event.js src/lib/sessions/writer.js src/lib/sessions/bucket-facts.js src/lib/sessions/branch-usage-facts.js src/lib/branch-usage.js test/db-migration-014-codeburn-parity-fields.test.js test/session-event-codeburn-parity.test.js
git commit -m "feat: add codeburn parity enrichment fields"
```

## Task 2: Codeburn Read Models And Local API Endpoints

**Files:**
- Create: `src/lib/codeburn-parity.js`
- Modify: `src/lib/local-api.js`
- Create: `test/local-api-codeburn-parity.test.js`
- Modify: `test/model-breakdown.test.js` only if alias helper is exported there

- [ ] **Step 1: Write endpoint tests**

Create `test/local-api-codeburn-parity.test.js` with helper code following existing `local-api` tests:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');

async function call(handler, route) {
  const chunks = [];
  let statusCode = 200;
  const url = new URL(`http://127.0.0.1${route}`);
  const req = { method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1' } };
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead(code) { statusCode = code; },
    write(chunk) { chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)); },
    end(body) { if (body) chunks.push(Buffer.isBuffer(body) ? body.toString('utf8') : String(body)); },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true, `${route} must be handled`);
  return { statusCode, body: chunks.join('') };
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-api-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  fs.writeFileSync(queuePath, '', 'utf8');
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  const now = '2026-05-23T10:00:00.000Z';
  db.prepare(`INSERT INTO vibedeck_branch_usage_facts (
    provider, session_id, scope_key, project_state, project_key, project_ref, cwd, repo_root,
    branch, branch_kind, confidence, model, first_observed_at, last_observed_at,
    event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens, output_tokens,
    reasoning_output_tokens, conversation_count, total_cost_usd, cost_estimated, cost_quality,
    token_reconciled, cost_reconciled, created_at, updated_at, web_search_requests,
    tool_call_count, tools_json, activity_json, task_category, skills_json, fast_mode
  ) VALUES (
    @provider, @session_id, @scope_key, @project_state, @project_key, @project_ref, @cwd, @repo_root,
    @branch, @branch_kind, @confidence, @model, @first_observed_at, @last_observed_at,
    @event_count, @total_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
    @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens, @output_tokens,
    @reasoning_output_tokens, @conversation_count, @total_cost_usd, @cost_estimated, @cost_quality,
    @token_reconciled, @cost_reconciled, @created_at, @updated_at, @web_search_requests,
    @tool_call_count, @tools_json, @activity_json, @task_category, @skills_json, @fast_mode
  )`).run({
    provider: 'claude', session_id: 's1', scope_key: 'repo:/tmp/repo', project_state: 'git_existing', project_key: '/tmp/repo', project_ref: '/tmp/repo', cwd: '/tmp/repo', repo_root: '/tmp/repo',
    branch: 'main', branch_kind: 'known', confidence: 'high', model: 'claude-sonnet-4', first_observed_at: now, last_observed_at: now,
    event_count: 2, total_tokens: 1000, input_tokens: 700, cached_input_tokens: 100, cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 20, cache_creation_1h_input_tokens: 30, output_tokens: 250,
    reasoning_output_tokens: 0, conversation_count: 1, total_cost_usd: 0.25, cost_estimated: 0, cost_quality: 'stored',
    token_reconciled: 0, cost_reconciled: 0, created_at: now, updated_at: now, web_search_requests: 0,
    tool_call_count: 3, tools_json: JSON.stringify({ Read: 1, Edit: 1, 'mcp__repo__search': 1 }), activity_json: JSON.stringify({ editing: 1, reading: 1 }), task_category: JSON.stringify({ Coding: 1 }), skills_json: JSON.stringify({ planner: 1 }), fast_mode: 1,
  });
  db.prepare(`INSERT INTO vibedeck_session_events (
    event_key, provider, session_id, kind, observed_at, model, input_tokens, output_tokens,
    delta_tokens, tools_json, activity_json, task_category, tools_sequence_json, skills_json,
    fast_mode, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('ev1', 'claude', 's1', 'update', now, 'claude-sonnet-4', 700, 250, 1000, JSON.stringify({ Read: 1, Edit: 1 }), JSON.stringify({ editing: 1 }), JSON.stringify({ Coding: 1 }), JSON.stringify(['Read', 'Edit']), JSON.stringify({ planner: 1 }), 1, now);
  db.close();
  return { dir, queuePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('Codeburn parity endpoints expose read-side metrics without changing totals', async () => {
  const f = makeFixture();
  try {
    const handler = createLocalApiHandler({ queuePath: f.queuePath });
    const compare = JSON.parse((await call(handler, '/functions/vibedeck-compare?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(compare.ok, true);
    assert.equal(compare.totals.total_tokens, 1000);
    assert.equal(compare.metrics.cost_per_call_usd, '0.0833');
    assert.equal(compare.metrics.cost_per_edit_usd, '0.2500');
    assert.equal(compare.metrics.cache_hit_percent, '13.33');

    const models = JSON.parse((await call(handler, '/functions/vibedeck-models?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(models.models[0].model, 'claude-sonnet-4');
    assert.equal(models.models[0].task_categories.Coding, 1);

    const status = JSON.parse((await call(handler, '/functions/vibedeck-status')).body);
    assert.equal(status.ok, true);
    assert.ok(status.one_liner.includes('sessions'));

    const jsonExport = JSON.parse((await call(handler, '/functions/vibedeck-export?format=json&from=2026-05-23&to=2026-05-23')).body);
    assert.equal(jsonExport.totals.total_tokens, 1000);
    assert.equal(jsonExport.rows.length, 1);

    const csv = (await call(handler, '/functions/vibedeck-export?format=csv&from=2026-05-23&to=2026-05-23')).body;
    assert.match(csv, /provider,session_id,branch,model,total_tokens,cost_usd/);
    assert.match(csv, /claude,s1,main,claude-sonnet-4,1000,0.2500/);

    const yieldBody = JSON.parse((await call(handler, '/functions/vibedeck-yield?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(yieldBody.branches[0].branch, 'main');
    assert.match(['productive', 'abandoned', 'reverted', 'unknown'], yieldBody.branches[0].yield_state);

    const detect = JSON.parse((await call(handler, '/functions/vibedeck-optimize/auto-detect')).body);
    assert.equal(detect.ok, true);
    assert.ok(Array.isArray(detect.providers));
  } finally {
    f.cleanup();
  }
});

test('empty Codeburn parity endpoints render stable zero data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-api-empty-'));
  try {
    const queuePath = path.join(dir, 'queue.jsonl');
    fs.writeFileSync(queuePath, '', 'utf8');
    ensureSchema(path.join(dir, 'vibedeck.sqlite3'));
    const handler = createLocalApiHandler({ queuePath });
    for (const route of ['/functions/vibedeck-compare', '/functions/vibedeck-models', '/functions/vibedeck-yield', '/functions/vibedeck-status', '/functions/vibedeck-export?format=json']) {
      const response = await call(handler, route);
      const body = JSON.parse(response.body);
      assert.equal(body.ok, true, `${route} should return ok`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

Expected before implementation: FAIL because endpoints are not handled.

- [ ] **Step 2: Implement `src/lib/codeburn-parity.js` helpers**

Create `src/lib/codeburn-parity.js` exporting:

```js
module.exports = {
  parseCounterJson,
  stableCounterJson,
  readCodeburnFactRows,
  buildComparePayload,
  buildModelsPayload,
  buildStatusPayload,
  buildExportPayload,
  buildYieldPayload,
  detectInstalledProviders,
  toCsv,
};
```

Required behavior:

- `readCodeburnFactRows(dbPath, { from, to, source, model, branch })` reads `vibedeck_branch_usage_facts` only, filters by `last_observed_at` date window, source/provider, model, and branch. It returns `[]` when DB is absent.
- `parseCounterJson` accepts only object values with non-negative integer counts.
- `buildComparePayload(rows)` computes:
  - `one_shot_rate = one-shot sessions / sessions`, where one-shot means `event_count <= 1 || conversation_count <= 1`.
  - `retry_rate = rows with activity editing > 1 / sessions`.
  - `self_correction_rate = rows with tools_json containing both `Bash` and `Edit` / sessions`.
  - `cost_per_call_usd = total_cost_usd / tool_call_count`.
  - `cost_per_edit_usd = total_cost_usd / activity_json.editing`.
  - `cache_hit_percent = cached_input_tokens / (input_tokens + cached_input_tokens + cache_creation_5m_input_tokens + cache_creation_1h_input_tokens)`.
- `buildModelsPayload(rows)` groups by model and includes `providers`, `total_tokens`, `total_cost_usd`, `session_count`, `task_categories`, `tools`, `skills`, `fast_mode_count`.
- `buildStatusPayload(dbPath)` reads counts from canonical tables and creates `one_liner`, for example `"1214 sessions | 1152 branch facts | 4 providers | DB fresh 2026-05-23T..."`.
- `buildExportPayload(rows)` returns canonical rows and totals. No display currency conversion. `cost_usd` means USD.
- `toCsv(rows)` emits `provider,session_id,branch,model,total_tokens,cost_usd,first_observed_at,last_observed_at,task_category,tools_json,activity_json,skills_json`.
- `buildYieldPayload(rows, { execFileSync })` groups by branch. If `repo_root` exists and git log can be queried, classify `productive` when there is at least one commit on the branch in the window, `reverted` when the commit subject contains `revert`, `abandoned` when no commits and total tokens > 0, otherwise `unknown`. Any git failure returns `unknown`, not an exception.
- `detectInstalledProviders({ env })` checks known local paths only and never writes:
  - `.claude`, `.codex`, `.cursor`, `.gemini`, `.openclaw`, `.factory`, `.qwen`, `.config/kilo`, `.config/Code/User/globalStorage/rooveterinaryinc.roo-cline`, `.kiro`, `.codebuddy`, `.craft-agent`.

- [ ] **Step 3: Wire local API routes**

Modify `src/lib/local-api.js`:

- Add route constants for `compare`, `models`, `status`, `export`, `yield`, and `autoDetect` with primary paths:
  - `/functions/vibedeck-compare`
  - `/functions/vibedeck-models`
  - `/functions/vibedeck-status`
  - `/functions/vibedeck-export`
  - `/functions/vibedeck-yield`
  - `/functions/vibedeck-optimize/auto-detect`
- Preserve legacy route generation only where it is consistent with `withLegacyRoute`; `optimize/auto-detect` can be primary-only.
- Use the existing `queuePath` to locate `dbPath = path.join(path.dirname(queuePath), 'vibedeck.sqlite3')`.
- Respond with JSON for all except CSV export. CSV export must set `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="vibedeck-export.csv"`.
- These endpoints are read-only. Do not require write auth.

- [ ] **Step 4: Run checks and commit**

```bash
node --test test/local-api-codeburn-parity.test.js test/model-breakdown.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-vibedeck-branch-usage-enrichment.test.js
git diff --check
git add src/lib/codeburn-parity.js src/lib/local-api.js test/local-api-codeburn-parity.test.js test/model-breakdown.test.js
git commit -m "feat: add codeburn parity read endpoints"
```

## Task 3: Dashboard Codeburn Pages And Route Wiring

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Create: `dashboard/src/pages/ComparePage.jsx`
- Create: `dashboard/src/pages/ModelsPage.jsx`
- Create: `dashboard/src/pages/YieldPage.jsx`
- Create: `dashboard/src/pages/ExportPage.jsx`
- Create: `dashboard/src/pages/ComparePage.test.jsx`
- Create: `dashboard/src/pages/ModelsPage.test.jsx`
- Create: `dashboard/src/pages/YieldPage.test.jsx`
- Create: `dashboard/src/pages/ExportPage.test.jsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/App.test.jsx`
- Modify: `dashboard/src/ui/openai/components/Sidebar.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Add client functions**

Add to `dashboard/src/lib/api.ts` `PATHS`:

```ts
  compare: "vibedeck-compare",
  models: "vibedeck-models",
  status: "vibedeck-status",
  export: "vibedeck-export",
  yield: "vibedeck-yield",
  autoDetect: "vibedeck-optimize/auto-detect",
```

Export these functions:

```ts
export function getCompareMetrics(params: AnyRecord = {}) {
  return fetchLocalJson(PATHS.compare, params);
}

export function getModelsView(params: AnyRecord = {}) {
  return fetchLocalJson(PATHS.models, params);
}

export function getYieldView(params: AnyRecord = {}) {
  return fetchLocalJson(PATHS.yield, params);
}

export function getCodeburnStatus(params: AnyRecord = {}) {
  return fetchLocalJson(PATHS.status, params);
}

export function getAutoDetectedProviders(params: AnyRecord = {}) {
  return fetchLocalJson(PATHS.autoDetect, params);
}

export async function downloadExport({ format = "json", ...params }: AnyRecord = {}) {
  return fetchLocalJson(PATHS.export, { ...params, format });
}
```

Add equivalent named wrappers in `dashboard/src/lib/vibedeck-api.ts` when pages use the auth-aware helper style.

- [ ] **Step 2: Add zero-data resilient pages**

Create pages with the existing visual system (`font-oai`, `text-oai-*`, `copy()`, cards). Each page must render before data resolves and when endpoint returns empty arrays.

Minimum required visible text:

- `ComparePage.jsx`: title `Compare`, subtitle `Model and workflow efficiency across the selected window`, metric cards for `One-shot rate`, `Retry rate`, `Self-correction`, `Cost / call`, `Cost / edit`, `Cache hit`.
- `ModelsPage.jsx`: title `Models`, table columns `Model`, `Providers`, `Tokens`, `Cost`, `Sessions`, `Top task`.
- `YieldPage.jsx`: title `Yield`, branch cards with `productive`, `reverted`, `abandoned`, `unknown` labels.
- `ExportPage.jsx`: title `Export`, date range placeholders, JSON/CSV action buttons, and a preview of aggregate totals.

Use local loading state text `Loading parity data...` and empty-state text `No data for this window yet.`.

- [ ] **Step 3: Add page tests**

Each page test must mock the API functions and assert both empty and sample render:

```jsx
/* @vitest-environment jsdom */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ComparePage } from "./ComparePage.jsx";

vi.mock("../lib/api", () => ({
  getCompareMetrics: vi.fn(async () => ({ ok: true, metrics: {}, totals: { total_tokens: 0, total_cost_usd: "0.0000" } })),
}));

describe("ComparePage", () => {
  it("renders empty state without crashing", async () => {
    render(<ComparePage />);
    expect(screen.getByText("Compare")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/No data/i)).toBeTruthy());
  });
});
```

Repeat the same pattern for Models/Yield/Export with their page-specific API function and sample row.

- [ ] **Step 4: Wire routes and sidebar**

Modify `dashboard/src/App.jsx`:

- import the four new pages.
- recognize `/compare`, `/models`, `/yield`, `/export`.
- include these paths in `showSidebar`.

Modify `dashboard/src/ui/openai/components/Sidebar.jsx`:

- import icons from `lucide-react`: `GitCompare`, `Cpu`, `TrendingUp`, `Download`.
- Add the four nav items under the work group after Usage/Branches.

Modify `dashboard/src/App.test.jsx`:

- mock the new pages.
- add route tests for `/compare`, `/models`, `/yield`, and `/export`.

Append copy keys to `dashboard/src/content/copy.csv`:

```csv
nav.compare,shared,*,Sidebar,nav_compare,Compare,,active
nav.models,shared,*,Sidebar,nav_models,Models,,active
nav.yield,shared,*,Sidebar,nav_yield,Yield,,active
nav.export,shared,*,Sidebar,nav_export,Export,,active
```

- [ ] **Step 5: Run checks and commit**

```bash
npm --prefix dashboard run test -- --run src/App.test.jsx src/pages/ComparePage.test.jsx src/pages/ModelsPage.test.jsx src/pages/YieldPage.test.jsx src/pages/ExportPage.test.jsx
npm --prefix dashboard run build
git diff --check
git add dashboard/src/lib/api.ts dashboard/src/lib/vibedeck-api.ts dashboard/src/pages/ComparePage.jsx dashboard/src/pages/ModelsPage.jsx dashboard/src/pages/YieldPage.jsx dashboard/src/pages/ExportPage.jsx dashboard/src/pages/ComparePage.test.jsx dashboard/src/pages/ModelsPage.test.jsx dashboard/src/pages/YieldPage.test.jsx dashboard/src/pages/ExportPage.test.jsx dashboard/src/App.jsx dashboard/src/App.test.jsx dashboard/src/ui/openai/components/Sidebar.jsx dashboard/src/content/copy.csv
git commit -m "feat: add codeburn parity dashboard pages"
```

## Task 4: Dashboard Additive Panels And Settings Controls

**Files:**
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/pages/BranchesPage.jsx`
- Modify: `dashboard/src/pages/SettingsPage.jsx`
- Modify: `dashboard/src/pages/DashboardPage.test.jsx`
- Modify: `dashboard/src/pages/BranchesPage.test.jsx`
- Create: `dashboard/src/pages/SettingsPage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Add Dashboard MCP panel**

In `DashboardPage.jsx`, derive MCP tools from any response payloads already carrying `tools_json` by filtering keys with `mcp__`. Render an additive card titled `MCP servers` below existing model/provider panels. The panel must:

- show `No MCP activity in this window.` when no mcp keys exist.
- display rows `{server, calls}` where `server` is the string after the first two `__` segments when possible.
- never change existing totals or query params.

Add a test in `DashboardPage.test.jsx` with a mocked payload containing `tools_json: { "mcp__repo__search": 2, Read: 1 }` and assert `repo` and `2` appear.

- [ ] **Step 2: Add Branch yield badges**

In `BranchesPage.jsx`, call the new yield endpoint in the same date window as branch usage. Build a map by branch name and display a small badge beside each branch row: `productive`, `reverted`, `abandoned`, or `unknown`. If the endpoint fails or has no branch, hide the badge.

Add a test in `BranchesPage.test.jsx` that mocks yield response for branch `main` as `productive` and asserts the badge appears without changing branch token/cost text.

- [ ] **Step 3: Add Settings model alias and auto-detect controls**

In `SettingsPage.jsx`, add two `SectionCard`s:

- `Model aliases`: simple local-only editor with two text fields (`Alias`, `Canonical model`) and an `Add alias` button. Store aliases in `localStorage` key `vibedeck.modelAliases.v1`. This is a UI/config placeholder; backend alias config remains a follow-up unless Task 2 implemented env-backed aliases.
- `Provider auto-detect`: button `Scan providers` that calls `getAutoDetectedProviders` and lists provider display names with `found` or `missing`.

Create `SettingsPage.test.jsx`:

- mocks `getAutoDetectedProviders` to return `[{ id: 'claude', displayName: 'Claude', found: true }]`.
- asserts `Model aliases`, `Scan providers`, and `Claude` render.

- [ ] **Step 4: Run checks and commit**

```bash
npm --prefix dashboard run test -- --run src/pages/DashboardPage.test.jsx src/pages/BranchesPage.test.jsx src/pages/SettingsPage.test.jsx
npm --prefix dashboard run build
git diff --check
git add dashboard/src/pages/DashboardPage.jsx dashboard/src/pages/BranchesPage.jsx dashboard/src/pages/SettingsPage.jsx dashboard/src/pages/DashboardPage.test.jsx dashboard/src/pages/BranchesPage.test.jsx dashboard/src/pages/SettingsPage.test.jsx dashboard/src/content/copy.csv
git commit -m "feat: add parity panels to existing dashboard pages"
```

## Task 5: Mac App Compare Models Yield Tabs

**Files:**
- Create: `VibeDeckMac/VibeDeckMac/Models/CodeburnParityModels.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Services/APIClient.swift`
- Modify: `VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift`
- Create: `VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Views/DashboardView.swift`
- Modify: `VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj` only if new Swift files are manually registered in the project

- [ ] **Step 1: Add Swift decoders**

Create `CodeburnParityModels.swift` with null-safe models:

```swift
import Foundation

struct CodeburnTotals: Decodable, Equatable {
    let sessionCount: Int?
    let totalTokens: Int?
    let totalCostUSD: String?
    let costEstimated: Bool?
    let costQuality: String?

    enum CodingKeys: String, CodingKey {
        case sessionCount = "session_count"
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case costEstimated = "cost_estimated"
        case costQuality = "cost_quality"
    }
}

struct CompareMetricsResponse: Decodable, Equatable {
    let ok: Bool
    let asOf: String?
    let totals: CodeburnTotals?
    let metrics: [String: String]?

    enum CodingKeys: String, CodingKey { case ok, asOf = "as_of", totals, metrics }
}

struct ModelParityRow: Decodable, Equatable, Identifiable {
    var id: String { model }
    let model: String
    let providers: [String]?
    let totalTokens: Int?
    let totalCostUSD: String?
    let sessionCount: Int?
    let taskCategories: [String: Int]?

    enum CodingKeys: String, CodingKey {
        case model, providers
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
        case sessionCount = "session_count"
        case taskCategories = "task_categories"
    }
}

struct ModelsParityResponse: Decodable, Equatable {
    let ok: Bool
    let models: [ModelParityRow]
}

struct YieldBranchRow: Decodable, Equatable, Identifiable {
    var id: String { branch }
    let branch: String
    let yieldState: String
    let totalTokens: Int?
    let totalCostUSD: String?

    enum CodingKeys: String, CodingKey {
        case branch
        case yieldState = "yield_state"
        case totalTokens = "total_tokens"
        case totalCostUSD = "total_cost_usd"
    }
}

struct YieldResponse: Decodable, Equatable {
    let ok: Bool
    let branches: [YieldBranchRow]
}
```

- [ ] **Step 2: Add API client methods**

In `APIClient.swift`, follow the existing method style and add:

```swift
func fetchCompareMetrics() async throws -> CompareMetricsResponse
func fetchModelsParity() async throws -> ModelsParityResponse
func fetchYield() async throws -> YieldResponse
```

Each calls `/functions/vibedeck-compare`, `/functions/vibedeck-models`, and `/functions/vibedeck-yield` respectively.

- [ ] **Step 3: Add view model state and loader**

In `DashboardViewModel.swift`, add published properties:

```swift
@Published var compareMetrics: CompareMetricsResponse?
@Published var parityModels: ModelsParityResponse?
@Published var yieldSummary: YieldResponse?
@Published var parityError: String?
```

Add async method `refreshParityTabs()` that calls the three API methods independently. If one fails, keep other results and set `parityError`.

- [ ] **Step 4: Add SwiftUI tabs**

Create `CodeburnParityTabsView.swift` with `Compare`, `Models`, and `Yield` sections. It must render empty states when each response is nil or empty. Do not change existing Stats totals.

Add it to `DashboardView.swift` below existing stats/limits sections or inside the existing tab stack, depending on the file's current structure. The visible labels must be `Compare`, `Models`, and `Yield`.

- [ ] **Step 5: Run Mac checks and commit**

```bash
xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -destination 'generic/platform=macOS' build CODE_SIGNING_ALLOWED=NO
# If xcodebuild is unavailable in this environment, run:
find VibeDeckMac/VibeDeckMac -name '*.swift' -print0 | xargs -0 swiftc -parse-as-library -typecheck || true
git diff --check
git add VibeDeckMac/VibeDeckMac/Models/CodeburnParityModels.swift VibeDeckMac/VibeDeckMac/Services/APIClient.swift VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift VibeDeckMac/VibeDeckMac/Views/DashboardView.swift VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj
git commit -m "feat: add mac parity tabs"
```

If the fallback Swift typecheck cannot compile because the app uses Xcode-only resources, report that as an environment caveat but still require `git diff --check` and static inspection that new decoders use correct coding keys.

## Task 6: Phase 4 Machine Smoke, Reconciliation, And PROJECT.md

**Files:**
- Modify: `PROJECT.md`
- Test-only commands against copied/isolated DBs and dashboard/Mac builds

- [ ] **Step 1: Run backend suite**

```bash
node --test test/db-migration-014-codeburn-parity-fields.test.js test/session-event-codeburn-parity.test.js test/local-api-codeburn-parity.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-vibedeck-branch-usage-enrichment.test.js test/local-api-vibedeck-branch-usage-groups.test.js test/local-api-vibedeck-sessions-live-groups.test.js
```

Record pass count.

- [ ] **Step 2: Run dashboard suite/build**

```bash
npm --prefix dashboard run test -- --run src/App.test.jsx src/pages/ComparePage.test.jsx src/pages/ModelsPage.test.jsx src/pages/YieldPage.test.jsx src/pages/ExportPage.test.jsx src/pages/DashboardPage.test.jsx src/pages/BranchesPage.test.jsx src/pages/SettingsPage.test.jsx
npm --prefix dashboard run build
```

Record pass count and build result. Existing large chunk warning remains acceptable.

- [ ] **Step 3: Run local endpoint smoke on copied live DB**

```bash
TMPDIR=$(mktemp -d /tmp/vibedeck-phase4-smoke-XXXXXX)
LIVE_DB="$HOME/.vibedeck/tracker/vibedeck.sqlite3"
cp "$LIVE_DB" "$TMPDIR/vibedeck.sqlite3"
: > "$TMPDIR/queue.jsonl"
node - <<'NODE' "$TMPDIR/queue.jsonl"
const queuePath = process.argv[2];
const { createLocalApiHandler } = require('./src/lib/local-api');
const handler = createLocalApiHandler({ queuePath });
async function call(path) {
  const chunks = [];
  const url = new URL(`http://127.0.0.1${path}`);
  const req = { method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1' } };
  const res = { statusCode: 200, setHeader(){}, writeHead(c){ this.statusCode = c; }, write(c){ chunks.push(String(c)); }, end(c){ if (c) chunks.push(String(c)); } };
  const handled = await handler(req, res, url);
  if (!handled) throw new Error(`not handled ${path}`);
  console.log(path, res.statusCode || 200, chunks.join('').slice(0, 160).replace(/\s+/g, ' '));
}
(async () => {
  for (const route of ['/functions/vibedeck-compare', '/functions/vibedeck-models', '/functions/vibedeck-status', '/functions/vibedeck-yield', '/functions/vibedeck-export?format=json', '/functions/vibedeck-optimize/auto-detect']) {
    await call(route);
  }
})().catch((err) => { console.error(err); process.exit(1); });
NODE
```

Then query unchanged umbrella counts:

```bash
node - <<'NODE' "$TMPDIR/vibedeck.sqlite3"
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const out = {
  sessions: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get().c,
  events: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_events').get().c,
  branchFacts: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts').get().c,
  unknown: db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Unknown branch'").get().c,
  historical: db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Historical unknown'").get().c,
};
console.log(JSON.stringify(out));
db.close();
NODE
```

Record counts.

- [ ] **Step 4: Run isolated rebuild smoke**

Use the same safe shape as Phase 3:

```bash
TMPHOME=$(mktemp -d /tmp/vibedeck-phase4-home-XXXXXX)
for name in .claude .codex .cursor .gemini .openclaw .config .qwen .factory .kiro .kimi .codebuddy .craft-agent; do
  if [ -e "$HOME/$name" ]; then ln -s "$HOME/$name" "$TMPHOME/$name"; fi
done
START=$(date +%s)
HOME="$TMPHOME" node bin/vibedeck.js sync --rebuild-vibedeck-db --auto
END=$(date +%s)
echo "phase4_rebuild_seconds=$((END-START))"
node bin/vibedeck.js doctor || true
```

Query `$TMPHOME/.vibedeck/tracker/vibedeck.sqlite3` for session/event/fact/Unknown/Historical counts.

- [ ] **Step 5: Run direct write boundary scan**

```bash
node - <<'NODE'
const fs = require('fs');
for (const file of ['src/lib/codeburn-parity.js', 'src/lib/local-api.js']) {
  const text = fs.readFileSync(file, 'utf8');
  if (/INSERT INTO\s+vibedeck_branch_usage_facts|UPDATE\s+vibedeck_branch_usage_facts/i.test(text)) {
    throw new Error(`${file} writes branch facts directly`);
  }
}
console.log('ok: Phase 4 read models do not write branch facts directly');
NODE
```

- [ ] **Step 6: Optional browser smoke**

If dashboard build passes, start the app and use Browser/Playwright to open at least `/compare`, `/models`, `/yield`, and `/export` on localhost. Record whether each page renders a heading without a console error.

- [ ] **Step 7: Update PROJECT.md**

Append under Release `0.1.4`:

```markdown
#### Phase 4 - Codeburn Parity Dashboards

**Date:** 2026-05-23
**Branch:** `agent/phase-4-codeburn-parity-dashboards`
**Plan:** `docs/superpowers/plans/2026-05-23-phase-4-codeburn-parity-dashboards.md`

What changed:

- Added read-only Compare, Models, Yield, Export, Status, and Auto-detect endpoints over canonical VibeDeck facts.
- Added dashboard pages for Compare, Models, Yield, and Export plus additive MCP/yield/settings panels.
- Added additive Codeburn parity fields for task category, ordered tools, skills, and fast-mode tracking without changing cost facts.
- Added Mac app Compare/Models/Yield decoding and tabs where the local build allowed verification.
- Preserved `/dashboard`, `/usage`, `/branches`, `Unknown branch`, `Historical unknown`, and grouped/raw session totals through copied-live and isolated rebuild smoke.

Smoke results:

| Check | Result |
|---|---:|
| Backend parity suite | measured in this phase |
| Dashboard parity pages | measured in this phase |
| Dashboard production build | measured in this phase |
| Mac app build/typecheck | measured in this phase |
| Copied-live endpoint smoke | measured in this phase |
| Copied-live Unknown/Historical | measured in this phase |
| Isolated rebuild wall clock | measured in this phase |
| Isolated rebuild Unknown/Historical | measured in this phase |
| Direct branch-fact write scan | measured in this phase |

Caveats:

- Compare/yield rates are read-side workflow metrics, not billing sources.
- Cost per activity/tool is a share/read-side metric only; `vibedeck_branch_usage_facts.cost_usd` remains the single dollar source of truth.
- Auto-detect is filesystem-only and may report installed providers with zero usage if the provider has no logs.
```

Replace `measured in this phase` with real numbers before commit.

- [ ] **Step 8: Commit**

```bash
git add PROJECT.md
git commit -m "docs: record phase 4 parity smoke"
```

## Final Audit Gate For Phase 4

Run personally after all task reviewers are GREEN:

```bash
git status --short
node --test test/db-migration-014-codeburn-parity-fields.test.js test/session-event-codeburn-parity.test.js test/local-api-codeburn-parity.test.js
npm --prefix dashboard run build
```

Verify:

- Worktree is clean.
- New endpoints are read-only and do not write branch facts.
- `/dashboard`, `/usage`, `/branches` totals are not changed by Phase 4 code.
- Unknown branch and Historical unknown counts are visible after copied-live and isolated rebuild smoke.
- New pages render empty states with zero data.
- Mac app changes are either build-verified or documented with environment caveat.
