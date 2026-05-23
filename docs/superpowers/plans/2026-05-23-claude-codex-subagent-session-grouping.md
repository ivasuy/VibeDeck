# Claude/Codex Subagent Session Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add proof-backed Claude Code and Codex subagent session grouping so dashboard and branch drawers can show one work unit with member sessions, combined tokens, cost, models, tools, and time while preserving every raw session and existing total.

**Architecture:** Keep canonical sessions, branch facts, and cost facts unchanged. Add an additive, rebuildable grouping projection populated from local transcript proof, then annotate read-model payloads with group metadata and group cards. Grouping is a presentation/read-model layer only: it never rewrites branch, project, token, or dollar ownership.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:sqlite` `DatabaseSync`, VibeDeck SQLite migrations, existing `src/commands/sync.js` rebuild/sync drain, `src/lib/branch-usage.js`, `src/lib/sessions/live-rollups.js`, local API handlers, React dashboard drawers.

---

## Scope And Safety Rules

- Phase base branch: `agent/phase-1-claude-codex-enrichment`.
- Phase branch/worktree: `agent/phase-1-5-subagent-grouping` at `.worktrees/phase-1-5-subagent-grouping`.
- Do not modify Phase 1 enrichment semantics.
- Do not change `vibedeck_branch_usage_facts.cost_usd` or `total_cost_usd`; branch facts stay the dollar source of truth.
- Do not move tokens or cost between branches/projects/sessions.
- Do not infer a child branch from the parent branch.
- Do not group by cwd, timestamp overlap, branch name, model, nickname, prompt text, or similar heuristics.
- Group only when provider proof exists:
  - Claude: subagent path plus root transcript path or root session id in the same project transcript folder.
  - Codex: `payload.source.subagent.thread_spawn.parent_thread_id` plus a uniquely resolved canonical root session row.
- `VIBEDECK_SESSION_GROUPING_V1=shadow` is the default: extract and validate edges, but API/UI still render raw-only payloads.
- `VIBEDECK_SESSION_GROUPING_V1=preview` or `on`: API/UI include additive group cards and raw sessions remain visible.
- `VIBEDECK_SESSION_GROUPING_V1=off`: do not rebuild or expose grouping projection.

## Local Evidence This Plan Uses

- Claude local audit on this machine: `~/.claude/projects` has `108` JSONL files, `26` subagent JSONL files, and `27` subagent meta files.
- Claude subagent transcript sample keys include `agentId`, `sessionId`, `parentUuid`, `cwd`, `gitBranch`, `timestamp`, and `message`.
- Claude subagent meta sample keys include `agentType` and `description`.
- Claude root session layout observed locally: `~/.claude/projects/<encoded-cwd>/<rootSessionId>.jsonl` plus `~/.claude/projects/<encoded-cwd>/<rootSessionId>/subagents/agent-<agentId>.jsonl`.
- Codex local audit on this machine: `~/.codex/sessions` has `889` JSONL files and `563` subagent-looking files.
- Codex subagent proof sample: first `session_meta` payload has `payload.id`, `payload.thread_source = "subagent"`, `payload.source.subagent.thread_spawn.parent_thread_id`, `depth`, `agent_nickname`, and `agent_role`.
- VibeDeck canonical `session_id` for Claude/Codex is the transcript JSONL path, not only the provider thread id. Codex grouping must therefore resolve `parent_thread_id` to a unique canonical session row before it creates an edge.

## File Structure

- Create `src/lib/db/migrations/013-session-groups.js`: additive grouping projection tables.
- Modify `src/lib/db/index.js`: register migration 013.
- Create `src/lib/sessions/session-groups.js`: feature-flag parsing, provider proof extraction, root resolution, edge/skip persistence, diagnostics, read-model grouping helpers.
- Modify `src/commands/sync.js`: rebuild grouping projection after session-event drain and write diagnostics.
- Modify `src/lib/branch-usage.js`: attach group roles and branch-scoped group cards when sessions are included and grouping is preview/on.
- Modify `src/lib/sessions/live-rollups.js`: attach live/audit group roles and workstream group cards when grouping is preview/on.
- Modify `src/lib/local-api.js`: pass the tracker DB path and grouping mode into branch/live read models; expose diagnostics in snapshot payloads.
- Modify `dashboard/src/components/branches/BranchSessionDrawer.jsx`: render branch-scoped agent group cards and keep raw session rows visible.
- Modify `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`: render live workstream agent group cards and keep raw session rows visible.
- Add tests:
  - `test/db-migration-013-session-groups.test.js`
  - `test/session-groups.test.js`
  - `test/sync-session-groups.test.js`
  - `test/local-api-vibedeck-branch-usage-groups.test.js`
  - `test/local-api-vibedeck-sessions-live-groups.test.js`
  - Extend `dashboard/src/pages/BranchesPage.test.jsx`
  - Extend `dashboard/src/components/live/LiveSessionList.test.jsx`

## Public Payload Contract

When grouping is `preview` or `on`, raw session rows may include these additive fields:

```js
{
  session_group_id: "codex:019e-parent-thread-id",
  group_role: "root", // "root" | "child" | "ungrouped"
  group_depth: 0,
  agent_id: null,
  agent_label: "Main session",
  agent_role: null,
  relation_proof: "codex_thread_spawn"
}
```

Branch and live payloads may include `session_groups` arrays:

```js
{
  session_group_id: "claude:/path/to/root.jsonl",
  provider: "claude",
  root_session_id: "/path/to/root.jsonl",
  member_count: 3,
  active_member_count: 1,
  total_tokens: 3000,
  total_cost_usd: 1.23,
  cost_estimated: false,
  cost_quality: "stored",
  started_at: "2026-05-19T10:00:00.000Z",
  ended_at: "2026-05-19T10:30:00.000Z",
  models: [{ provider: "claude", model: "claude-opus-4-7", total_tokens: 3000, total_cost_usd: 1.23 }],
  members: [{ provider: "claude", session_id: "/path/to/root.jsonl", group_role: "root" }]
}
```

`total_cost_usd` is `null` when any member cost is unknown. Known costs still sum into `known_cost_usd`.

---

### Task 1: Add Additive Grouping Schema

**Files:**
- Create: `src/lib/db/migrations/013-session-groups.js`
- Modify: `src/lib/db/index.js`
- Modify: `test/db-ensure-schema.test.js`
- Test: `test/db-migration-013-session-groups.test.js`

- [ ] **Step 1: Write the failing migration test**

Create `test/db-migration-013-session-groups.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-session-groups-'));
  return {
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
}

