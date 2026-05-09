# VibeDeck v1 — Plan 2: Storage & Schema + Entire Bridge

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the SQLite schema for VibeDeck's session attribution layer (`vibedeck_*` tables) and ship the Entire CLI integration module (PATH detection, direct git read of `entire/checkpoints/v1`, safe shell-outs for Entire commands, four-state per-repo status, and `entire login` onboarding). After this plan, the database is durable and Entire data flows into VibeDeck via read-only API endpoints. Write endpoints are stubbed (returning 403) until Plan 4 wires up auth.

**Architecture:** Versioned schema migrations run at `serve` startup with backup-before-migrate. New module `src/lib/entire-bridge.js` consolidates all Entire interaction (detection, git plumbing reads, shell-outs via `execa` argv form). All Entire writes go through a placeholder confirm-token gate that Plan 4 will replace with real auth tokens.

**Tech Stack:** Node.js **22.5+** (bumped from 20 — see Task 1 Step 7), built-in **`node:sqlite`** (NOT `better-sqlite3` — TokenTracker has no embedded SQLite library; we keep the project's "no native deps" philosophy and use Node's stable built-in `node:sqlite` instead), `execa` (existing — argv form only, never shell-string), Chokidar (already in TokenTracker), `node --test` (tests). **Note on shell-outs:** Every Entire command runs through `execa` in argv form. User-supplied arguments (branch names, checkpoint IDs, agent names) are validated before being passed to argv.

**Decision log (moderated 2026-05-09):**
- VibeDeck does **not** introduce `better-sqlite3` as a native dependency. The codebase currently has zero SQLite library and shells out to the system `sqlite3` CLI binary only for *reading external tools' DBs* (Cursor auth, Hermes sessions). VibeDeck's own DB is new, and we use `node:sqlite` (built-in since Node 22.5, stable in Node 22.6+). Drop-in API: `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(dbPath); db.exec(...); db.prepare(...).run/get/all(...); db.close();`. PRAGMAs via `db.exec('PRAGMA journal_mode = WAL')`.

