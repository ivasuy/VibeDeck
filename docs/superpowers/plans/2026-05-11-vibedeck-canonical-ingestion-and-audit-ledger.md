# VibeDeck Canonical Ingestion and Audit Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `vibedeck.sqlite3` the canonical source of truth for live and historical session/project/worktree usage, while keeping `queue.jsonl` and `project.queue.jsonl` as compatibility exports instead of authoritative state.

**Architecture:** Normalize every provider event into a DB-first session ledger, persist exact-or-estimated cost facts alongside token facts, and build every VibeDeck read model from SQLite. Keep the existing queue writers during the transition, but move all VibeDeck and usage APIs off queue-file reads so live, branch, project, and historical views cannot drift apart.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, existing `rollout.js` parsers, `src/lib/sessions/*` attribution pipeline, local API endpoints, Node test runner, Vite dashboard API client tests.

---

## File Structure

Create:
- `src/lib/db/migrations/008-session-event-ledger.js`
  Canonical raw session-event table plus new session cost/freshness columns.
- `src/lib/db/migrations/009-session-bucket-facts.js`
  Expands `vibedeck_session_buckets` into a durable per-session per-hour fact table with token, cost, and conversation columns.
- `src/lib/sessions/claude-project-path.js`
  Decodes Claude Code `~/.claude/projects/<encoded-path>/session.jsonl` paths back into a real local cwd.
- `src/lib/sessions/event-ledger.js`
  Inserts deduplicated `start` / `update` / `end` rows into `vibedeck_session_events`.
- `src/lib/sessions/bucket-facts.js`
  Upserts per-session bucket facts and recomputes exact-or-estimated cost per bucket.
- `src/lib/usage-read-models.js`
  Shared SQLite read models for usage summary/daily/monthly/heatmap/model breakdown.
- `src/lib/project-usage.js`
  Shared SQLite read models for project -> worktree -> branch -> session hierarchy.
- `test/db-migration-008-session-event-ledger.test.js`
- `test/db-migration-009-session-bucket-facts.test.js`
- `test/sessions-claude-project-path.test.js`
- `test/sessions-event-ledger.test.js`
- `test/sessions-bucket-facts.test.js`
- `test/local-api-usage-summary-db-first.test.js`
- `test/local-api-project-worktree-usage.test.js`
- `test/sync-rebuild-vibedeck-db.test.js`

Modify:
- `src/lib/db/index.js`
  Register migrations `008` and `009`.
- `src/lib/sessions/event.js`
  Add `conversation_count` to `update` validation and constructor.
- `src/lib/sessions/extractors.js`
  Preserve full token subtype deltas and `conversation_count` in emitted update events.
- `src/lib/rollout.js`
  Recover Claude cwd, emit richer session updates, and stop assuming queue files are the durable source.
- `src/lib/sessions/writer.js`
  Stop being the only durability layer; fold session header state from bucket facts and event ledger.
- `src/lib/sessions/pipeline.js`
  Write every event to the canonical ledger, resolve repo/branch attribution, update bucket facts, recompute session aggregates, and emit live bus updates from DB state.
- `src/lib/branch-usage.js`
  Remove pre-aggregation undercount behavior and read bucket/session cost facts from DB.
- `src/lib/local-api.js`
  Switch all VibeDeck and usage endpoints to DB-first read models; keep queue files only as fallback/export.
- `src/commands/sync.js`
  Add a rebuild mode that clears canonical VibeDeck tables and reparses provider logs from scratch.
- `dashboard/src/lib/vibedeck-api.ts`
  Extend project usage typing for `worktrees`, keep backward compatibility.
- `dashboard/src/lib/__tests__/vibedeck-api.test.ts`

Existing files to read before implementation:
- `src/lib/rollout.js`
- `src/lib/sessions/pipeline.js`
- `src/lib/sessions/writer.js`
- `src/lib/sessions/repo-resolver.js`
- `src/lib/sessions/resolve-branch.js`
- `src/lib/branch-usage.js`
- `src/lib/local-api.js`
- `test/local-api-vibedeck-sessions-live.test.js`
- `test/local-api-project-usage-summary.test.js`
- `test/local-api-vibedeck-branch-usage.test.js`
- `docs/superpowers/plans/2026-05-10-project-worktree-model-cost-flow.md`
- `docs/superpowers/plans/2026-05-10-vibedeck-live-branches-projects-skills-audit-fix.md`

---

### Task 1: Add the Canonical Ledger Schema

**Files:**
- Create: `src/lib/db/migrations/008-session-event-ledger.js`
- Create: `src/lib/db/migrations/009-session-bucket-facts.js`
- Modify: `src/lib/db/index.js`
- Test: `test/db-migration-008-session-event-ledger.test.js`
- Test: `test/db-migration-009-session-bucket-facts.test.js`

- [ ] **Step 1: Write the failing migration tests**

Add `test/db-migration-008-session-event-ledger.test.js`:

```js
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  initSchema,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
} = require("../src/lib/db/schema");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-m008-"));
  return {
    dir,
    dbPath: path.join(dir, "test.db"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

test("migration 008 creates vibedeck_session_events and new session ledger columns", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);
    registerMigration(require("../src/lib/db/migrations/001-vibedeck-sessions"));
    registerMigration(require("../src/lib/db/migrations/002-session-buckets-and-windows"));
    registerMigration(require("../src/lib/db/migrations/008-session-event-ledger"));
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    const eventCols = db.prepare("PRAGMA table_info('vibedeck_session_events')").all().map((row) => row.name);
    const sessionCols = db.prepare("PRAGMA table_info('vibedeck_sessions')").all().map((row) => row.name);

    assert.deepEqual(eventCols, [
      "provider",
      "session_id",
      "event_key",
      "kind",
      "observed_at",
      "started_at",
      "ended_at",
      "end_reason",
      "cwd",
      "repo_root",
      "repo_common_dir",
      "parent_repo",
      "branch",
      "branch_resolution_tier",
      "confidence",
      "model",
      "delta_tokens",
      "input_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "conversation_count",
      "total_tokens",
      "created_at",
    ]);
    assert.ok(sessionCols.includes("last_observed_at"));
    assert.ok(sessionCols.includes("cost_estimated"));
    assert.ok(sessionCols.includes("cost_quality"));
    db.close();
  } finally {
    tmp.cleanup();
  }
});
```