test('migration 013 creates session group edge and skip tables', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name);
      assert.ok(tables.includes('vibedeck_session_group_edges'));
      assert.ok(tables.includes('vibedeck_session_group_skips'));

      for (const name of [
        'provider',
        'session_group_id',
        'root_session_id',
        'child_session_id',
        'root_thread_id',
        'child_thread_id',
        'relation_proof',
        'depth',
        'agent_id',
        'agent_label',
        'agent_role',
        'source_path',
        'created_at',
        'updated_at',
      ]) {
        assert.ok(tableColumns(db, 'vibedeck_session_group_edges').includes(name), `missing edge column ${name}`);
      }

      for (const name of [
        'provider',
        'child_session_id',
        'child_thread_id',
        'skip_reason',
        'source_path',
        'observed_at',
        'created_at',
        'updated_at',
      ]) {
        assert.ok(tableColumns(db, 'vibedeck_session_group_skips').includes(name), `missing skip column ${name}`);
      }
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('session group edge uniqueness is by provider and child session', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      const now = '2026-05-23T00:00:00.000Z';
      const insert = db.prepare(`
        INSERT INTO vibedeck_session_group_edges (
          provider, session_group_id, root_session_id, child_session_id,
          relation_proof, depth, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('codex', 'codex:root-a', 'root-a', 'child-a', 'codex_thread_spawn', 1, now, now);
      assert.throws(
        () => insert.run('codex', 'codex:root-b', 'root-b', 'child-a', 'codex_thread_spawn', 1, now, now),
        /UNIQUE|constraint/i,
      );
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
node --test test/db-migration-013-session-groups.test.js
```

Expected: FAIL because `vibedeck_session_group_edges` does not exist.

- [ ] **Step 3: Create migration 013**

Create `src/lib/db/migrations/013-session-groups.js`:

```js
'use strict';

module.exports = {
  component: 'vibedeck-session-groups',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_group_edges (
        provider TEXT NOT NULL,
        session_group_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        root_thread_id TEXT,
        child_thread_id TEXT,
        relation_proof TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 1,
        agent_id TEXT,
        agent_label TEXT,
        agent_role TEXT,
        source_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, child_session_id),
        CHECK (root_session_id <> child_session_id)
      );

      CREATE INDEX idx_session_group_edges_group
        ON vibedeck_session_group_edges(provider, session_group_id);

      CREATE INDEX idx_session_group_edges_root
        ON vibedeck_session_group_edges(provider, root_session_id);

      CREATE TABLE vibedeck_session_group_skips (
        provider TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        child_thread_id TEXT,
        skip_reason TEXT NOT NULL,
        source_path TEXT,
        observed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, child_session_id, skip_reason)
      );

      CREATE INDEX idx_session_group_skips_reason
        ON vibedeck_session_group_skips(provider, skip_reason);
    `);
  },
};
```

- [ ] **Step 4: Register migration 013**

Modify `src/lib/db/index.js`:

```js
const m013 = require('./migrations/013-session-groups');
```

Add after `registerMigration(m012);`:

```js
  registerMigration(m013);
```

- [ ] **Step 5: Update schema smoke test**

Modify `test/db-ensure-schema.test.js` and add these table names to `vibedeckTables`:

```js
      "vibedeck_session_group_edges",
      "vibedeck_session_group_skips",
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
node --test test/db-migration-013-session-groups.test.js test/db-ensure-schema.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/db/migrations/013-session-groups.js src/lib/db/index.js test/db-migration-013-session-groups.test.js test/db-ensure-schema.test.js
git commit -m "feat: add session grouping schema"
```

---

### Task 2: Build Grouping Projection Helper

**Files:**
- Create: `src/lib/sessions/session-groups.js`
- Test: `test/session-groups.test.js`

- [ ] **Step 1: Write failing helper tests**

Create `test/session-groups.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const {
  readSessionGroupingMode,
  deriveClaudeGroupEvidence,
  deriveCodexGroupEvidence,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
} = require('../src/lib/sessions/session-groups');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-session-groups-helper-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    dir,
    dbPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, cwd, repo_root, branch, model, started_at, ended_at,
      total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count,
      total_cost_usd, cost_estimated, cost_quality, state, updated_at, created_at
    ) VALUES (
      @provider, @session_id, @cwd, @repo_root, @branch, @model, @started_at, @ended_at,
      @total_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @conversation_count,
      @total_cost_usd, @cost_estimated, @cost_quality, @state, @updated_at, @created_at
    )
  `).run({
    cwd: null,
    repo_root: null,
    branch: null,
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: '2026-05-23T10:10:00.000Z',
    total_tokens: 100,
    input_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    conversation_count: 1,
    total_cost_usd: 0.01,
    cost_estimated: 0,
    cost_quality: 'stored',
    state: 'ended',
    updated_at: '2026-05-23T10:10:00.000Z',
    created_at: '2026-05-23T10:00:00.000Z',
    ...row,
  });
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

test('readSessionGroupingMode accepts off shadow preview and on', () => {
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'off' }), 'off');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'shadow' }), 'shadow');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'preview' }), 'preview');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'on' }), 'on');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: '' }), 'shadow');
  assert.equal(readSessionGroupingMode({}), 'shadow');
});

test('deriveClaudeGroupEvidence links subagent transcript to sibling root transcript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-group-'));
  try {
    const projectDir = path.join(root, '-repo');
    const rootId = 'root-session';
    const rootPath = path.join(projectDir, `${rootId}.jsonl`);
    const childPath = path.join(projectDir, rootId, 'subagents', 'agent-a1.jsonl');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJsonl(rootPath, [{ type: 'assistant', timestamp: '2026-05-23T10:00:00.000Z' }]);
    writeJsonl(childPath, [{
      type: 'assistant',
      timestamp: '2026-05-23T10:01:00.000Z',
      agentId: 'a1',
      sessionId: rootId,
    }]);
    fs.writeFileSync(childPath.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({
      agentType: 'reviewer',
      description: 'Reviews the implementation',
    }));

    const edge = deriveClaudeGroupEvidence({ provider: 'claude', session_id: childPath });
    assert.equal(edge.kind, 'edge');
    assert.equal(edge.edge.provider, 'claude');
    assert.equal(edge.edge.root_session_id, rootPath);
    assert.equal(edge.edge.child_session_id, childPath);
    assert.equal(edge.edge.relation_proof, 'claude_subagent_path');
    assert.equal(edge.edge.depth, 1);
    assert.equal(edge.edge.agent_id, 'a1');
    assert.equal(edge.edge.agent_role, 'reviewer');
    assert.equal(edge.edge.agent_label, 'Reviews the implementation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveCodexGroupEvidence resolves parent thread id to one canonical root session', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const rootFile = path.join(tmp.dir, 'rollout-2026-05-23T10-00-00-parent-thread.jsonl');
    const childFile = path.join(tmp.dir, 'rollout-2026-05-23T10-05-00-child-thread.jsonl');
    writeJsonl(rootFile, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(childFile, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        agent_nickname: 'Curie',
        agent_role: 'reviewer',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1, agent_nickname: 'Curie', agent_role: 'reviewer' } } },
      },
    }]);
    insertSession(db, { provider: 'codex', session_id: rootFile });
    insertSession(db, { provider: 'codex', session_id: childFile });
    db.close();

    const edge = deriveCodexGroupEvidence(tmp.dbPath, { provider: 'codex', session_id: childFile });
    assert.equal(edge.kind, 'edge');
    assert.equal(edge.edge.provider, 'codex');
    assert.equal(edge.edge.root_session_id, rootFile);
    assert.equal(edge.edge.child_session_id, childFile);
    assert.equal(edge.edge.root_thread_id, 'parent-thread');
    assert.equal(edge.edge.child_thread_id, 'child-thread');
    assert.equal(edge.edge.agent_label, 'Curie');
    assert.equal(edge.edge.agent_role, 'reviewer');
    assert.equal(edge.edge.relation_proof, 'codex_thread_spawn');
  } finally {
    tmp.cleanup();
  }
});

test('rebuildSessionGroupProjection writes edges and skipped orphan diagnostics', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const parentFile = path.join(tmp.dir, 'rollout-parent-thread.jsonl');
    const childFile = path.join(tmp.dir, 'rollout-child-thread.jsonl');
    const orphanFile = path.join(tmp.dir, 'rollout-orphan-thread.jsonl');
    writeJsonl(parentFile, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(childFile, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      },
    }]);
    writeJsonl(orphanFile, [{
      type: 'session_meta',
      payload: { id: 'orphan-thread', thread_source: 'subagent', source: { subagent: { thread_spawn: { depth: 1 } } } },
    }]);
    insertSession(db, { provider: 'codex', session_id: parentFile });
    insertSession(db, { provider: 'codex', session_id: childFile });
    insertSession(db, { provider: 'codex', session_id: orphanFile });
    db.close();

    const summary = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow' });
    assert.equal(summary.edges_written, 1);
    assert.equal(summary.skips_written, 1);

    const diagnostics = readSessionGroupDiagnostics(tmp.dbPath);
    assert.equal(diagnostics.grouped_child_sessions, 1);
    assert.equal(diagnostics.skipped_edges, 1);
    assert.deepEqual(diagnostics.skips_by_reason, { missing_parent_thread_id: 1 });
  } finally {
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
node --test test/session-groups.test.js
```