**Source repo:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/` (the fork from Plan 1)

**Working assumption:** All `cd` and file paths are relative to `~/Downloads/Projects/VibeDeck/` unless stated. Each task ends with `git commit` so progress is recoverable. Plan 1 baseline: 476/476 tests passing — must remain at 0 regressions.

---

## Task 1: Bootstrap Plan 2 and inventory existing storage

- [ ] **Step 1:** Verify Plan 1 baseline. Run `cd ~/Downloads/Projects/VibeDeck && git status && git log --oneline -5 && git tag --list | grep plan-1 && npm test 2>&1 | tail -10`. Expected: clean tree, `plan-1-fork-and-strip-complete` tag present, 476/476 tests passing. STOP if not.

- [ ] **Step 2:** Identify SQLite library: `grep -rn "require.*sqlite\|require.*better-sqlite\|from ['\"]sqlite\|from ['\"]better-sqlite" src/ 2>/dev/null` and `grep -E '"(sqlite|better-sqlite)' package.json`. Record library name + version, DB file path origin, WAL state, existing migration runner.

- [ ] **Step 3:** Read `src/lib/tracker-paths.js` to understand how data dir + DB path are derived.

- [ ] **Step 4:** Grep DB usage in `src/lib/local-api.js`: `grep -n "sqlite\|\.db\|prepare(\|transaction" src/lib/local-api.js | head -30`. Note connection pattern (singleton vs per-call).

- [ ] **Step 5:** Create `.vibedeck-plan2/inventory.md` with the values found in Steps 2-4 (library name, DB path origin, conventions). Reference for all later tasks.

- [ ] **Step 6:** Commit:
```bash
git add .vibedeck-plan2/inventory.md
git commit -m "chore(plan2): inventory existing storage conventions for VibeDeck schema work"
```

- [ ] **Step 7:** Bump `engines.node` in `package.json` from `>=20` to `>=22.5`. Reason: VibeDeck's new schema work uses `node:sqlite` (built-in, stable since Node 22.5). Edit `package.json` and commit:
```bash
git add package.json
git commit -m "chore(deps): bump engines.node to >=22.5 to enable node:sqlite (built-in)"
```
Run `node --version` first to confirm the dev machine satisfies the new requirement; if not, STOP and report.

---

## Task 2: Create schema versioning module

**Files:** `src/lib/db/schema.js`, `test/db-schema.test.js`

- [ ] **Step 1:** Write `test/db-schema.test.js` with 4 tests:
  1. `initSchema(dbPath)` creates `schema_version` table; `getSchemaVersion(dbPath, 'core')` returns 0 on empty DB.
  2. `registerMigration({ component, version, up })` followed by `runPendingMigrations(dbPath)` applies the migration; `getSchemaVersion` reflects the version.
  3. `runPendingMigrations` is idempotent (a registered migration runs at most once).
  4. `runPendingMigrations` creates a `dbPath.bak.<UTC-iso>` file before applying any migration.

  Use `node:fs.mkdtempSync` for temp DB paths under `os.tmpdir()`. Reset registry between tests via a test-only export `_resetRegistryForTests()`.

- [ ] **Step 2:** Run, expect FAIL: `node --test test/db-schema.test.js`.

- [ ] **Step 3:** Create `src/lib/db/schema.js` using **`node:sqlite`** (built-in). Exports:
  - `initSchema(dbPath)` — opens via `const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(dbPath);`, runs `db.exec('PRAGMA journal_mode = WAL')`, creates `schema_version (component TEXT PRIMARY KEY, version INTEGER NOT NULL, applied_at TEXT NOT NULL)` if absent, calls `db.close()`.
  - `getSchemaVersion(dbPath, component)` — open with `new DatabaseSync(dbPath, { readOnly: true })`, returns `row.version` or 0, close.
  - `registerMigration({ component, version, up })` — pushes to a module-level array, dedupe by `(component, version)`, sort.
  - `runPendingMigrations(dbPath)` — for each registered migration whose `version > getSchemaVersion`, copies DB to backup before applying first one, then runs `up(db)` inside a `BEGIN/COMMIT` transaction with rollback on error, upserts `schema_version` row in same tx.
  - `_resetRegistryForTests()` — clears registry.

  **Reference API (`node:sqlite`):**
  ```js
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('BEGIN');
  // ...
  db.exec('COMMIT');
  const row = db.prepare('SELECT version FROM schema_version WHERE component = ?').get(component);
  db.prepare('INSERT INTO ... VALUES (?, ?, ?)').run(a, b, c);
  db.close();
  ```
  If a method differs from `better-sqlite3`, follow `node:sqlite` semantics (it's the standard Node API now).

- [ ] **Step 4:** Add `test.beforeEach(() => _resetRegistryForTests())` to the test. Run, expect PASS.

- [ ] **Step 5:** Run full suite: `npm test 2>&1 | tail -20`. All green.

- [ ] **Step 6:** Commit:
```bash
git add src/lib/db/schema.js test/db-schema.test.js
git commit -m "feat(db): schema versioning module with migration runner and backup-before-migrate"
```

---

## Task 3: Migration 001 — `vibedeck_sessions` table

**Files:** `src/lib/db/migrations/001-vibedeck-sessions.js`, `test/db-migration-001-sessions.test.js`

- [ ] **Step 1:** Failing test asserts:
  1. After running migration 001, `vibedeck_sessions` table exists.
  2. Schema includes columns: `provider, session_id, started_at, ended_at, end_reason, cwd, repo_root, repo_common_dir, parent_repo, branch, branch_resolution_tier, confidence, override_user, model, total_tokens, total_cost_usd, created_at, updated_at`.
  3. Composite PK `(provider, session_id)` rejects duplicates.
  4. `getSchemaVersion(dbPath, 'vibedeck-sessions')` returns 1 after migrate.

- [ ] **Step 2:** Run, expect FAIL.

- [ ] **Step 3:** Create migration:

```js
'use strict';
module.exports = {
  component: 'vibedeck-sessions',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_sessions (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        end_reason TEXT,
        cwd TEXT,
        repo_root TEXT,
        repo_common_dir TEXT,
        parent_repo TEXT,
        branch TEXT,
        branch_resolution_tier TEXT NOT NULL,
        confidence TEXT NOT NULL,
        override_user TEXT,
        model TEXT,
        total_tokens INTEGER,
        total_cost_usd REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id)
      );
      CREATE INDEX idx_vibedeck_sessions_repo_branch ON vibedeck_sessions(repo_root, branch);
      CREATE INDEX idx_vibedeck_sessions_started ON vibedeck_sessions(started_at);
      CREATE INDEX idx_vibedeck_sessions_live ON vibedeck_sessions(ended_at) WHERE ended_at IS NULL;
    `);
  },
};
```

- [ ] **Step 4:** Run test, expect PASS. Run full suite.

- [ ] **Step 5:** Commit:
```bash
git add src/lib/db/migrations/001-vibedeck-sessions.js test/db-migration-001-sessions.test.js
git commit -m "feat(db): migration 001 — vibedeck_sessions with confidence + tier columns"
```

---

## Task 4: Migration 002 — `vibedeck_session_buckets` + `vibedeck_session_branch_windows`

**Files:** `src/lib/db/migrations/002-session-buckets-and-windows.js`, `test/db-migration-002-buckets-windows.test.js`

- [ ] **Step 1:** Failing test asserts both tables exist, FK to `vibedeck_sessions` enforced (orphan insert fails), `proportion DEFAULT 1.0` works, branch_windows columns include `id, provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd`.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create migration:

```js
'use strict';
module.exports = {
  component: 'vibedeck-session-buckets-and-windows',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_buckets (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        bucket_provider TEXT NOT NULL,
        bucket_model TEXT NOT NULL,
        bucket_hour_start TEXT NOT NULL,
        proportion REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (provider, session_id, bucket_provider, bucket_model, bucket_hour_start),
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE TABLE vibedeck_session_branch_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        prorated_tokens INTEGER,
        prorated_cost_usd REAL,
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_branch_windows_branch ON vibedeck_session_branch_windows(branch, window_start);
    `);
  },
};
```

- [ ] **Step 4-5:** PASS, full suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/db/migrations/002-session-buckets-and-windows.js test/db-migration-002-buckets-windows.test.js
git commit -m "feat(db): migration 002 — session buckets + branch-window tables with FK to sessions"
```

---

## Task 5: Migration 003 — `vibedeck_session_entire_links` + `vibedeck_repos`

**Files:** `src/lib/db/migrations/003-entire-links-and-repos.js`, `test/db-migration-003-entire-and-repos.test.js`

- [ ] **Step 1:** Failing test asserts both tables exist, `vibedeck_repos` columns are `repo_root, entire_state, entire_checked_at, entire_version`, PK is `repo_root` (duplicate insert fails), `vibedeck_session_entire_links` columns include `provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence` with composite PK.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create migration:

```js
'use strict';
module.exports = {
  component: 'vibedeck-entire-links-and-repos',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_entire_links (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        entire_session_id TEXT NOT NULL,
        entire_checkpoint_ids TEXT,
        match_confidence TEXT NOT NULL,
        PRIMARY KEY (provider, session_id, entire_session_id),
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE TABLE vibedeck_repos (
        repo_root TEXT PRIMARY KEY,
        entire_state TEXT,
        entire_checked_at TEXT,
        entire_version TEXT
      );
    `);
  },
};
```

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/db/migrations/003-entire-links-and-repos.js test/db-migration-003-entire-and-repos.test.js
git commit -m "feat(db): migration 003 — Entire session links + per-repo Entire state cache"
```

---

## Task 6: Migration 004 — `vibedeck_skills` + `vibedeck_head_history`

**Files:** `src/lib/db/migrations/004-skills-and-head-history.js`, `test/db-migration-004-skills-and-history.test.js`

- [ ] **Step 1:** Failing test asserts:
  - `vibedeck_skills` columns: `provider, name, install_path, source_url, installed_at, last_used_estimate`, PK `(provider, name)`.
  - `vibedeck_head_history` columns: `repo_root, worktree_root, transitioned_at, ref_name`, PK `(repo_root, worktree_root, transitioned_at)`.
  - Index `idx_head_history_lookup` on `(worktree_root, transitioned_at)` exists.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create migration:

```js
'use strict';
module.exports = {
  component: 'vibedeck-skills-and-head-history',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_skills (
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        install_path TEXT NOT NULL,
        source_url TEXT,
        installed_at TEXT NOT NULL,
        last_used_estimate TEXT,
        PRIMARY KEY (provider, name)
      );
      CREATE TABLE vibedeck_head_history (
        repo_root TEXT NOT NULL,
        worktree_root TEXT NOT NULL,
        transitioned_at TEXT NOT NULL,
        ref_name TEXT NOT NULL,
        PRIMARY KEY (repo_root, worktree_root, transitioned_at)
      );
      CREATE INDEX idx_head_history_lookup ON vibedeck_head_history(worktree_root, transitioned_at);
    `);
  },
};
```

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/db/migrations/004-skills-and-head-history.js test/db-migration-004-skills-and-history.test.js
git commit -m "feat(db): migration 004 — skills inventory + HEAD history persistence"
```

---

## Task 7: Wire migrations into `serve` startup

**Files:** `src/lib/db/index.js` (new), `src/commands/serve.js`, `test/db-ensure-schema.test.js`

- [ ] **Step 1:** Failing test asserts:
  1. `ensureSchema(dbPath)` on a fresh DB creates all 7 `vibedeck_*` tables.
  2. `ensureSchema` is idempotent (3 sequential calls leave DB unchanged after first).

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create `src/lib/db/index.js`:

```js
'use strict';
const { initSchema, registerMigration, runPendingMigrations } = require('./schema');
const m001 = require('./migrations/001-vibedeck-sessions');
const m002 = require('./migrations/002-session-buckets-and-windows');
const m003 = require('./migrations/003-entire-links-and-repos');
const m004 = require('./migrations/004-skills-and-head-history');

let registered = false;
function registerAll() {
  if (registered) return;
  registerMigration(m001);
  registerMigration(m002);
  registerMigration(m003);
  registerMigration(m004);
  registered = true;
}

function ensureSchema(dbPath) {
  initSchema(dbPath);
  registerAll();
  runPendingMigrations(dbPath);
}

module.exports = { ensureSchema };
```

- [ ] **Step 4:** Wire into `src/commands/serve.js`. Locate the early startup section (server initialized but not listening yet). Add:

```js
const { ensureSchema } = require('../lib/db');
const trackerPaths = require('../lib/tracker-paths');
const path = require('node:path');

const dbPath = trackerPaths.getDbPath
  ? trackerPaths.getDbPath()
  : path.join(trackerPaths.getDataDir(), 'db.sqlite');
ensureSchema(dbPath);
```