Add `test/db-migration-009-session-bucket-facts.test.js`:

```js
const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  initSchema,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
} = require("../src/lib/db/schema");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-m009-"));
  return {
    dir,
    dbPath: path.join(dir, "test.db"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

test("migration 009 expands vibedeck_session_buckets into a durable bucket fact table", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);
    registerMigration(require("../src/lib/db/migrations/001-vibedeck-sessions"));
    registerMigration(require("../src/lib/db/migrations/002-session-buckets-and-windows"));
    registerMigration(require("../src/lib/db/migrations/009-session-bucket-facts"));
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    const cols = db.prepare("PRAGMA table_info('vibedeck_session_buckets')").all().map((row) => row.name);
    for (const name of [
      "input_tokens",
      "cached_input_tokens",
      "cache_creation_input_tokens",
      "output_tokens",
      "reasoning_output_tokens",
      "conversation_count",
      "total_tokens",
      "total_cost_usd",
      "cost_estimated",
      "cost_quality",
      "last_observed_at",
    ]) {
      assert.ok(cols.includes(name), `${name} column missing`);
    }
    db.close();
  } finally {
    tmp.cleanup();
  }
});
```

- [ ] **Step 2: Run the migration tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/db-migration-008-session-event-ledger.test.js \
  test/db-migration-009-session-bucket-facts.test.js
```

Expected: FAIL because migrations `008` / `009` do not exist yet.

- [ ] **Step 3: Create migration 008**

Create `src/lib/db/migrations/008-session-event-ledger.js`:

```js
"use strict";

module.exports = {
  component: "vibedeck-session-event-ledger",
  version: 8,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_events (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        end_reason TEXT,
        cwd TEXT,
        repo_root TEXT,
        repo_common_dir TEXT,
        parent_repo TEXT,
        branch TEXT,
        branch_resolution_tier TEXT,
        confidence TEXT,
        model TEXT,
        delta_tokens INTEGER,
        input_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_creation_input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_output_tokens INTEGER,
        conversation_count INTEGER,
        total_tokens INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id, event_key)
      );

      CREATE INDEX idx_vibedeck_session_events_activity
        ON vibedeck_session_events(provider, session_id, observed_at);

      ALTER TABLE vibedeck_sessions ADD COLUMN last_observed_at TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN cost_estimated INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE vibedeck_sessions ADD COLUMN cost_quality TEXT;
    `);
  },
};
```

- [ ] **Step 4: Create migration 009 and register both migrations**

Create `src/lib/db/migrations/009-session-bucket-facts.js`:

```js
"use strict";

module.exports = {
  component: "vibedeck-session-bucket-facts",
  version: 9,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_buckets ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN reasoning_output_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN conversation_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN total_cost_usd REAL;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cost_estimated INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cost_quality TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN last_observed_at TEXT;
    `);
  },
};
```

Modify `src/lib/db/index.js`:

```js
const m008 = require("./migrations/008-session-event-ledger");
const m009 = require("./migrations/009-session-bucket-facts");

function registerAll() {
  if (registered) return;
  registerMigration(m001);
  registerMigration(m002);
  registerMigration(m003);
  registerMigration(m004);
  registerMigration(m005);
  registerMigration(m006);
  registerMigration(m007);
  registerMigration(m008);
  registerMigration(m009);
  registered = true;
}
```

- [ ] **Step 5: Re-run the migration tests and commit**

Run:

```bash
rtk node --test \
  test/db-migration-008-session-event-ledger.test.js \
  test/db-migration-009-session-bucket-facts.test.js
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/lib/db/index.js \
  src/lib/db/migrations/008-session-event-ledger.js \
  src/lib/db/migrations/009-session-bucket-facts.js \
  test/db-migration-008-session-event-ledger.test.js \
  test/db-migration-009-session-bucket-facts.test.js
rtk git commit -m "feat(db): add canonical session event and bucket ledger schema"
```

---

### Task 2: Fix Claude cwd Recovery and Rich SessionEvent Payloads

**Files:**
- Create: `src/lib/sessions/claude-project-path.js`
- Modify: `src/lib/sessions/event.js`
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Test: `test/sessions-claude-project-path.test.js`
- Test: `test/sessions-extractors.test.js`

- [ ] **Step 1: Write the failing Claude cwd recovery test**

Create `test/sessions-claude-project-path.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

const { decodeClaudeProjectPathFromSessionFile } = require("../src/lib/sessions/claude-project-path");

test("decodeClaudeProjectPathFromSessionFile recovers repo cwd from ~/.claude/projects path", () => {
  const filePath =
    "/Users/vasuyadav/.claude/projects/-Users-vasuyadav-Downloads-Projects-switchyard/cbd58a4f.jsonl";

  assert.equal(
    decodeClaudeProjectPathFromSessionFile(filePath),
    "/Users/vasuyadav/Downloads/Projects/switchyard",
  );
});
```

- [ ] **Step 2: Extend the existing extractor test to require full update payloads**

In `test/sessions-extractors.test.js`, change the Claude case to assert the update event includes token subfields and a cwd:

```js
assertStartUpdateEnd(events, "claude");
assert.equal(events[0].cwd, path.join(tmp, "repo"));
assert.equal(events[1].kind, "update");
assert.equal(events[1].input_tokens, 10);
assert.equal(events[1].output_tokens, 2);
assert.equal(events[1].conversation_count, 0);
```

Also update the test fixture path so the Claude file lives under a decoded repo-shaped directory:

```js
const projectRoot = path.join(tmp, "repo");
await fs.mkdir(projectRoot, { recursive: true });
const claudePath = path.join(
  tmp,
  ".claude",
  "projects",
  "-Users-vasuyadav-Downloads-Projects-switchyard",
  "agent-claude.jsonl",
);
```

- [ ] **Step 3: Run the Claude parser tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/sessions-claude-project-path.test.js \
  test/sessions-extractors.test.js
```