Expected: FAIL because `src/lib/sessions/session-groups.js` does not exist.

- [ ] **Step 3: Implement `session-groups.js`**

Create `src/lib/sessions/session-groups.js` with these exported functions:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createCostAccumulator, addCostToAccumulator, finalizeCostAccumulator } = require('../cost-estimation');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readSessionGroupingMode(env = process.env) {
  const raw = text(env?.VIBEDECK_SESSION_GROUPING_V1).toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'preview' || raw === 'on') return raw;
  return 'shadow';
}

function groupingVisible(mode = readSessionGroupingMode()) {
  return mode === 'preview' || mode === 'on';
}

function readFirstJsonLine(filePath) {
  if (!text(filePath) || !fs.existsSync(filePath)) return null;
  let raw = '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    raw = buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }
  return null;
}

function readJsonFile(filePath) {
  if (!text(filePath) || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function groupId(provider, rootSessionId) {
  return `${provider}:${rootSessionId}`;
}

function skip(provider, childSessionId, reason, extra = {}) {
  return {
    kind: 'skip',
    skip: {
      provider,
      child_session_id: childSessionId,
      skip_reason: reason,
      source_path: childSessionId,
      ...extra,
    },
  };
}

function deriveClaudeGroupEvidence(session) {
  const provider = text(session?.provider).toLowerCase();
  const childSessionId = text(session?.session_id);
  if (provider !== 'claude') return null;
  if (!childSessionId.includes(`${path.sep}subagents${path.sep}`) || !childSessionId.endsWith('.jsonl')) return null;

  const subagentsDir = path.dirname(childSessionId);
  const rootSessionDir = path.dirname(subagentsDir);
  const rootId = path.basename(rootSessionDir);
  const projectDir = path.dirname(rootSessionDir);
  const rootSessionId = path.join(projectDir, `${rootId}.jsonl`);
  if (!fs.existsSync(rootSessionId)) {
    return skip(provider, childSessionId, 'claude_root_session_missing');
  }

  const first = readFirstJsonLine(childSessionId) || {};
  const meta = readJsonFile(childSessionId.replace(/\.jsonl$/, '.meta.json')) || {};
  const agentId = text(first.agentId) || path.basename(childSessionId, '.jsonl').replace(/^agent-/, '') || null;
  const agentRole = text(meta.agentType) || text(first.attributionAgent) || null;
  const agentLabel = text(meta.description) || text(meta.agentType) || (agentId ? `agent-${agentId}` : 'Subagent');
  return {
    kind: 'edge',
    edge: {
      provider,
      session_group_id: groupId(provider, rootSessionId),
      root_session_id: rootSessionId,
      child_session_id: childSessionId,
      root_thread_id: rootId,
      child_thread_id: agentId,
      relation_proof: 'claude_subagent_path',
      depth: 1,
      agent_id: agentId,
      agent_label: agentLabel,
      agent_role: agentRole,
      source_path: childSessionId,
    },
  };
}

function resolveUniqueCodexRootSession(db, provider, parentThreadId, childSessionId) {
  const rows = db
    .prepare(`
      SELECT session_id
      FROM vibedeck_sessions
      WHERE provider = ?
        AND session_id <> ?
        AND (session_id = ? OR session_id LIKE ?)
      ORDER BY LENGTH(session_id) ASC, session_id ASC
    `)
    .all(provider, childSessionId, parentThreadId, `%${parentThreadId}%`);
  if (rows.length === 1) return { ok: true, session_id: rows[0].session_id };
  if (rows.length === 0) return { ok: false, reason: 'parent_session_missing' };
  return { ok: false, reason: 'parent_session_ambiguous' };
}

function deriveCodexGroupEvidence(dbPath, session) {
  const provider = text(session?.provider).toLowerCase();
  const childSessionId = text(session?.session_id);
  if (provider !== 'codex' && provider !== 'every-code') return null;
  if (!childSessionId.endsWith('.jsonl')) return null;
  const first = readFirstJsonLine(childSessionId);
  const payload = first?.payload && typeof first.payload === 'object' ? first.payload : {};
  const spawn = payload?.source?.subagent?.thread_spawn || {};
  const isSubagent = payload.thread_source === 'subagent' || !!payload?.source?.subagent;
  if (!isSubagent) return null;
  const childThreadId = text(payload.id) || null;
  const parentThreadId = text(spawn.parent_thread_id);
  if (!parentThreadId) {
    return skip(provider, childSessionId, 'missing_parent_thread_id', { child_thread_id: childThreadId });
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let resolved;
  try {
    resolved = resolveUniqueCodexRootSession(db, provider, parentThreadId, childSessionId);
  } finally {
    db.close();
  }
  if (!resolved.ok) {
    return skip(provider, childSessionId, resolved.reason, { child_thread_id: childThreadId });
  }

  const depth = Number.isInteger(spawn.depth) && spawn.depth >= 0 ? spawn.depth : 1;
  const agentLabel = text(payload.agent_nickname) || text(spawn.agent_nickname) || null;
  const agentRole = text(payload.agent_role) || text(spawn.agent_role) || null;
  return {
    kind: 'edge',
    edge: {
      provider,
      session_group_id: groupId(provider, resolved.session_id),
      root_session_id: resolved.session_id,
      child_session_id: childSessionId,
      root_thread_id: parentThreadId,
      child_thread_id: childThreadId,
      relation_proof: 'codex_thread_spawn',
      depth,
      agent_id: childThreadId,
      agent_label: agentLabel,
      agent_role: agentRole,
      source_path: childSessionId,
    },
  };
}

function deriveGroupEvidence(dbPath, session) {
  const provider = text(session?.provider).toLowerCase();
  if (provider === 'claude') return deriveClaudeGroupEvidence(session);
  if (provider === 'codex' || provider === 'every-code') return deriveCodexGroupEvidence(dbPath, session);
  return null;
}

function rebuildSessionGroupProjection(dbPath, { mode = readSessionGroupingMode(), now = new Date().toISOString() } = {}) {
  if (mode === 'off') return { mode, scanned_sessions: 0, edges_written: 0, skips_written: 0 };
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    db.prepare("DELETE FROM vibedeck_session_group_edges WHERE provider IN ('claude', 'codex', 'every-code')").run();
    db.prepare("DELETE FROM vibedeck_session_group_skips WHERE provider IN ('claude', 'codex', 'every-code')").run();
    const sessions = db
      .prepare("SELECT provider, session_id FROM vibedeck_sessions WHERE provider IN ('claude', 'codex', 'every-code') ORDER BY provider, session_id")
      .all();
    const insertEdge = db.prepare(`
      INSERT INTO vibedeck_session_group_edges (
        provider, session_group_id, root_session_id, child_session_id,
        root_thread_id, child_thread_id, relation_proof, depth,
        agent_id, agent_label, agent_role, source_path, created_at, updated_at
      ) VALUES (
        @provider, @session_group_id, @root_session_id, @child_session_id,
        @root_thread_id, @child_thread_id, @relation_proof, @depth,
        @agent_id, @agent_label, @agent_role, @source_path, @created_at, @updated_at
      )
    `);
    const insertSkip = db.prepare(`
      INSERT INTO vibedeck_session_group_skips (
        provider, child_session_id, child_thread_id, skip_reason,
        source_path, observed_at, created_at, updated_at
      ) VALUES (
        @provider, @child_session_id, @child_thread_id, @skip_reason,
        @source_path, @observed_at, @created_at, @updated_at
      )
    `);
    let edgesWritten = 0;
    let skipsWritten = 0;
    for (const session of sessions) {
      const evidence = deriveGroupEvidence(dbPath, session);
      if (!evidence) continue;
      if (evidence.kind === 'edge') {
        insertEdge.run({ ...evidence.edge, created_at: now, updated_at: now });
        edgesWritten += 1;
      } else if (evidence.kind === 'skip') {
        insertSkip.run({ ...evidence.skip, observed_at: now, created_at: now, updated_at: now });
        skipsWritten += 1;
      }
    }
    db.exec('COMMIT');
    return { mode, scanned_sessions: sessions.length, edges_written: edgesWritten, skips_written: skipsWritten };
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch {}
    throw err;
  } finally {
    db.close();
  }
}

function readSessionGroupDiagnostics(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { grouped_child_sessions: 0, skipped_edges: 0, groups_by_provider: {}, skips_by_reason: {} };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const grouped = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_group_edges').get().n || 0;
    const skipped = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_group_skips').get().n || 0;
    const groupsByProvider = {};
    for (const row of db.prepare('SELECT provider, COUNT(DISTINCT session_group_id) AS n FROM vibedeck_session_group_edges GROUP BY provider').all()) {
      groupsByProvider[row.provider] = row.n;
    }
    const skipsByReason = {};
    for (const row of db.prepare('SELECT skip_reason, COUNT(*) AS n FROM vibedeck_session_group_skips GROUP BY skip_reason').all()) {
      skipsByReason[row.skip_reason] = row.n;
    }
    return {
      grouped_child_sessions: grouped,
      skipped_edges: skipped,
      groups_by_provider: groupsByProvider,
      skips_by_reason: skipsByReason,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  readSessionGroupingMode,
  groupingVisible,
  deriveClaudeGroupEvidence,
  deriveCodexGroupEvidence,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
  // Task 4 extends this module with read-model helpers and must add those
  // exports in the same edit: readGroupEdges, buildSessionGroupsForRows.
};
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
node --test test/session-groups.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions/session-groups.js test/session-groups.test.js
git commit -m "feat: derive Claude and Codex session groups"
```

---

### Task 3: Rebuild Group Projection During Sync

**Files:**
- Modify: `src/commands/sync.js`
- Test: `test/sync-session-groups.test.js`

- [ ] **Step 1: Write failing sync projection test**

Create `test/sync-session-groups.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { rebuildSessionGroupProjection, readSessionGroupDiagnostics } = require('../src/lib/sessions/session-groups');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sync-session-groups-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, cwd, model, started_at, ended_at,
      total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count,
      total_cost_usd, cost_estimated, cost_quality, state, updated_at, created_at
    ) VALUES (
      @provider, @session_id, @cwd, @model, @started_at, @ended_at,
      @total_tokens, 0, 0, 0, @total_tokens, 0, 1,
      @total_cost_usd, 0, 'stored', 'ended', @ended_at, @started_at
    )
  `).run({
    cwd: '/repo',
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: '2026-05-23T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 0.01,
    ...row,
  });
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

test('rebuildSessionGroupProjection is idempotent and clears stale edges', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const parent = path.join(tmp.dir, 'rollout-parent-thread.jsonl');
    const child = path.join(tmp.dir, 'rollout-child-thread.jsonl');
    writeJsonl(parent, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(child, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      },
    }]);
    insertSession(db, { provider: 'codex', session_id: parent });
    insertSession(db, { provider: 'codex', session_id: child });
    db.close();

    const first = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow', now: '2026-05-23T11:00:00.000Z' });
    const second = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow', now: '2026-05-23T11:01:00.000Z' });
    assert.equal(first.edges_written, 1);
    assert.equal(second.edges_written, 1);

    const verify = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      assert.equal(verify.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_group_edges').get().n, 1);
      const diagnostics = readSessionGroupDiagnostics(tmp.dbPath);
      assert.equal(diagnostics.grouped_child_sessions, 1);
      assert.equal(diagnostics.skipped_edges, 0);
    } finally {
      verify.close();
    }
  } finally {
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run the test**

Run:

```bash
node --test test/sync-session-groups.test.js
```

Expected: PASS once Task 2 helper exists. This test protects the helper before sync wiring.

- [ ] **Step 3: Wire sync diagnostics**

Modify `src/commands/sync.js`:

```js
const {
  readSessionGroupingMode,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
} = require("../lib/sessions/session-groups");
```

After `sessionEventDrain` is complete and before branch/project indexes rebuild, add:

```js
    const sessionGroupingMode = readSessionGroupingMode(process.env);
    let sessionGroupSummary = null;
    if (sessionGroupingMode !== "off") {
      lifecycle?.provider?.("Session groups", "building Claude/Codex group projection");
      sessionGroupSummary = rebuildSessionGroupProjection(dbPath, { mode: sessionGroupingMode });
      const diagnostics = readSessionGroupDiagnostics(dbPath);
      await fs.mkdir(path.join(trackerDir, "diagnostics"), { recursive: true });
      await fs.writeFile(
        path.join(trackerDir, "diagnostics", "session-groups.json"),
        JSON.stringify({ ...sessionGroupSummary, diagnostics }, null, 2),
        "utf8",
      );
      lifecycle?.providerDone?.(
        "Session groups",
        `${sessionGroupSummary.edges_written} grouped, ${sessionGroupSummary.skips_written} skipped`,
      );
    }
```

Keep this block outside branch-fact rebuild logic so grouping cannot mutate branch attribution.

- [ ] **Step 4: Add a direct command-level smoke test if sync imports are stable**

Extend `test/sync-session-groups.test.js` with a narrow import test:

```js
test('sync module can load with session grouping helper wired', () => {
  const sync = require('../src/commands/sync');
  assert.equal(typeof sync.cmdSync, 'function');
});
```

- [ ] **Step 5: Run sync grouping tests**

Run:

```bash
node --test test/sync-session-groups.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/commands/sync.js test/sync-session-groups.test.js
git commit -m "feat: rebuild session group projection during sync"
```

---

### Task 4: Add Branch Usage Group Read Model

**Files:**
- Modify: `src/lib/sessions/session-groups.js`
- Modify: `src/lib/branch-usage.js`
- Test: `test/local-api-vibedeck-branch-usage-groups.test.js`

- [ ] **Step 1: Write failing branch API tests**

Create `test/local-api-vibedeck-branch-usage-groups.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { queryBranchUsage } = require('../src/lib/branch-usage');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-branch-groups-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertFact(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_branch_usage_facts (
      provider, session_id, scope_key, project_state, project_key, project_ref,
      cwd, repo_root, branch, attribution_branch, branch_kind,
      branch_resolution_tier, confidence, model, first_observed_at, last_observed_at,
      event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count, total_cost_usd,
      cost_estimated, cost_quality, token_reconciled, cost_reconciled, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @scope_key, 'git_existing', 'repo', '/repo',
      '/repo', '/repo', @branch, @attribution_branch, @branch_kind,
      @branch_resolution_tier, @confidence, @model, @first_observed_at, @last_observed_at,
      1, @total_tokens, 0, 0, 0,
      @total_tokens, 0, 1, @total_cost_usd,
      0, 'stored', 0, 0, @first_observed_at, @last_observed_at
    )
  `).run({
    scope_key: 'session',
    branch: 'release/0.1.3',
    attribution_branch: row?.branch || 'release/0.1.3',
    branch_kind: 'known',
    branch_resolution_tier: 'PROVIDER_LOG',
    confidence: 'high',
    model: 'gpt-5.5',
    first_observed_at: '2026-05-23T10:00:00.000Z',
    last_observed_at: '2026-05-23T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 0.01,
    ...row,
  });
}

function insertEdge(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_group_edges (
      provider, session_group_id, root_session_id, child_session_id,
      root_thread_id, child_thread_id, relation_proof, depth,
      agent_id, agent_label, agent_role, source_path, created_at, updated_at
    ) VALUES (
      @provider, @session_group_id, @root_session_id, @child_session_id,
      @root_thread_id, @child_thread_id, @relation_proof, @depth,
      @agent_id, @agent_label, @agent_role, @source_path, @created_at, @updated_at
    )
  `).run({
    root_thread_id: null,
    child_thread_id: null,
    relation_proof: 'codex_thread_spawn',
    depth: 1,
    agent_id: null,
    agent_label: 'Curie',
    agent_role: 'reviewer',
    source_path: null,
    created_at: '2026-05-23T10:00:00.000Z',
    updated_at: '2026-05-23T10:00:00.000Z',
    ...row,
  });
}

test('branch usage adds group cards in preview mode without changing totals', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertFact(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10 });
    insertFact(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05 });
    insertEdge(db, {
      provider: 'codex',
      session_group_id: 'codex:root',
      root_session_id: 'root',
      child_session_id: 'child',
    });
    db.close();

    const raw = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'shadow' });
    const grouped = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'preview' });
    assert.equal(raw.totals.total_tokens, grouped.totals.total_tokens);
    assert.equal(raw.repos[0].branches[0].total_tokens, grouped.repos[0].branches[0].total_tokens);
    assert.equal(raw.repos[0].branches[0].session_groups, undefined);

    const branch = grouped.repos[0].branches[0];
    assert.equal(branch.sessions.length, 2);
    assert.equal(branch.session_groups.length, 1);
    assert.equal(branch.session_groups[0].member_count, 2);
    assert.equal(branch.session_groups[0].total_tokens, 150);
    assert.equal(branch.session_groups[0].total_cost_usd, 0.15);
    assert.equal(branch.sessions.find((row) => row.session_id === 'root').group_role, 'root');
    assert.equal(branch.sessions.find((row) => row.session_id === 'child').group_role, 'child');
  } finally {
    tmp.cleanup();
  }
});