If `tracker-paths.js` already opens the DB elsewhere, use the same path. Inventory from Task 1 dictates the canonical name.

- [ ] **Step 5:** Run tests + smoke test serve:

```bash
node --test test/db-ensure-schema.test.js
rm -f ~/.vibedeck/db.sqlite ~/.vibedeck/db.sqlite.bak.*
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
ls -la ~/.vibedeck/db.sqlite 2>&1 | head -2
kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```
DB file must exist after serve startup.

- [ ] **Step 6:** Commit:
```bash
git add src/lib/db/index.js src/commands/serve.js test/db-ensure-schema.test.js
git commit -m "feat(db): wire schema migrations into serve startup; create vibedeck tables on first launch"
```

---

## Task 8: Entire bridge — `detectEntire()` with 60-second cache

**Files:** `src/lib/entire-bridge.js` (new), `test/entire-bridge-detect.test.js`

- [ ] **Step 1:** Failing test asserts `detectEntire()` returns `{ present: bool, version: string|null }`, two consecutive calls return identical result (cache hit), and `_resetEntireCacheForTests()` forces refresh.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create `src/lib/entire-bridge.js`:

```js
'use strict';
const ex = require('execa'); // confirm import shape from Task 1 inventory; some TT modules use .default

const CACHE_TTL_MS = 60 * 1000;
let cache = null;

async function detectEntire({ timeoutMs = 5000 } = {}) {
  const now = Date.now();
  if (cache && now - cache.stamp < CACHE_TTL_MS) return cache.result;
  let result;
  try {
    const { stdout } = await ex.execa('entire', ['version'], { timeout: timeoutMs });
    result = { present: true, version: String(stdout).trim() };
  } catch {
    result = { present: false, version: null };
  }
  cache = { result, stamp: now };
  return result;
}

function _resetEntireCacheForTests() { cache = null; }

module.exports = { detectEntire, _resetEntireCacheForTests };
```

If `execa` import shape differs, follow the existing pattern in `src/commands/sync.js`.

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/entire-bridge.js test/entire-bridge-detect.test.js
git commit -m "feat(entire): detectEntire() with 60-second result cache"
```

---

## Task 9: Wire `detectEntire()` into `vibedeck doctor`

**Files:** `src/commands/doctor.js`, `test/doctor-entire-check.test.js`

- [ ] **Step 1:** Find existing doctor command: `cat src/commands/doctor.js`. Locate the function that emits checks (each has `name, status, message`). If checks aren't independently enumerable, refactor to expose `runDoctorChecks()` returning the array, while keeping the CLI behavior identical.

- [ ] **Step 2:** Failing test asserts `runDoctorChecks()` includes a check whose `name` matches `/entire/i`, with valid `status` and string `message`.

- [ ] **Step 3:** FAIL.

- [ ] **Step 4:** Add the check. When `detectEntire().present === true`, emit `{ status: 'ok', message: 'Entire CLI ${version} on PATH' }`. When false, emit `{ status: 'info', message: 'Entire CLI not found on PATH. Install: brew install --cask entireio/tap/entire (or curl -fsSL https://entire.io/install.sh | bash). Without Entire, session→branch attribution falls back to lower-confidence tiers.' }`. Status `info` not `fail` because Entire is optional.

- [ ] **Step 5:** Run tests + CLI smoke: `node bin/vibedeck.js doctor 2>&1 | grep -i entire`. Expected: a line about Entire status.

- [ ] **Step 6:** Commit:
```bash
git add src/commands/doctor.js test/doctor-entire-check.test.js
git commit -m "feat(doctor): include Entire CLI presence check in vibedeck doctor"
```

---

## Task 10: Direct git read of `entire/checkpoints/v1`

**Files:** `src/lib/entire-bridge.js` (extend), `test/entire-bridge-git-read.test.js`

- [ ] **Step 1:** Failing test sets up a real temp git repo, creates an `entire/checkpoints/v1` orphan branch with a synthetic checkpoint JSON file, and asserts:
  1. `listCheckpoints(repo)` returns `{ available: true, files: [...] }` with the synthetic file path.
  2. On a repo without the branch, returns `{ available: false, reason: 'branch_not_fetched' }`.
  3. `readCheckpoint(repo, filePath)` returns the parsed JSON.

  Use the same `execa`-style helpers TokenTracker already uses for git fixtures (synchronous variant) to set up the test repo.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Append to `src/lib/entire-bridge.js`:

```js
const CHECKPOINT_BRANCH = 'entire/checkpoints/v1';

async function _branchExists(repoRoot, branchName) {
  try {
    await ex.execa('git', ['-C', repoRoot, 'rev-parse', '--verify', `refs/heads/${branchName}`], { timeout: 5000 });
    return true;
  } catch { return false; }
}

async function listCheckpoints(repoRoot) {
  if (!(await _branchExists(repoRoot, CHECKPOINT_BRANCH))) {
    return { available: false, reason: 'branch_not_fetched' };
  }
  try {
    const { stdout } = await ex.execa('git', ['-C', repoRoot, 'ls-tree', '-r', '--name-only', CHECKPOINT_BRANCH], { timeout: 10000 });
    const files = stdout.trim() ? stdout.trim().split('\n') : [];
    return { available: true, files };
  } catch (err) {
    return { available: false, reason: 'git_error', detail: String(err.shortMessage || err.message) };
  }
}