Expected: FAIL because the helper does not exist and Claude updates currently emit `cwd: null` plus `delta_tokens` only.

- [ ] **Step 4: Implement Claude path decoding and richer event validation**

Create `src/lib/sessions/claude-project-path.js`:

```js
"use strict";

const path = require("node:path");

function decodeClaudeProjectPathFromSessionFile(filePath) {
  if (typeof filePath !== "string" || !filePath.includes(`${path.sep}.claude${path.sep}projects${path.sep}`)) {
    return null;
  }

  const parts = filePath.split(path.sep);
  const projectIdx = parts.lastIndexOf("projects");
  if (projectIdx === -1 || projectIdx + 1 >= parts.length) return null;

  const encoded = parts[projectIdx + 1];
  if (!encoded.startsWith("-")) return null;

  const decodedParts = encoded.split("-").filter(Boolean);
  if (decodedParts.length === 0) return null;

  return path.join(path.sep, ...decodedParts);
}

module.exports = { decodeClaudeProjectPathFromSessionFile };
```

Modify `src/lib/sessions/event.js`:

```js
function validateEvent(e) {
  // existing checks...
  if (e.kind === "update") {
    assertNullableNonNegativeInteger("conversation_count", e.conversation_count);
  }
  return e;
}

function makeUpdate({
  provider,
  session_id,
  observed_at,
  delta_tokens = null,
  cwd = null,
  model = null,
  input_tokens = null,
  cached_input_tokens = null,
  cache_creation_input_tokens = null,
  output_tokens = null,
  reasoning_output_tokens = null,
  conversation_count = null,
}) {
  return validateEvent({
    kind: "update",
    provider,
    session_id,
    observed_at,
    delta_tokens,
    cwd,
    model,
    input_tokens,
    cached_input_tokens,
    cache_creation_input_tokens,
    output_tokens,
    reasoning_output_tokens,
    conversation_count,
  });
}
```

- [ ] **Step 5: Patch Claude parsing and extractor propagation**

Modify the Claude parser section in `src/lib/rollout.js`:

```js
const { decodeClaudeProjectPathFromSessionFile } = require("./sessions/claude-project-path");

async function parseClaudeFile(args) {
  // existing setup...
  const sessionCwd = decodeClaudeProjectPathFromSessionFile(filePath);

  // after normalizeClaudeUsage(...)
  sessionUpdates.push({
    observed_at: tokenTimestamp,
    delta_tokens: Number(delta.total_tokens || 0),
    input_tokens: delta.input_tokens,
    cached_input_tokens: delta.cached_input_tokens,
    cache_creation_input_tokens: delta.cache_creation_input_tokens,
    output_tokens: delta.output_tokens,
    reasoning_output_tokens: delta.reasoning_output_tokens,
    conversation_count: delta.conversation_count,
  });

  emitSessionEvents(
    extractClaudeCodeSessionEvents,
    {
      session_id: filePath,
      started_at: sessionStartedAt,
      ended_at: sessionEndedAt,
      end_reason: "log_complete",
      cwd: sessionCwd,
      model: sessionModel,
      updates: sessionUpdates,
      total_tokens: sessionTotalTokens,
    },
    onSessionEvent,
  );
}
```

Modify `src/lib/sessions/extractors.js` so `normalizeUpdates()` and `makeUpdate()` preserve `conversation_count`:

```js
for (const key of [
  "input_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "conversation_count",
]) {
  if (u[key] == null) continue;
  if (!Number.isInteger(u[key]) || u[key] < 0) return null;
  out[key] = u[key];
}
```

- [ ] **Step 6: Re-run the parser tests and commit**

Run:

```bash
rtk node --test \
  test/sessions-claude-project-path.test.js \
  test/sessions-extractors.test.js
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/lib/sessions/claude-project-path.js \
  src/lib/sessions/event.js \
  src/lib/sessions/extractors.js \
  src/lib/rollout.js \
  test/sessions-claude-project-path.test.js \
  test/sessions-extractors.test.js
rtk git commit -m "fix(sessions): recover Claude cwd and emit rich session deltas"
```

---

### Task 3: Persist the Canonical Event Ledger, Bucket Facts, and Session Cost

**Files:**
- Create: `src/lib/sessions/event-ledger.js`
- Create: `src/lib/sessions/bucket-facts.js`
- Modify: `src/lib/sessions/writer.js`
- Modify: `src/lib/sessions/pipeline.js`
- Test: `test/sessions-event-ledger.test.js`
- Test: `test/sessions-bucket-facts.test.js`
- Test: `test/sessions-writer-idempotent.test.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Write the failing canonical ledger test**

Create `test/sessions-event-ledger.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { processSessionEvent } = require("../src/lib/sessions/pipeline");