test('branch usage keeps unknown child branch separate and does not inherit root branch', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertFact(db, { provider: 'codex', session_id: 'root', branch: 'main', total_tokens: 100, total_cost_usd: 0.10 });
    insertFact(db, {
      provider: 'codex',
      session_id: 'child',
      branch: 'Historical unknown',
      attribution_branch: null,
      branch_kind: 'unknown',
      confidence: 'unattributed',
      total_tokens: 50,
      total_cost_usd: 0.05,
    });
    insertEdge(db, {
      provider: 'codex',
      session_group_id: 'codex:root',
      root_session_id: 'root',
      child_session_id: 'child',
    });
    db.close();

    const grouped = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'preview' });
    const branches = grouped.repos.flatMap((repo) => repo.branches.map((branch) => branch.branch));
    assert.ok(branches.includes('main'));
    assert.ok(branches.includes('Historical unknown'));
    const unknownBranch = grouped.repos.flatMap((repo) => repo.branches).find((branch) => branch.branch === 'Historical unknown');
    assert.equal(unknownBranch.sessions[0].session_id, 'child');
    assert.equal(unknownBranch.sessions[0].branch, undefined);
  } finally {
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run branch group tests and verify they fail**

Run:

```bash
node --test test/local-api-vibedeck-branch-usage-groups.test.js
```

Expected: FAIL because `queryBranchUsage` does not accept a grouping context and does not return `session_groups`.

- [ ] **Step 3: Add grouping read-model helpers**

Extend `src/lib/sessions/session-groups.js` with:

```js
function readGroupEdges(dbPath) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM vibedeck_session_group_edges ORDER BY provider, session_group_id, child_session_id').all();
  } finally {
    db.close();
  }
}

function sessionKey(row) {
  return `${text(row?.provider).toLowerCase()}:${text(row?.session_id)}`;
}

function buildSessionGroupsForRows(rows, edges, { includeMembers = true } = {}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const byKey = new Map(rowList.map((row) => [sessionKey(row), row]));
  const childToEdge = new Map();
  const rootToEdges = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const childKey = `${text(edge.provider).toLowerCase()}:${text(edge.child_session_id)}`;
    const rootKey = `${text(edge.provider).toLowerCase()}:${text(edge.root_session_id)}`;
    childToEdge.set(childKey, edge);
    if (!rootToEdges.has(rootKey)) rootToEdges.set(rootKey, []);
    rootToEdges.get(rootKey).push(edge);
  }

  const annotated = rowList.map((row) => {
    const key = sessionKey(row);
    const childEdge = childToEdge.get(key);
    if (childEdge) {
      return {
        ...row,
        session_group_id: childEdge.session_group_id,
        group_role: 'child',
        group_depth: childEdge.depth,
        agent_id: childEdge.agent_id,
        agent_label: childEdge.agent_label,
        agent_role: childEdge.agent_role,
        relation_proof: childEdge.relation_proof,
      };
    }
    const hasChildren = rootToEdges.has(key);
    return {
      ...row,
      session_group_id: hasChildren ? rootToEdges.get(key)[0].session_group_id : null,
      group_role: hasChildren ? 'root' : 'ungrouped',
      group_depth: hasChildren ? 0 : null,
      agent_label: hasChildren ? 'Main session' : null,
    };
  });

  const byAnnotatedKey = new Map(annotated.map((row) => [sessionKey(row), row]));
  const groups = [];
  for (const [rootKey, groupEdges] of rootToEdges.entries()) {
    const root = byAnnotatedKey.get(rootKey);
    const members = [];
    if (root) members.push(root);
    for (const edge of groupEdges) {
      const child = byAnnotatedKey.get(`${text(edge.provider).toLowerCase()}:${text(edge.child_session_id)}`);
      if (child) members.push(child);
    }
    if (members.length < 2) continue;
    groups.push(summarizeGroup(groupEdges[0].session_group_id, root || members[0], members, { includeMembers }));
  }

  return { sessions: annotated, session_groups: groups };
}
```

Add `summarizeGroup()` above `buildSessionGroupsForRows()`:

```js
function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function minIso(values) {
  const valid = values.map(text).filter(Boolean).sort();
  return valid[0] || null;
}

function maxIso(values) {
  const valid = values.map(text).filter(Boolean).sort();
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

function summarizeGroup(sessionGroupId, root, members, { includeMembers = true } = {}) {
  const tokenTotal = members.reduce((sum, row) => sum + (numberOrNull(row.total_tokens) || 0), 0);
  let knownCostUsd = 0;
  let costUnknownCount = 0;
  const modelMap = new Map();

  for (const row of members) {
    const cost = numberOrNull(row.total_cost_usd);
    if (cost == null) costUnknownCount += 1;
    else knownCostUsd += cost;

    const modelKey = `${text(row.provider).toLowerCase()}:${text(row.model) || 'unknown'}`;
    const model = modelMap.get(modelKey) || {
      provider: text(row.provider).toLowerCase(),
      model: text(row.model) || 'unknown',
      total_tokens: 0,
      total_cost_usd: 0,
      cost_unknown_count: 0,
    };
    model.total_tokens += numberOrNull(row.total_tokens) || 0;
    if (cost == null) model.cost_unknown_count += 1;
    else model.total_cost_usd += cost;
    modelMap.set(modelKey, model);
  }

  const models = Array.from(modelMap.values()).map((model) => ({
    ...model,
    total_cost_usd: model.cost_unknown_count > 0 ? null : model.total_cost_usd,
  }));
  const rootSessionId = text(root?.session_id) || text(members[0]?.session_id);

  return {
    session_group_id: sessionGroupId,
    provider: text(root?.provider || members[0]?.provider).toLowerCase(),
    root_session_id: rootSessionId,
    member_count: members.length,
    active_member_count: members.filter((row) => text(row.state).toLowerCase() === 'live' || !text(row.ended_at)).length,
    total_tokens: tokenTotal,
    total_cost_usd: costUnknownCount > 0 ? null : knownCostUsd,
    known_cost_usd: knownCostUsd,
    cost_unknown_count: costUnknownCount,
    cost_estimated: members.some((row) => Boolean(row.cost_estimated)),
    cost_quality: costUnknownCount > 0 ? 'unknown' : 'stored',
    started_at: minIso(members.map((row) => row.started_at || row.first_observed_at)),
    ended_at: maxIso(members.map((row) => row.ended_at || row.last_observed_at)),
    models,
    members: includeMembers ? members : undefined,
  };
}
```

Update `module.exports` in the same file:

```js
module.exports = {
  readSessionGroupingMode,
  groupingVisible,
  deriveClaudeGroupEvidence,
  deriveCodexGroupEvidence,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
  readGroupEdges,
  buildSessionGroupsForRows,
};
```

- [ ] **Step 4: Attach groups inside `queryBranchUsage`**

Modify `src/lib/branch-usage.js`:

```js
const {
  groupingVisible,
  readSessionGroupingMode,
  readGroupEdges,
  buildSessionGroupsForRows,
} = require('./sessions/session-groups');
```

Change signature to accept optional context:

```js
function queryBranchUsage(dbPath, options = {}, context = {}) {
```

Inside each finalized branch, before returning:

```js
const groupingMode = context.groupingMode || readSessionGroupingMode();
const edges = groupingVisible(groupingMode) && includeSessions ? readGroupEdges(dbPath) : [];
```

For branch sessions:

```js
const groupedSessions = groupingVisible(groupingMode) && Array.isArray(sessions)
  ? buildSessionGroupsForRows(sessions, edges)
  : { sessions, session_groups: undefined };
```

Return `sessions: groupedSessions.sessions` and `session_groups: groupedSessions.session_groups`.

- [ ] **Step 5: Run branch group tests**

Run:

```bash
node --test test/local-api-vibedeck-branch-usage-groups.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-vibedeck-branch-usage-enrichment.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/sessions/session-groups.js src/lib/branch-usage.js test/local-api-vibedeck-branch-usage-groups.test.js
git commit -m "feat: add branch session group read model"
```

---

### Task 5: Add Live Snapshot Group Read Model

**Files:**
- Modify: `src/lib/sessions/live-rollups.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-sessions-live-groups.test.js`

- [ ] **Step 1: Write failing live snapshot tests**

Create `test/local-api-vibedeck-sessions-live-groups.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');

function makeTracker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-live-groups-'));
  const trackerDir = path.join(dir, '.vibedeck', 'tracker');
  fs.mkdirSync(trackerDir, { recursive: true });
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const queuePath = path.join(trackerDir, 'usage.jsonl');
  fs.writeFileSync(queuePath, '');
  ensureSchema(dbPath);
  return { dir, trackerDir, dbPath, queuePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, cwd, repo_root, branch, model, started_at, ended_at,
      total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count,
      total_cost_usd, cost_estimated, cost_quality, state, updated_at, created_at
    ) VALUES (
      @provider, @session_id, '/repo', '/repo', @branch, @model, @started_at, @ended_at,
      @total_tokens, 0, 0, 0,
      @total_tokens, 0, 1,
      @total_cost_usd, 0, 'stored', @state, @updated_at, @started_at
    )
  `).run({
    branch: 'release/0.1.3',
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: null,
    total_tokens: 100,
    total_cost_usd: 0.01,
    state: 'live',
    updated_at: '2026-05-23T10:10:00.000Z',
    ...row,
  });
}