async function readCheckpoint(repoRoot, filePath) {
  if (typeof filePath !== 'string' || filePath.includes('\0') ||
      filePath.startsWith('/') || filePath.split('/').includes('..')) {
    throw new Error(`readCheckpoint: invalid filePath: ${filePath}`);
  }
  const { stdout } = await ex.execa('git', ['-C', repoRoot, 'show', `${CHECKPOINT_BRANCH}:${filePath}`], { timeout: 5000 });
  return JSON.parse(stdout);
}

async function getCheckpointsBranchTip(repoRoot) {
  try {
    const { stdout } = await ex.execa('git', ['-C', repoRoot, 'rev-parse', CHECKPOINT_BRANCH], { timeout: 5000 });
    return stdout.trim();
  } catch { return null; }
}
```

Consolidate exports at the bottom of the file.

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/entire-bridge.js test/entire-bridge-git-read.test.js
git commit -m "feat(entire): direct git plumbing reads of entire/checkpoints/v1 (no CLI spawn)"
```

---

## Task 11: Tip-keyed memoization of checkpoint tree reads

**Files:** `src/lib/entire-bridge.js` (extend), `test/entire-bridge-cache.test.js`

- [ ] **Step 1:** Failing test uses an exposed `_getInternalStats()` to assert that two calls to `listCheckpointsCached(repoRoot)` (with no branch tip change in between) result in only one `git ls-tree` call.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Add to `entire-bridge.js`:

```js
const _treeCache = new Map();
let _gitListCalls = 0;

async function listCheckpointsCached(repoRoot) {
  const tip = await getCheckpointsBranchTip(repoRoot);
  if (!tip) return { available: false, reason: 'branch_not_fetched' };
  const key = `${repoRoot}|${tip}`;
  if (_treeCache.has(key)) {
    return { available: true, files: _treeCache.get(key), tip, cached: true };
  }
  _gitListCalls += 1;
  const result = await listCheckpoints(repoRoot);
  if (result.available) {
    _treeCache.set(key, result.files);
    result.tip = tip;
  }
  return result;
}

function _resetCheckpointCacheForTests() { _treeCache.clear(); _gitListCalls = 0; }
function _getInternalStats() { return { gitListCalls: _gitListCalls, cacheSize: _treeCache.size }; }
```

Add to exports: `listCheckpointsCached, _resetCheckpointCacheForTests, _getInternalStats`.

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/entire-bridge.js test/entire-bridge-cache.test.js
git commit -m "feat(entire): tip-keyed memoization of checkpoint tree reads"
```

---

## Task 12: Safe Entire shell-out wrappers

**Files:** `src/lib/entire-bridge.js` (extend), `test/entire-bridge-shell-outs.test.js`

Add wrappers for: `enable`, `disable`, `agent add`, `agent remove`, `status`, `configure`. All use `execa` argv form, validate args, time out at 30s, return `{ exitCode, stdout, stderr }`.

- [ ] **Step 1:** Failing tests:
  1. `validateAgentName` accepts known names: `claude-code, codex, gemini, opencode, cursor, factoryai-droid, copilot-cli`.
  2. `validateAgentName` rejects unknown / unsafe names.
  3. `validateBranchName` rejects names that fail `git check-ref-format`.
  4. `enableEntire` returns `{ exitCode, stdout, stderr }` shape (test SKIPS gracefully when `entire` not on PATH via `t.skip()`).

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Append:

```js
const KNOWN_AGENTS = new Set(['claude-code', 'codex', 'gemini', 'opencode', 'cursor', 'factoryai-droid', 'copilot-cli']);

function validateAgentName(name) {
  if (typeof name !== 'string' || !KNOWN_AGENTS.has(name)) {
    throw new Error(`Invalid agent name: ${name}. Allowed: ${Array.from(KNOWN_AGENTS).join(', ')}`);
  }
}

async function validateBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new Error(`Invalid branch name: ${name}`);
  try {
    await ex.execa('git', ['check-ref-format', '--branch', name], { timeout: 3000 });
  } catch {
    throw new Error(`Invalid branch name (git check-ref-format): ${name}`);
  }
}

async function _runEntire(args, { cwd, timeoutMs = 30000 } = {}) {
  try {
    const r = await ex.execa('entire', args, { cwd, timeout: timeoutMs, reject: false });
    return { exitCode: r.exitCode, stdout: String(r.stdout), stderr: String(r.stderr) };
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err.shortMessage || err.message) };
  }
}