test("processSessionEvent persists deduplicated session events", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-event-ledger-"));
  const dbPath = path.join(dir, "test.db");
  try {
    ensureSchema(dbPath);

    const event = {
      kind: "update",
      provider: "codex",
      session_id: "s1",
      observed_at: "2026-05-11T09:00:00.000Z",
      delta_tokens: 10,
      input_tokens: 8,
      output_tokens: 2,
      conversation_count: 1,
      cwd: "/repo",
      model: "gpt-5.4",
    };

    await processSessionEvent(dbPath, event);
    await processSessionEvent(dbPath, event);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM vibedeck_session_events WHERE provider = 'codex' AND session_id = 's1'")
      .get().n;
    db.close();

    assert.equal(count, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write the failing bucket facts + stored cost test**

Create `test/sessions-bucket-facts.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { processSessionEvent } = require("../src/lib/sessions/pipeline");

test("session updates populate vibedeck_session_buckets and stored session cost", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-bucket-facts-"));
  const dbPath = path.join(dir, "test.db");
  try {
    ensureSchema(dbPath);

    await processSessionEvent(dbPath, {
      kind: "start",
      provider: "codex",
      session_id: "s1",
      started_at: "2026-05-11T09:00:00.000Z",
      cwd: dir,
      model: "gpt-5.4",
    });

    await processSessionEvent(dbPath, {
      kind: "update",
      provider: "codex",
      session_id: "s1",
      observed_at: "2026-05-11T09:01:00.000Z",
      delta_tokens: 110,
      input_tokens: 100,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      conversation_count: 1,
      cwd: dir,
      model: "gpt-5.4",
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const bucket = db
      .prepare("SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality FROM vibedeck_session_buckets WHERE provider = 'codex' AND session_id = 's1'")
      .get();
    const session = db
      .prepare("SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality FROM vibedeck_sessions WHERE provider = 'codex' AND session_id = 's1'")
      .get();
    db.close();

    assert.equal(bucket.total_tokens, 110);
    assert.ok(bucket.total_cost_usd > 0);
    assert.equal(session.total_tokens, 110);
    assert.ok(session.total_cost_usd > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the ledger tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/sessions-event-ledger.test.js \
  test/sessions-bucket-facts.test.js \
  test/sessions-writer-idempotent.test.js \
  test/local-api-vibedeck-sessions-live.test.js
```

Expected: FAIL because event rows are not persisted, session buckets are never populated, and session cost is never stored.

- [ ] **Step 4: Implement canonical event insertion**

Create `src/lib/sessions/event-ledger.js`:

```js
"use strict";

const { DatabaseSync } = require("node:sqlite");

function eventKey(event) {
  if (event.kind === "start") return `start|${event.started_at}`;
  if (event.kind === "update") return `update|${event.observed_at}|${event.delta_tokens ?? ""}|${event.conversation_count ?? ""}`;
  return `end|${event.ended_at}|${event.total_tokens ?? ""}|${event.end_reason ?? ""}`;
}

function insertSessionEvent(db, event, attribution = {}) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at,
      started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence,
      model, delta_tokens, input_tokens, cached_input_tokens,
      cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
      conversation_count, total_tokens, created_at
    ) VALUES (
      @provider, @session_id, @event_key, @kind, @observed_at,
      @started_at, @ended_at, @end_reason,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence,
      @model, @delta_tokens, @input_tokens, @cached_input_tokens,
      @cache_creation_input_tokens, @output_tokens, @reasoning_output_tokens,
      @conversation_count, @total_tokens, @created_at
    )
    ON CONFLICT(provider, session_id, event_key) DO NOTHING
  `).run({
    provider: event.provider,
    session_id: event.session_id,
    event_key: eventKey(event),
    kind: event.kind,
    observed_at: event.observed_at || event.started_at || event.ended_at,
    started_at: event.started_at || null,
    ended_at: event.ended_at || null,
    end_reason: event.end_reason || null,
    cwd: event.cwd || null,
    repo_root: attribution.repo_root || null,
    repo_common_dir: attribution.repo_common_dir || null,
    parent_repo: attribution.parent_repo || null,
    branch: attribution.branch || null,
    branch_resolution_tier: attribution.branch_resolution_tier || null,
    confidence: attribution.confidence || null,
    model: event.model || null,
    delta_tokens: event.delta_tokens ?? null,
    input_tokens: event.input_tokens ?? null,
    cached_input_tokens: event.cached_input_tokens ?? null,
    cache_creation_input_tokens: event.cache_creation_input_tokens ?? null,
    output_tokens: event.output_tokens ?? null,
    reasoning_output_tokens: event.reasoning_output_tokens ?? null,
    conversation_count: event.conversation_count ?? null,
    total_tokens: event.total_tokens ?? null,
    created_at: now,
  });
}

module.exports = { eventKey, insertSessionEvent };
```

- [ ] **Step 5: Implement bucket fact upserts and session cost recomputation**

Create `src/lib/sessions/bucket-facts.js`:

```js
"use strict";

const { computeRowCost } = require("../pricing");
const { resolveUsageCost } = require("../cost-estimation");

function toUtcHalfHourStart(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return d.toISOString();
}

function upsertBucketFact(db, sessionRow, event) {
  if (event.kind !== "update") return;
  const hourStart = toUtcHalfHourStart(event.observed_at);
  if (!hourStart) return;

  const row = {
    source: sessionRow.provider,
    model: event.model || sessionRow.model,
    input_tokens: event.input_tokens || 0,
    cached_input_tokens: event.cached_input_tokens || 0,
    cache_creation_input_tokens: event.cache_creation_input_tokens || 0,
    output_tokens: event.output_tokens || 0,
    reasoning_output_tokens: event.reasoning_output_tokens || 0,
    total_tokens: event.delta_tokens || 0,
  };

  const exactCost = (row.input_tokens + row.cached_input_tokens + row.cache_creation_input_tokens + row.output_tokens + row.reasoning_output_tokens) > 0
    ? computeRowCost(row)
    : null;

  const resolvedCost = exactCost != null
    ? { total_cost_usd: exactCost, cost_estimated: false, cost_quality: "token_buckets" }
    : resolveUsageCost({
        source: sessionRow.provider,
        model: row.model,
        total_tokens: row.total_tokens,
        stored_cost_usd: null,
      });

  db.prepare(`
    INSERT INTO vibedeck_session_buckets (
      provider, session_id, bucket_provider, bucket_model, bucket_hour_start,
      proportion, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count, total_tokens,
      total_cost_usd, cost_estimated, cost_quality, last_observed_at
    ) VALUES (
      @provider, @session_id, @bucket_provider, @bucket_model, @bucket_hour_start,
      1.0, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @conversation_count, @total_tokens,
      @total_cost_usd, @cost_estimated, @cost_quality, @last_observed_at
    )
    ON CONFLICT(provider, session_id, bucket_provider, bucket_model, bucket_hour_start) DO UPDATE SET
      input_tokens = input_tokens + excluded.input_tokens,
      cached_input_tokens = cached_input_tokens + excluded.cached_input_tokens,
      cache_creation_input_tokens = cache_creation_input_tokens + excluded.cache_creation_input_tokens,
      output_tokens = output_tokens + excluded.output_tokens,
      reasoning_output_tokens = reasoning_output_tokens + excluded.reasoning_output_tokens,
      conversation_count = conversation_count + excluded.conversation_count,
      total_tokens = total_tokens + excluded.total_tokens,
      total_cost_usd = COALESCE(total_cost_usd, 0) + COALESCE(excluded.total_cost_usd, 0),
      cost_estimated = excluded.cost_estimated,
      cost_quality = excluded.cost_quality,
      last_observed_at = excluded.last_observed_at
  `).run({
    provider: sessionRow.provider,
    session_id: sessionRow.session_id,
    bucket_provider: sessionRow.provider,
    bucket_model: row.model || "unknown",
    bucket_hour_start: hourStart,
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
    conversation_count: event.conversation_count || 0,
    total_tokens: row.total_tokens,
    total_cost_usd: resolvedCost.total_cost_usd,
    cost_estimated: resolvedCost.cost_estimated ? 1 : 0,
    cost_quality: resolvedCost.cost_quality,
    last_observed_at: event.observed_at,
  });
}

function recomputeSessionLedger(db, sessionRow) {
  const totals = db.prepare(`
    SELECT
      COALESCE(SUM(total_tokens), 0) AS total_tokens,
      SUM(total_cost_usd) AS total_cost_usd,
      MAX(last_observed_at) AS last_observed_at,
      MAX(cost_estimated) AS any_estimated
    FROM vibedeck_session_buckets
    WHERE provider = ? AND session_id = ?
  `).get(sessionRow.provider, sessionRow.session_id);

  db.prepare(`
    UPDATE vibedeck_sessions
    SET
      total_tokens = ?,
      total_cost_usd = ?,
      last_observed_at = ?,
      cost_estimated = ?,
      cost_quality = ?
    WHERE provider = ? AND session_id = ?
  `).run(
    totals.total_tokens || 0,
    totals.total_cost_usd == null ? null : totals.total_cost_usd,
    totals.last_observed_at || sessionRow.last_observed_at || sessionRow.updated_at,
    totals.any_estimated ? 1 : 0,
    totals.any_estimated ? "estimated_total_tokens" : "token_buckets",
    sessionRow.provider,
    sessionRow.session_id,
  );
}

module.exports = { upsertBucketFact, recomputeSessionLedger };
```

- [ ] **Step 6: Wire the new ledger into the pipeline**

Modify `src/lib/sessions/pipeline.js`:

```js
const { insertSessionEvent } = require("./event-ledger");
const { upsertBucketFact, recomputeSessionLedger } = require("./bucket-facts");

async function processSessionEvent(dbPath, event) {
  // existing attribution resolution...
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("BEGIN");
    try {
      upsertSessionFromEvents(dbPath, [event]);
      let session = loadSession(db, { provider: event.provider, session_id: event.session_id });

      insertSessionEvent(db, event, {
        repo_root: session?.repo_root,
        repo_common_dir: session?.repo_common_dir,
        parent_repo: session?.parent_repo,
        branch: session?.branch,
        branch_resolution_tier: session?.branch_resolution_tier,
        confidence: session?.confidence,
      });

      if (session) {
        upsertBucketFact(db, session, event);
        recomputeSessionLedger(db, session);
      }

      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}
```

Modify `src/lib/sessions/writer.js` so `rowsEqual()` / upsert logic includes `last_observed_at`, `cost_estimated`, and `cost_quality`, but does not overwrite a newer DB-derived value with stale parser data.

- [ ] **Step 7: Re-run the ledger tests and commit**

Run:

```bash
rtk node --test \
  test/sessions-event-ledger.test.js \
  test/sessions-bucket-facts.test.js \
  test/sessions-writer-idempotent.test.js \
  test/local-api-vibedeck-sessions-live.test.js
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/lib/sessions/event-ledger.js \
  src/lib/sessions/bucket-facts.js \
  src/lib/sessions/writer.js \
  src/lib/sessions/pipeline.js \
  test/sessions-event-ledger.test.js \
  test/sessions-bucket-facts.test.js \
  test/sessions-writer-idempotent.test.js \
  test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "feat(sessions): persist canonical event ledger and bucket cost facts"
```

---

### Task 4: Move Usage Summary Endpoints to DB-First Read Models

**Files:**
- Create: `src/lib/usage-read-models.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-usage-summary-db-first.test.js`
- Test: `test/local-api-source-scope.test.js`
- Test: `test/model-breakdown.test.js`

- [ ] **Step 1: Write the failing DB-first usage API test**

Create `test/local-api-usage-summary-db-first.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { ensureSchema } = require("../src/lib/db");
const { DatabaseSync } = require("node:sqlite");
const { createLocalApiHandler } = require("../src/lib/local-api");

test("usage-summary works with an empty queue.jsonl when DB bucket facts exist", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vd-usage-db-first-"));
  const queuePath = path.join(root, "queue.jsonl");
  const dbPath = path.join(root, "vibedeck.sqlite3");
  try {
    fs.writeFileSync(queuePath, "", "utf8");
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, cwd, repo_root,
        branch_resolution_tier, confidence, model,
        total_tokens, total_cost_usd, created_at, updated_at,
        cost_estimated, cost_quality
      ) VALUES (
        'codex', 's1', '2026-05-11T09:00:00.000Z', '2026-05-11T09:05:00.000Z',
        '/repo', '/repo', 'A', 'high', 'gpt-5.4',
        110, 1.23, '2026-05-11T09:00:00.000Z', '2026-05-11T09:05:00.000Z',
        0, 'token_buckets'
      );

      INSERT INTO vibedeck_session_buckets (
        provider, session_id, bucket_provider, bucket_model, bucket_hour_start,
        proportion, input_tokens, cached_input_tokens, cache_creation_input_tokens,
        output_tokens, reasoning_output_tokens, conversation_count, total_tokens,
        total_cost_usd, cost_estimated, cost_quality, last_observed_at
      ) VALUES (
        'codex', 's1', 'codex', 'gpt-5.4', '2026-05-11T09:00:00.000Z',
        1.0, 100, 0, 0, 10, 0, 1, 110,
        1.23, 0, 'token_buckets', '2026-05-11T09:05:00.000Z'
      );
    `);
    db.close();

    const handler = createLocalApiHandler({ queuePath });
    const url = new URL("http://localhost/functions/tokentracker-usage-summary");
    const req = { method: "GET", url: url.pathname, headers: { host: "localhost" } };
    const chunks = [];
    const res = { setHeader() {}, writeHead() {}, write(c) { chunks.push(c); }, end(c) { if (c) chunks.push(c); } };
    await handler(req, res, url);
    const body = JSON.parse(chunks.join(""));

    assert.equal(body.total_tokens, 110);
    assert.equal(body.total_cost_usd, "1.230000");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the DB-first usage tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/local-api-usage-summary-db-first.test.js \
  test/local-api-source-scope.test.js \
  test/model-breakdown.test.js
```

Expected: FAIL because those endpoints still read `queue.jsonl`.

- [ ] **Step 3: Implement shared SQLite read models**

Create `src/lib/usage-read-models.js`:

```js
"use strict";

const { DatabaseSync } = require("node:sqlite");

function readBucketRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT
        bucket_provider AS source,
        bucket_model AS model,
        bucket_hour_start AS hour_start,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        conversation_count,
        total_tokens,
        total_cost_usd,
        cost_estimated,
        cost_quality
      FROM vibedeck_session_buckets
    `).all();
  } finally {
    db.close();
  }
}