function insertEdge(db) {
  db.prepare(`
    INSERT INTO vibedeck_session_group_edges (
      provider, session_group_id, root_session_id, child_session_id,
      relation_proof, depth, agent_label, agent_role, created_at, updated_at
    ) VALUES (
      'codex', 'codex:root', 'root', 'child',
      'codex_thread_spawn', 1, 'Curie', 'reviewer',
      '2026-05-23T10:00:00.000Z', '2026-05-23T10:00:00.000Z'
    )
  `).run();
}

async function callSnapshot(queuePath) {
  const handler = createLocalApiHandler({ queuePath, syncEnabled: false });
  const url = new URL('http://localhost/functions/vibedeck-sessions-live-snapshot');
  const req = { method: 'GET', url: url.pathname, headers: { host: 'localhost' } };
  const chunks = [];
  const res = {
    setHeader() {},
    writeHead() {},
    write(chunk) { chunks.push(String(chunk)); },
    end(body) { if (body) chunks.push(String(body)); },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  return JSON.parse(chunks.join(''));
}

test('live snapshot exposes additive session groups in preview mode', async () => {
  const tmp = makeTracker();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'preview';
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10, state: 'ended', ended_at: '2026-05-23T10:05:00.000Z' });
    insertSession(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05, state: 'live', ended_at: null });
    insertEdge(db);
    db.close();

    const body = await callSnapshot(tmp.queuePath);
    assert.equal(body.sessions.length, 2);
    assert.equal(body.session_groups.length, 1);
    assert.equal(body.session_groups[0].member_count, 2);
    assert.equal(body.session_groups[0].active_member_count, 1);
    assert.equal(body.session_groups[0].total_tokens, 150);
    assert.equal(body.sessions.find((row) => row.session_id === 'root').group_role, 'root');
    assert.equal(body.sessions.find((row) => row.session_id === 'child').group_role, 'child');
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});