async function enableEntire(repoRoot, agents = []) {
  const args = ['enable'];
  for (const a of agents) { validateAgentName(a); args.push('--agent', a); }
  return _runEntire(args, { cwd: repoRoot });
}
async function disableEntire(repoRoot) { return _runEntire(['disable'], { cwd: repoRoot }); }
async function entireAgentAdd(repoRoot, agent) { validateAgentName(agent); return _runEntire(['agent', 'add', agent], { cwd: repoRoot }); }
async function entireAgentRemove(repoRoot, agent) { validateAgentName(agent); return _runEntire(['agent', 'remove', agent], { cwd: repoRoot }); }
async function entireStatus(repoRoot) { return _runEntire(['status'], { cwd: repoRoot }); }
async function entireConfigure(repoRoot, args = []) { return _runEntire(['configure', ...args], { cwd: repoRoot }); }
```

Export all 6 functions + `validateAgentName, validateBranchName`.

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/entire-bridge.js test/entire-bridge-shell-outs.test.js
git commit -m "feat(entire): safe shell-out wrappers (enable/disable/agent/status/configure) with arg validation"
```

---

## Task 13: Destructive shell-outs with placeholder confirm-token gate

**Files:** `src/lib/entire-bridge.js` (extend), extend `test/entire-bridge-shell-outs.test.js`

- [ ] **Step 1:** Failing tests: `rewindCheckpoint` and `cleanEntire` reject when called without a confirm token (or empty string); `rewindCheckpoint` validates checkpoint id format `^[a-f0-9]{12}$`.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Append:

```js
const CHECKPOINT_ID_RE = /^[a-f0-9]{12}$/;

function validateCheckpointId(id) {
  if (!CHECKPOINT_ID_RE.test(id)) throw new Error(`Invalid checkpoint id (expected 12 lowercase hex chars): ${id}`);
}

function _checkConfirmToken(token, opName) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`${opName} requires a confirm token; refusing to run without one`);
  }
  console.warn(`[vibedeck] WARN: ${opName} accepted placeholder confirm token (Plan 4 wires real auth)`);
}

async function rewindCheckpoint(repoRoot, checkpointId, confirmToken) {
  _checkConfirmToken(confirmToken, 'rewindCheckpoint');
  validateCheckpointId(checkpointId);
  return _runEntire(['checkpoint', 'rewind', '--id', checkpointId], { cwd: repoRoot });
}

async function cleanEntire(repoRoot, confirmToken, { all = false } = {}) {
  _checkConfirmToken(confirmToken, 'cleanEntire');
  const args = ['clean', '--force'];
  if (all) args.push('--all');
  return _runEntire(args, { cwd: repoRoot });
}
```

Export `rewindCheckpoint, cleanEntire, validateCheckpointId`.

- [ ] **Step 4-5:** PASS, suite green.
- [ ] **Step 6:** Commit:
```bash
git add src/lib/entire-bridge.js test/entire-bridge-shell-outs.test.js
git commit -m "feat(entire): destructive shell-outs (rewind, clean) behind placeholder confirm-token gate"
```

---

## Task 14: `getEntireRepoStatus()` — four-state machine + persist to `vibedeck_repos`

**Files:** `src/lib/db/repos.js` (new), `src/lib/entire-bridge.js` (extend), `test/entire-bridge-status.test.js`

State machine for any `repoRoot`:
- `not_installed` — `detectEntire().present === false`
- `not_enabled` — `<repoRoot>/.entire/settings.json` absent OR `enabled === false`
- `enabled_no_commits` — settings present + enabled, but `entire/checkpoints/v1` branch absent
- `active` — settings present + enabled + checkpoints branch exists

- [ ] **Step 1:** Failing test sets up multiple temp repos in each state (no `.entire`, present-but-disabled, enabled-without-commits, fully-active) and asserts `getEntireRepoStatus(repo)` returns the right state. Persistence test: after the call, `vibedeck_repos` row exists with the right `entire_state`.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Create `src/lib/db/repos.js`:

```js
'use strict';
const { DatabaseSync } = require('node:sqlite');

function upsertEntireState(dbPath, { repoRoot, entire_state, entire_version }) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(`
      INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo_root) DO UPDATE SET
        entire_state = excluded.entire_state,
        entire_checked_at = excluded.entire_checked_at,
        entire_version = excluded.entire_version
    `).run(repoRoot, entire_state, new Date().toISOString(), entire_version || null);
  } finally { db.close(); }
}

function getRepoState(dbPath, repoRoot) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT * FROM vibedeck_repos WHERE repo_root = ?`).get(repoRoot) || null;
  } finally { db.close(); }
}

module.exports = { upsertEntireState, getRepoState };
```

- [ ] **Step 4:** Add to `entire-bridge.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { upsertEntireState } = require('./db/repos');
const trackerPaths = require('./tracker-paths');

function _getDbPath() {
  return trackerPaths.getDbPath
    ? trackerPaths.getDbPath()
    : path.join(trackerPaths.getDataDir(), 'db.sqlite');
}