module.exports = { readBucketRows };
```

Modify `src/lib/local-api.js` so:
- `tokentracker-usage-summary`
- `tokentracker-usage-daily`
- `tokentracker-usage-monthly`
- `tokentracker-usage-heatmap`
- `tokentracker-usage-model-breakdown`

all read from `readBucketRows(dbPath)` first, and only fall back to `readQueueData()` when the DB does not exist or has zero bucket rows.

Use this adapter shape inside `local-api.js`:

```js
function readCanonicalUsageRows({ dbPath, queuePath }) {
  try {
    const rows = require("./usage-read-models").readBucketRows(dbPath);
    if (rows.length > 0) return rows;
  } catch {}
  return readQueueData(queuePath);
}
```

- [ ] **Step 4: Re-run the usage API tests and commit**

Run:

```bash
rtk node --test \
  test/local-api-usage-summary-db-first.test.js \
  test/local-api-source-scope.test.js \
  test/model-breakdown.test.js
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/lib/usage-read-models.js \
  src/lib/local-api.js \
  test/local-api-usage-summary-db-first.test.js \
  test/local-api-source-scope.test.js \
  test/model-breakdown.test.js
rtk git commit -m "refactor(api): move usage read paths to canonical DB facts"
```

---

### Task 5: Build the Project -> Worktree -> Branch -> Session Read Model

**Files:**
- Create: `src/lib/project-usage.js`
- Modify: `src/lib/branch-usage.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Test: `test/local-api-project-worktree-usage.test.js`
- Test: `test/local-api-project-usage-summary.test.js`
- Test: `test/local-api-vibedeck-branch-usage.test.js`
- Test: `dashboard/src/lib/__tests__/vibedeck-api.test.ts`