test('live snapshot hides group cards in shadow mode while keeping raw sessions', async () => {
  const tmp = makeTracker();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'shadow';
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10 });
    insertSession(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05 });
    insertEdge(db);
    db.close();

    const body = await callSnapshot(tmp.queuePath);
    assert.equal(body.sessions.length, 2);
    assert.equal(body.session_groups, undefined);
    assert.equal(body.sessions.some((row) => row.group_role), false);
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run live group tests and verify they fail**

Run:

```bash
node --test test/local-api-vibedeck-sessions-live-groups.test.js
```

Expected: FAIL because live snapshots do not include `session_groups`.

- [ ] **Step 3: Add live grouping in `local-api.js`**

In `src/lib/local-api.js`, import:

```js
const {
  groupingVisible,
  readSessionGroupingMode,
  readGroupEdges,
  buildSessionGroupsForRows,
  readSessionGroupDiagnostics,
} = require("./sessions/session-groups");
```

Inside `readLiveSessionsSnapshot(queuePath)` after sessions are enriched:

```js
  const groupingMode = readSessionGroupingMode(process.env);
  const rawSessions = Array.isArray(rollups.sessions) ? rollups.sessions.map(enrichLiveSessionCost) : [];
  const groupPayload = groupingVisible(groupingMode)
    ? buildSessionGroupsForRows(rawSessions, readGroupEdges(dbPath))
    : { sessions: rawSessions, session_groups: undefined };
```