async function getEntireRepoStatus(repoRoot, { persist = true } = {}) {
  const detection = await detectEntire();
  if (!detection.present) {
    if (persist) upsertEntireState(_getDbPath(), { repoRoot, entire_state: 'not_installed' });
    return { state: 'not_installed' };
  }
  const settingsPath = path.join(repoRoot, '.entire', 'settings.json');
  let enabled = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      enabled = json.enabled !== false;
    } catch { enabled = false; }
  }
  if (!enabled) {
    if (persist) upsertEntireState(_getDbPath(), { repoRoot, entire_state: 'not_enabled', entire_version: detection.version });
    return { state: 'not_enabled', version: detection.version };
  }
  const tip = await getCheckpointsBranchTip(repoRoot);
  if (!tip) {
    if (persist) upsertEntireState(_getDbPath(), { repoRoot, entire_state: 'enabled_no_commits', entire_version: detection.version });
    return { state: 'enabled_no_commits', version: detection.version };
  }
  if (persist) upsertEntireState(_getDbPath(), { repoRoot, entire_state: 'active', entire_version: detection.version });
  return { state: 'active', version: detection.version, checkpoint_branch_tip: tip };
}
```

Export `getEntireRepoStatus`.

- [ ] **Step 5-6:** PASS, suite green. Commit:
```bash
git add src/lib/db/repos.js src/lib/entire-bridge.js test/entire-bridge-status.test.js
git commit -m "feat(entire): four-state per-repo status machine, persisted to vibedeck_repos"
```

---

## Task 15: `entire login` prompt in `vibedeck init`

**Files:** `src/commands/init.js` or `src/lib/init-flow.js` (extend), `test/init-entire-login.test.js`

When `detectEntire().present === true` during init, the wizard offers an optional `entire login`. Skippable. If accepted, shell out via `stdio: 'inherit'` for the device-auth browser flow.

- [ ] **Step 1:** Read existing init flow — note the prompt API (`prompts`, `inquirer`, custom). Adapt the snippet below to that API.

- [ ] **Step 2:** Failing test asserts the init flow includes the "entire login" branch when Entire is detected (mock `detectEntire` to return `present: true`). Skip the actual interactive prompt by using a `--skip-entire-login` flag or a non-interactive mode.

- [ ] **Step 3:** Add to init wizard, after AI tools detection:

```js
const { detectEntire } = require('../lib/entire-bridge');
const ex = require('execa');