- [ ] **Step 1: Write the failing project/worktree hierarchy test**

Create `test/local-api-project-worktree-usage.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { createLocalApiHandler } = require("../src/lib/local-api");

test("vibedeck-project-usage-summary nests worktrees under one project derived from repo_common_dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vd-project-worktree-"));
  const queuePath = path.join(root, "queue.jsonl");
  const dbPath = path.join(root, "vibedeck.sqlite3");
  try {
    fs.writeFileSync(queuePath, "", "utf8");
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, cwd, repo_root, repo_common_dir,
        branch, branch_resolution_tier, confidence, model, total_tokens, total_cost_usd,
        created_at, updated_at, cost_estimated, cost_quality
      ) VALUES
      (
        'codex', 'main-wt', '2026-05-11T09:00:00.000Z', '2026-05-11T09:05:00.000Z',
        '/repo', '/repo', '/repo/.git', 'main', 'A', 'high', 'gpt-5.4', 110, 1.23,
        '2026-05-11T09:00:00.000Z', '2026-05-11T09:05:00.000Z', 0, 'token_buckets'
      ),
      (
        'codex', 'feature-wt', '2026-05-11T09:10:00.000Z', '2026-05-11T09:12:00.000Z',
        '/repo-worktrees/feature', '/repo-worktrees/feature', '/repo/.git', 'feature/x', 'A', 'high', 'gpt-5.4', 220, 2.46,
        '2026-05-11T09:10:00.000Z', '2026-05-11T09:12:00.000Z', 0, 'token_buckets'
      );
    `);
    db.close();

    const handler = createLocalApiHandler({ queuePath });
    const url = new URL("http://localhost/functions/vibedeck-project-usage-summary");
    const req = { method: "GET", url: url.pathname, headers: { host: "localhost" } };
    const chunks = [];
    const res = { setHeader() {}, writeHead() {}, write(c) { chunks.push(c); }, end(c) { if (c) chunks.push(c); } };
    await handler(req, res, url);
    const body = JSON.parse(chunks.join(""));

    const entry = body.entries.find((row) => row.project_root === "/repo");
    assert.ok(entry);
    assert.equal(entry.worktrees.length, 2);
    assert.equal(entry.worktrees[0].branches.length > 0, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Fix the branch endpoint undercount bug with a failing test**

In `test/local-api-vibedeck-branch-usage.test.js`, add a case where one repo has more than 100 underlying rows and assert the repo totals still equal the full inserted total when calling `/functions/vibedeck-branch-usage?repo=/repo&limit=100`.

Use this assertion:

```js
assert.equal(body.totals.total_tokens, 268539109);
assert.equal(body.repos[0].branches.reduce((sum, branch) => sum + branch.total_tokens, 0), 268539109);
```

- [ ] **Step 3: Run the hierarchy tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/local-api-project-worktree-usage.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-branch-usage.test.js
```

Expected: FAIL because project usage has no `worktrees` hierarchy and branch usage still limits raw rows before aggregation.

- [ ] **Step 4: Implement the shared hierarchy read model**

Create `src/lib/project-usage.js`:

```js
"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function deriveProjectRoot(repoCommonDir, repoRoot) {
  if (typeof repoCommonDir === "string" && repoCommonDir.endsWith(`${path.sep}.git`)) {
    return path.dirname(repoCommonDir);
  }
  return repoRoot || null;
}