Return:

```js
    sessions: groupPayload.sessions,
    session_groups: groupPayload.session_groups,
    session_group_diagnostics: groupingMode === 'off' ? undefined : readSessionGroupDiagnostics(dbPath),
```

Do not change live SSE event routing by raw session id.

- [ ] **Step 4: Add workstream group propagation**

If `rollups.workstreams` already contains `sessions`, map each workstream:

```js
const groupedWorkstreams = Array.isArray(rollups.workstreams)
  ? rollups.workstreams.map((workstream) => {
      if (!groupingVisible(groupingMode)) return workstream;
      const grouped = buildSessionGroupsForRows(workstream.sessions || [], readGroupEdges(dbPath));
      return { ...workstream, sessions: grouped.sessions, session_groups: grouped.session_groups };
    })
  : [];
```

Return `workstreams: groupedWorkstreams`.

- [ ] **Step 5: Run live group tests**

Run:

```bash
node --test test/local-api-vibedeck-sessions-live-groups.test.js test/local-api-vibedeck-sessions-live.test.js test/local-api-vibedeck-sessions-live-enrichment.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/local-api.js src/lib/sessions/live-rollups.js test/local-api-vibedeck-sessions-live-groups.test.js
git commit -m "feat: expose live session groups"
```

---

### Task 6: Render Branch And Live Group Cards

**Files:**
- Modify: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Modify: `dashboard/src/pages/BranchesPage.test.jsx`
- Modify: `dashboard/src/components/live/LiveSessionList.test.jsx`

- [ ] **Step 1: Add branch drawer group test**

Extend `dashboard/src/pages/BranchesPage.test.jsx` with:

```jsx
it("shows branch session groups while keeping raw sessions visible", async () => {
  getBranchUsage
    .mockResolvedValueOnce({
      totals: { total_tokens: 150, total_cost_usd: 0.15, session_count: 2 },
      repos: [{
        repo_root: "/repo",
        project_state: "git_existing",
        branches: [{
          branch: "release/0.1.3",
          total_tokens: 150,
          total_cost_usd: 0.15,
          session_count: 2,
          models: [],
          sessions: [],
        }],
      }],
    })
    .mockResolvedValueOnce({
      totals: { total_tokens: 150, total_cost_usd: 0.15, session_count: 2 },
      repos: [{
        repo_root: "/repo",
        project_state: "git_existing",
        branches: [{
          branch: "release/0.1.3",
          total_tokens: 150,
          total_cost_usd: 0.15,
          session_count: 2,
          models: [],
          session_groups: [{
            session_group_id: "codex:root",
            provider: "codex",
            member_count: 2,
            active_member_count: 0,
            total_tokens: 150,
            total_cost_usd: 0.15,
            models: [{ provider: "codex", model: "gpt-5.5", total_tokens: 150, total_cost_usd: 0.15 }],
            members: [
              { provider: "codex", session_id: "root", group_role: "root", total_tokens: 100, total_cost_usd: 0.10, agent_label: "Main session" },
              { provider: "codex", session_id: "child", group_role: "child", total_tokens: 50, total_cost_usd: 0.05, agent_label: "Curie", agent_role: "reviewer" },
            ],
          }],
          sessions: [
            { provider: "codex", session_id: "root", group_role: "root", total_tokens: 100, total_cost_usd: 0.10, model: "gpt-5.5" },
            { provider: "codex", session_id: "child", group_role: "child", total_tokens: 50, total_cost_usd: 0.05, model: "gpt-5.5", agent_label: "Curie", agent_role: "reviewer" },
          ],
        }],
      }],
    });

  render(<BranchesPage />);
  fireEvent.click(await screen.findByRole("button", { name: /view sessions/i }));

  expect(await screen.findByText("Agent group")).toBeTruthy();
  expect(screen.getByText("2 members")).toBeTruthy();
  expect(screen.getByText("Curie")).toBeTruthy();
  expect(screen.getByText("Raw sessions")).toBeTruthy();
  expect(screen.getByText("child")).toBeTruthy();
});
```

- [ ] **Step 2: Add live drawer group test**

Extend `dashboard/src/components/live/LiveSessionList.test.jsx` with a focused test that renders a workstream containing:

```js
session_groups: [{
  session_group_id: "codex:root",
  provider: "codex",
  member_count: 2,
  active_member_count: 1,
  total_tokens: 150,
  total_cost_usd: 0.15,
  models: [{ provider: "codex", model: "gpt-5.5", total_tokens: 150, total_cost_usd: 0.15 }],
  members: [
    { provider: "codex", session_id: "root", group_role: "root", total_tokens: 100, total_cost_usd: 0.10, agent_label: "Main session" },
    { provider: "codex", session_id: "child", group_role: "child", total_tokens: 50, total_cost_usd: 0.05, agent_label: "Curie", agent_role: "reviewer", state: "live" },
  ],
}]
```

Expected visible text:

```js
expect(screen.getByText("Agent group")).toBeTruthy();
expect(screen.getByText("1 active")).toBeTruthy();
expect(screen.getByText("Curie")).toBeTruthy();
expect(screen.getByText("Raw sessions")).toBeTruthy();
```

- [ ] **Step 3: Run dashboard tests and verify they fail**

Run:

```bash
npm --prefix dashboard test -- BranchesPage.test.jsx LiveSessionList.test.jsx
```

Expected: FAIL because group cards are not rendered.

- [ ] **Step 4: Implement shared local rendering helpers inside both drawers**

Add these functions to both drawer files near existing enrichment helpers:

```jsx
function groupMemberLabel(member) {
  if (member?.group_role === "root") return "Main session";
  return String(member?.agent_label || member?.agent_role || member?.session_id || "Subagent");
}

function formatMemberCount(value) {
  const count = Number(value || 0);
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return `${toDisplayNumber(safe)} member${safe === 1 ? "" : "s"}`;
}
```

Add an `AgentGroupCard` component in each file that:

- Renders the title `Agent group`.
- Shows member count.
- Shows active count for live drawer when `active_member_count > 0`.
- Shows total tokens and total cost.
- Shows up to three model rows.
- Shows up to four members with provider icon, label, role, tokens, and cost.
- Does not hide raw sessions.

- [ ] **Step 5: Render group sections**