const ent = await detectEntire();
if (ent.present) {
  ui.info(`Entire CLI ${ent.version} detected.`);
  ui.info('Entire works locally without authentication. For AI summaries and entire.io sync, login is required.');
  const wantLogin = await ui.confirm('Run `entire login` now to set up your Entire account? (skippable)', { default: false });
  if (wantLogin) {
    try {
      await ex.execa('entire', ['login'], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
      ui.success('Entire login complete.');
    } catch (err) {
      ui.warn(`Entire login did not complete (${err.shortMessage || err.message}). Run \`entire login\` later.`);
    }
  } else {
    ui.info('Skipped. Run `entire login` later if you want AI summaries / cloud sync.');
  }
}
```

- [ ] **Step 4:** Smoke test: `node bin/vibedeck.js init --help 2>&1 | head -20` (mention of Entire login is informational only).

- [ ] **Step 5-6:** PASS, suite green. Commit:
```bash
git add src/commands/init.js src/lib/init-flow.js test/init-entire-login.test.js
git commit -m "feat(init): optional 'entire login' prompt during VibeDeck setup"
```

---

## Task 16: New read-only API endpoints

**Files:** `src/lib/local-api.js` (extend), `test/local-api-vibedeck-checkpoints.test.js`

Three endpoints, all GET, all read-only:
- `GET /functions/vibedeck-checkpoints?repo=<absolute-path>` → `{ available, files, reason?, tip? }`
- `GET /functions/vibedeck-checkpoint?repo=<path>&path=<file-path>` → parsed JSON of one checkpoint
- `GET /functions/vibedeck-entire-status?repo=<path>` → `{ state, version?, checkpoint_branch_tip? }`

All validate `repo` via `fs.realpathSync` + existence check, return 400 on invalid paths.

- [ ] **Step 1:** Failing test spins up local API in a temp config, hits each endpoint, asserts response shape. Use existing local-API test patterns (`test/local-api-*.test.js`).

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Add handlers to `local-api.js` matching the existing route registration pattern. Each handler:
  1. Parses `repo` from query string, calls `fs.realpathSync`, returns 400 on failure.
  2. Calls `entire-bridge` function.
  3. Returns JSON with appropriate status.

  For `/functions/vibedeck-checkpoint`, validate the `path` query param using `readCheckpoint`'s safety rules (no `..`, no leading `/`, no NUL bytes).

- [ ] **Step 4:** Smoke test:
```bash
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
curl -s "http://127.0.0.1:7690/functions/vibedeck-entire-status?repo=$HOME/Downloads/Projects/VibeDeck" | head -3
curl -s "http://127.0.0.1:7690/functions/vibedeck-checkpoints?repo=$HOME/Downloads/Projects/VibeDeck" | head -3
kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```
Both return JSON.

- [ ] **Step 5-6:** PASS, suite green. Commit:
```bash
git add src/lib/local-api.js test/local-api-vibedeck-checkpoints.test.js
git commit -m "feat(api): vibedeck-checkpoints, vibedeck-checkpoint, vibedeck-entire-status read endpoints"
```

---

## Task 17: Stub write endpoint `POST /functions/vibedeck-entire/:cmd`

**Files:** `src/lib/local-api.js` (extend), `test/local-api-entire-write-stub.test.js`

Plan 4 wires real auth. Plan 2 reserves the URL with a 403 stub.

- [ ] **Step 1:** Failing test asserts POST returns 403 with body `{ error: 'auth_pending', message: ..., cmd: <param> }`.

- [ ] **Step 2:** FAIL.

- [ ] **Step 3:** Add handler:

```js
function registerVibedeckEntireWriteStub(app) {
  app.post('/functions/vibedeck-entire/:cmd', (req, res) => {
    res.status(403).json({
      error: 'auth_pending',
      message: 'This endpoint will be enabled in Plan 4 (local-auth tokens).',
      cmd: req.params.cmd,
    });
  });
}
```

Adapt to actual server framework used in TokenTracker (raw `http`, custom router, or express-style). Follow existing patterns.

- [ ] **Step 4:** Smoke test:
```bash
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:7690/functions/vibedeck-entire/enable" -d '{}' -H 'content-type: application/json'
kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```
Expected: `403`.

- [ ] **Step 5-6:** PASS, suite green. Commit:
```bash
git add src/lib/local-api.js test/local-api-entire-write-stub.test.js
git commit -m "feat(api): stub POST /functions/vibedeck-entire/:cmd returns 403 (auth pending Plan 4)"
```

---

## Task 18: Final validation — clean install, build, full test, smoke, tag

- [ ] **Step 1:** Clean install:
```bash
cd ~/Downloads/Projects/VibeDeck
rm -rf node_modules dashboard/node_modules dashboard/dist
npm install
```

- [ ] **Step 2:** Build dashboard: `npm run dashboard:build 2>&1 | tail -10`. PASS.

- [ ] **Step 3:** Full test suite: `npm test 2>&1 | tee /tmp/vibedeck-plan2-final.log | tail -30`. Expected ~501-511 tests passing (Plan 1 was 476; Plan 2 adds 25-35 across schema, migrations, entire-bridge, API endpoints).

- [ ] **Step 4:** Validators:
```bash
npm run validate:guardrails 2>&1 | tail -10
npm run validate:ui-hardcode 2>&1 | tail -10
npm run validate:copy 2>&1 | tail -10
```
All PASS.

- [ ] **Step 5:** CLI smoke:
```bash
node bin/vibedeck.js --help 2>&1 | head -10
node bin/vibedeck.js doctor 2>&1 | head -30
```
Doctor includes Entire CLI presence check.

- [ ] **Step 6:** Local server end-to-end smoke:
```bash
rm -f ~/.vibedeck/db.sqlite ~/.vibedeck/db.sqlite.bak.*
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
echo '--- vibedeck-entire-status ---'
curl -s "http://127.0.0.1:7690/functions/vibedeck-entire-status?repo=$HOME/Downloads/Projects/VibeDeck" | head -3
echo
echo '--- vibedeck-checkpoints ---'
curl -s "http://127.0.0.1:7690/functions/vibedeck-checkpoints?repo=$HOME/Downloads/Projects/VibeDeck" | head -3
echo
echo '--- write stub (expect 403) ---'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:7690/functions/vibedeck-entire/enable" -d '{}' -H 'content-type: application/json'
echo
echo '--- DB created? ---'
ls -la ~/.vibedeck/db.sqlite 2>&1 | head -2
echo
echo '--- Tables? ---'
sqlite3 ~/.vibedeck/db.sqlite "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vibedeck_%' ORDER BY name;"
kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```
Expected: status returns valid JSON, checkpoints returns `branch_not_fetched`, write stub returns 403, DB exists with all 7 `vibedeck_*` tables.

- [ ] **Step 7:** Tag:
```bash
cd ~/Downloads/Projects/VibeDeck
git tag plan-2-storage-and-entire-bridge-complete
git log --oneline -25
```

- [ ] **Step 8:** Verify clean state: `git status`. Should be clean.

---

## Self-review notes

The deliverable is verifiable through three observable behaviors:
1. `~/.vibedeck/db.sqlite` exists after first `serve` startup with all 7 `vibedeck_*` tables.
2. `GET /functions/vibedeck-entire-status?repo=<path>` returns one of four states for any local repo.
3. `POST /functions/vibedeck-entire/:cmd` returns `403 auth_pending` (URL space reserved without exposing destructive operations).

After Plan 2 ships, Plan 3 (Session Attribution + Hook Merger) can begin writing into `vibedeck_sessions` / `vibedeck_session_buckets` / `vibedeck_session_branch_windows` / `vibedeck_session_entire_links` / `vibedeck_head_history`.

## Execution handoff

Plan 2 is ready. Recommended: subagent-driven execution with the same dispatcher pattern used for Plan 1.