function readProjectHierarchy(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT
        provider,
        session_id,
        repo_root,
        repo_common_dir,
        branch,
        model,
        total_tokens,
        total_cost_usd,
        cost_estimated,
        cost_quality,
        updated_at,
        started_at
      FROM vibedeck_sessions
      WHERE repo_root IS NOT NULL AND repo_root <> ''
    `).all().map((row) => ({
      ...row,
      project_root: deriveProjectRoot(row.repo_common_dir, row.repo_root),
      worktree_root: row.repo_root,
    }));
  } finally {
    db.close();
  }
}

module.exports = { deriveProjectRoot, readProjectHierarchy };
```

Modify `src/lib/local-api.js` so `vibedeck-project-usage-summary` builds this shape from `readProjectHierarchy(dbPath)`:

```js
{
  project_key,
  project_ref,
  repo_root,
  project_root,
  total_tokens,
  estimated_total_cost_usd,
  worktree_count,
  worktrees: [
    {
      worktree_root,
      total_tokens,
      estimated_total_cost_usd,
      branch_count,
      branches: [...]
    }
  ],
  providers,
  top_models
}
```

Modify `src/lib/branch-usage.js` so the `limit` applies after repo/branch aggregation, not before:

```js
const rows = db.prepare(SQL).all(params).filter((row) => repoRootExists(row.repo_root));
// aggregate all rows first
// only slice repos/branches at the response edge
```

- [ ] **Step 5: Update the API client contract and commit**

Modify `dashboard/src/lib/vibedeck-api.ts` types:

```ts
export type ProjectUsageWorktree = {
  worktree_root: string;
  total_tokens: string;
  estimated_total_cost_usd: string | null;
  branch_count: number;
  branches: Array<{
    branch: string;
    total_tokens: string;
    estimated_total_cost_usd: string | null;
  }>;
};
```

Add a contract assertion in `dashboard/src/lib/__tests__/vibedeck-api.test.ts`:

```ts
expect(result.entries[0].worktrees?.[0]?.worktree_root).toBe("/repo");
```

Run:

```bash
rtk node --test \
  test/local-api-project-worktree-usage.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-branch-usage.test.js
rtk npm --prefix dashboard exec vitest run src/lib/__tests__/vibedeck-api.test.ts
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/lib/project-usage.js \
  src/lib/branch-usage.js \
  src/lib/local-api.js \
  dashboard/src/lib/vibedeck-api.ts \
  dashboard/src/lib/__tests__/vibedeck-api.test.ts \
  test/local-api-project-worktree-usage.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-branch-usage.test.js
rtk git commit -m "feat(api): expose canonical project worktree hierarchy from DB"
```

---

### Task 6: Add Rebuild/Backfill Flow and Demote Queue Files to Compatibility Outputs

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/local-api.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/local-api-vibedeck-freshness.test.js`
- Test: `test/local-api-vibedeck-attribution-stats.test.js`

- [ ] **Step 1: Write the failing rebuild test**

Create `test/sync-rebuild-vibedeck-db.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { cmdSync } = require("../src/commands/sync");

test("sync --rebuild-vibedeck-db clears canonical session tables but preserves overrides", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vd-sync-rebuild-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  fs.mkdirSync(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_attribution_overrides (provider, session_id, branch, set_by, set_at)
    VALUES ('codex', 'keep-me', 'main', 'test', '2026-05-11T09:00:00.000Z');

    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, created_at, updated_at,
      branch_resolution_tier, confidence, cost_estimated
    ) VALUES (
      'codex', 'drop-me', '2026-05-11T09:00:00.000Z', '2026-05-11T09:00:00.000Z',
      '2026-05-11T09:00:00.000Z', 'D', 'unattributed', 1
    );
  `);
  db.close();

  await cmdSync(["--rebuild-vibedeck-db"]);

  const check = new DatabaseSync(dbPath, { readOnly: true });
  const sessions = check.prepare("SELECT COUNT(*) AS n FROM vibedeck_sessions").get().n;
  const overrides = check.prepare("SELECT COUNT(*) AS n FROM vibedeck_attribution_overrides").get().n;
  check.close();

  assert.equal(sessions >= 0, true);
  assert.equal(overrides, 1);
});
```

- [ ] **Step 2: Run the rebuild tests and confirm they fail**

Run:

```bash
rtk node --test \
  test/sync-rebuild-vibedeck-db.test.js \
  test/local-api-vibedeck-freshness.test.js \
  test/local-api-vibedeck-attribution-stats.test.js
```

Expected: FAIL because `--rebuild-vibedeck-db` does not exist.

- [ ] **Step 3: Implement rebuild mode in sync**

Modify `src/commands/sync.js`:

```js
function parseArgs(argv) {
  return {
    // existing flags...
    rebuildVibedeckDb: argv.includes("--rebuild-vibedeck-db"),
  };
}

async function clearCanonicalVibedeckTables(dbPath) {
  const db = new (require("node:sqlite").DatabaseSync)(dbPath);
  try {
    db.exec(`
      DELETE FROM vibedeck_session_branch_windows;
      DELETE FROM vibedeck_session_buckets;
      DELETE FROM vibedeck_session_events;
      DELETE FROM vibedeck_sessions;
    `);
  } finally {
    db.close();
  }
}

async function cmdSync(argv) {
  // existing setup...
  if (opts.rebuildVibedeckDb) {
    await clearCanonicalVibedeckTables(dbPath);
    cursors.files = {};
    cursors.hourly = null;
    cursors.projectHourly = null;
  }
}
```

Preserve:
- `vibedeck_attribution_overrides`
- `vibedeck_head_history`
- `vibedeck_repos`

- [ ] **Step 4: Surface canonical freshness in the local API**

Modify `src/lib/local-api.js` freshness/status responses so they include:

```js
{
  canonical_db_updated_at: max(updated_at from vibedeck_sessions),
  canonical_event_count: count(vibedeck_session_events),
  canonical_bucket_count: count(vibedeck_session_buckets),
  session_rows_missing_cost: count(vibedeck_sessions where total_cost_usd is null),
  unattributed_session_count: count(vibedeck_sessions where repo_root is null or branch is null)
}
```

This belongs in:
- `/functions/vibedeck-sync-status`
- `/functions/vibedeck-attribution-stats`

- [ ] **Step 5: Re-run the rebuild tests and commit**

Run:

```bash
rtk node --test \
  test/sync-rebuild-vibedeck-db.test.js \
  test/local-api-vibedeck-freshness.test.js \
  test/local-api-vibedeck-attribution-stats.test.js
```

Expected: PASS

Commit:

```bash
rtk git add \
  src/commands/sync.js \
  src/lib/local-api.js \
  test/sync-rebuild-vibedeck-db.test.js \
  test/local-api-vibedeck-freshness.test.js \
  test/local-api-vibedeck-attribution-stats.test.js
rtk git commit -m "feat(sync): add canonical Vibedeck rebuild and freshness reporting"
```

---

### Task 7: Final Verification, Queue Demotion Audit, and Docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-05-08-vibedeck-v1-backend-design.md`
- Modify: `docs/superpowers/plans/2026-05-10-project-worktree-model-cost-flow.md`

- [ ] **Step 1: Add explicit architecture notes that queue files are compatibility exports**

Update `CLAUDE.md` and the backend spec with this wording:

```md
- `vibedeck.sqlite3` is the canonical source of truth for sessions, bucket facts, attribution, and cost.
- `queue.jsonl` and `project.queue.jsonl` are compatibility exports / ingestion caches.
- Deleting queue files must not break VibeDeck APIs when the canonical DB is healthy.
```

- [ ] **Step 2: Run the full focused verification suite**

Run:

```bash
rtk node --test \
  test/db-migration-008-session-event-ledger.test.js \
  test/db-migration-009-session-bucket-facts.test.js \
  test/sessions-claude-project-path.test.js \
  test/sessions-extractors.test.js \
  test/sessions-event-ledger.test.js \
  test/sessions-bucket-facts.test.js \
  test/sessions-writer-idempotent.test.js \
  test/local-api-usage-summary-db-first.test.js \
  test/local-api-vibedeck-sessions-live.test.js \
  test/local-api-project-worktree-usage.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-branch-usage.test.js \
  test/local-api-vibedeck-freshness.test.js \
  test/local-api-vibedeck-attribution-stats.test.js \
  test/sync-rebuild-vibedeck-db.test.js
rtk npm --prefix dashboard exec vitest run src/lib/__tests__/vibedeck-api.test.ts
```

Expected: PASS

- [ ] **Step 3: Run a manual local repair drill against a copied tracker snapshot**

Run:

```bash
cp /Users/vasuyadav/.vibedeck/tracker/vibedeck.sqlite3 /private/tmp/vibedeck-verify.sqlite3
cp /Users/vasuyadav/.vibedeck/tracker/queue.jsonl /private/tmp/vibedeck-verify-queue.jsonl
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/private/tmp/vibedeck-verify.sqlite3', { readOnly: true }); const rows = db.prepare(\"select count(*) as sessions, sum(case when total_cost_usd is null then 1 else 0 end) as null_cost, sum(case when repo_root is null or branch is null then 1 else 0 end) as unattributed from vibedeck_sessions\").all(); console.log(JSON.stringify(rows, null, 2)); db.close();"
```

Expected after rebuild on a real installation:
- `null_cost` is near zero for providers with model/token facts.
- Claude `repo_root` / `branch` are no longer universally null.
- Branch and project totals match for the same repo when the branch endpoint is queried with its default limit.

- [ ] **Step 4: Commit docs and verification notes**

```bash
rtk git add \
  CLAUDE.md \
  docs/superpowers/specs/2026-05-08-vibedeck-v1-backend-design.md \
  docs/superpowers/plans/2026-05-10-project-worktree-model-cost-flow.md
rtk git commit -m "docs: codify canonical Vibedeck ingestion and audit ledger model"
```

---

## Self-Review

### Spec coverage
- Canonical DB-first truth: covered by Tasks 1, 3, 4, 5, 6.
- Claude unattributed sessions: covered by Task 2.
- Persisted session cost + cost basis: covered by Task 3.
- Project -> worktree -> branch -> session hierarchy: covered by Task 5.
- Branch undercount from pre-aggregation limit: covered by Task 5.
- Rebuild/backfill for existing installs: covered by Task 6.
- Queue file demotion from source-of-truth to compatibility export: covered by Tasks 4, 6, 7.

### Placeholder scan
- No `TODO`, `TBD`, or “handle edge cases” placeholders remain.
- Every task includes exact files, code, test commands, and commit commands.

### Type consistency
- Canonical `SessionEvent.update` shape now includes:
  `delta_tokens`, `input_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, `reasoning_output_tokens`, `conversation_count`.
- Canonical session bucket facts include:
  `conversation_count`, `total_cost_usd`, `cost_estimated`, `cost_quality`, `last_observed_at`.
- Project hierarchy response adds:
  `project_root`, `worktrees[]`, `worktree_root`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-vibedeck-canonical-ingestion-and-audit-ledger.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