In `BranchSessionDrawer`, before the raw session list, render:

```jsx
const sessionGroups = Array.isArray(row?.session_groups) ? row.session_groups : [];
```

```jsx
{sessionGroups.length > 0 ? (
  <section className="mb-4">
    <div className="mb-2 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
      Agent groups
    </div>
    <div className="grid gap-2">
      {sessionGroups.map((group) => <AgentGroupCard key={String(group.session_group_id)} group={group} />)}
    </div>
  </section>
) : null}
```

Add a raw-session section label above existing rows:

```jsx
{filteredSessions.length > 0 ? (
  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
    Raw sessions
  </div>
) : null}
```

In `LiveWorkstreamDrawer`, render the same `Agent groups` section before branch groups or raw sessions.

- [ ] **Step 6: Run dashboard tests**

Run:

```bash
npm --prefix dashboard test -- BranchesPage.test.jsx LiveSessionList.test.jsx
npm --prefix dashboard run build
```

Expected: PASS. Existing Vite chunk warning is acceptable.

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/components/branches/BranchSessionDrawer.jsx dashboard/src/components/live/LiveWorkstreamDrawer.jsx dashboard/src/pages/BranchesPage.test.jsx dashboard/src/components/live/LiveSessionList.test.jsx
git commit -m "feat: render Claude and Codex session groups"
```

---

### Task 7: Final Reconciliation And Machine Smoke

**Files:**
- Modify only if final audit finds a bug in files touched by Tasks 1-6.

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
node --test \
  test/db-migration-013-session-groups.test.js \
  test/session-groups.test.js \
  test/sync-session-groups.test.js \
  test/local-api-vibedeck-branch-usage-groups.test.js \
  test/local-api-vibedeck-sessions-live-groups.test.js \
  test/local-api-vibedeck-branch-usage.test.js \
  test/local-api-vibedeck-sessions-live.test.js \
  test/sync-rebuild-phase-a-richness.test.js
```

Expected: PASS.

- [ ] **Step 2: Run targeted dashboard tests**

Run:

```bash
npm --prefix dashboard test -- BranchesPage.test.jsx LiveSessionList.test.jsx
npm --prefix dashboard run build
```

Expected: PASS. Existing Vite chunk-size warning is acceptable.

- [ ] **Step 3: Run copied-live-DB API smoke**

Run a Node smoke that:

- Copies `~/.vibedeck/tracker/vibedeck.sqlite3` using `VACUUM INTO`.
- Runs `ensureSchema(copyDbPath)`.
- Calls `/functions/vibedeck-usage-summary`.
- Calls `/functions/vibedeck-branch-usage?include_unattributed=1&include_sessions=1&include_date_buckets=1` with `VIBEDECK_SESSION_GROUPING_V1=preview`.
- Calls `/functions/vibedeck-sessions-live-snapshot` with `VIBEDECK_SESSION_GROUPING_V1=preview`.
- Verifies `PRAGMA quick_check = ok`.
- Records timings.
- Deletes the temp directory.

Expected:

- `/usage` totals unchanged compared with grouping shadow mode.
- `/branches` totals unchanged compared with grouping shadow mode.
- Raw branch sessions are still present.
- Unknown and Historical unknown branch rows are still visible when present.
- `session_groups` may be empty on copied live DB until a sync/rebuild writes the projection; empty groups are acceptable for this copied-live smoke.

- [ ] **Step 4: Run isolated real-log rebuild smoke**

Use a temp `VIBEDECK_HOME` with symlinks to real provider homes so the live tracker is untouched:

```bash
tmp_root=$(mktemp -d /tmp/vd-phase15-rebuild-smoke-XXXXXX)
real_home="$HOME"
for name in .codex .claude .code .gemini .local .config .kiro .hermes .openclaw .codebuddy; do
  if [ -e "$real_home/$name" ]; then ln -s "$real_home/$name" "$tmp_root/$name"; fi
done
VIBEDECK_HOME="$tmp_root" VIBEDECK_SESSION_GROUPING_V1=shadow node bin/vibedeck.js sync --rebuild-vibedeck-db
```

After rebuild, query:

```sql
PRAGMA quick_check;
SELECT COUNT(*) FROM vibedeck_sessions;
SELECT COUNT(*) FROM vibedeck_branch_usage_facts;
SELECT COUNT(*) FROM vibedeck_session_group_edges;
SELECT COUNT(*) FROM vibedeck_session_group_skips;
SELECT COUNT(*) FROM vibedeck_branch_usage_facts WHERE branch = 'Unknown';
SELECT COUNT(*) FROM vibedeck_branch_usage_facts WHERE branch = 'Historical unknown';
```

Expected:

- Rebuild exits 0.
- Quick check is `ok`.
- Group edges are greater than 0 on this machine.
- Unknown and Historical unknown counts are not forced to zero by grouping.
- `/dashboard`, `/usage`, and `/branches` read paths return data from the temp tracker.
- Temp directory is deleted after smoke.

- [ ] **Step 5: Run full suite and classify failures**

Run:

```bash
npm test > /tmp/vd-phase15-npm-test.log 2>&1
test_exit=$?
echo "NPM_TEST_EXIT=$test_exit"
tail -n 220 /tmp/vd-phase15-npm-test.log
exit $test_exit
```

Expected:

- If full suite exits 0, record it.
- If full suite fails, compare failure list to the known baseline group from Phase 1:
  - `init-uninstall`
  - `serve-session-pipeline`
  - `sync-entire-checkpoint-backfill`
  - `sync-openclaw-trigger`
  - `sync-rebuild-vibedeck-db`
- Any new failure touching session groups, branch usage, live snapshot, pricing, dashboard branch/live drawers, Unknown, or Historical unknown is a blocker.

- [ ] **Step 6: Final git audit**

Run:

```bash
git diff --check main...HEAD
git status --short --branch
git log --oneline --decorate -10
```

Expected:

- `git diff --check` clean.
- Worktree clean.
- Commits exist for each task.

- [ ] **Step 7: Commit final audit fix if needed**

If Step 1-6 reveal a bug, fix it in the smallest touched file set and commit:

```bash
git add <changed-files>
git commit -m "fix(P1.5-audit): stabilize session grouping"
```

If no bug is found, do not create an empty commit.

---

## Self-Review

- Spec coverage:
  - Additive grouping schema: Task 1.
  - Claude path proof: Task 2.
  - Codex thread-spawn proof and canonical root resolver: Task 2.
  - Shadow/preview/on/off flag: Task 2, Task 4, Task 5.
  - Sync/rebuild projection and diagnostics: Task 3.
  - Branch read model with raw sessions preserved: Task 4.
  - Live read model with raw session routing preserved: Task 5.
  - Dashboard branch/live group cards: Task 6.
  - Totals, Unknown, Historical unknown, and smoke gates: Task 7.
- Deliberate scope adaptation:
  - Current dashboard `/usage` page has aggregate usage/model breakdowns but no raw session drilldown component. This phase exposes grouping through existing session drilldowns (`/branches` and live/dashboard workstream drawers) and verifies `/usage` totals remain unchanged. A future `/usage` session drilldown can consume the same `session_groups` payload.
- Placeholder scan:
  - No `TBD`, `TODO`, or unspecified "handle edge cases" steps remain.
- Type consistency:
  - `session_group_id`, `group_role`, `group_depth`, `agent_label`, `agent_role`, `relation_proof`, `session_groups`, and `session_group_diagnostics` are used consistently across backend and UI tasks.
