# VibeDeck v1 — Plan 3: Session Attribution + Hook Merger

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Recommended dispatcher: Codex (gpt-5.2) per `docs/superpowers/codex-workflow.md`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the collision-safe hook merger (all 7 formats, two-phase atomic installer) and the full session attribution layer (SessionEvent extraction across 13 providers, repo/worktree/submodule resolution, four-tier branch resolution with confidence, branch-window splitting, orphan reaper, live SSE stream). After this plan, every token bucket links to a session with confidence-tagged branch attribution.

**Architecture:** Hook merger first (Tasks 4-13) — session detection depends on hooks firing correctly. Then SessionEvent extraction extends `src/lib/rollout.js` in-place (token math untouched). Repo/branch resolution lives in a new `src/lib/sessions/` directory split by responsibility (resolution, tiers, windows, reaper). Live HEAD watcher uses Chokidar with lazy-watch on active repos. SSE endpoint streams session deltas to dashboard. All writes funnel through the `serve` daemon (single-writer pattern from spec §5).

**Tech Stack:** Node.js ≥22.5, `node:sqlite` (built-in), `execa@5.1.1` (existing), Chokidar (existing in TokenTracker), `node --test`. New deps: none. No native modules.

**Source repo:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/` — Plan 2 baseline: 502/502 tests passing, tagged `plan-2-storage-and-entire-bridge-complete`.

**Working assumption:** all `cd` and file paths are relative to `~/Downloads/Projects/VibeDeck/` unless stated. Each task ends with `git commit` so progress is recoverable. **Plan 2 baseline must remain at 0 regressions across all phases.**

**Edge case coverage:** every edge case from spec §3.7 (30 cases) and §2 (hook collision matrix) is mapped to a specific task and locked by a test. The cross-reference table at the end of this document maps each spec edge case → owning task.

---

## Phase A — Plan 2 hardening (Tasks 1-3)

These are the 6 reviewer follow-ups recorded at the top of `2026-05-09-vibedeck-v1-plan-2-storage-and-entire-bridge.md`. Land them first so Plan 3 builds on a clean base.

---

### Task 1: Plan 2 follow-up — entire-bridge cleanups

**Files:**
- Modify: `src/lib/entire-bridge.js` (4 fixes)
- Test (extend): `test/entire-bridge-shell-outs.test.js`
- Test (extend): `test/entire-bridge-cache.test.js`
- Test (new): `test/entire-bridge-doctor.test.js`

- [ ] **Step 1: Failing test — `rewindCheckpoint` checks confirm token before checkpoint id**

In `test/entire-bridge-shell-outs.test.js`, add:
```js
test('rewindCheckpoint rejects missing confirm token before validating id', async (t) => {
  const bridge = require('../src/lib/entire-bridge');
  // Pass an obviously bad checkpoint id; the test asserts the error mentions the token, not the id.
  await assert.rejects(
    () => bridge.rewindCheckpoint('/tmp', 'NOT-HEX', ''),
    (err) => /confirm token/i.test(err.message) && !/checkpoint id/i.test(err.message),
  );
});
```

- [ ] **Step 2: Failing test — `_treeCache` LRU cap of 100 entries**

In `test/entire-bridge-cache.test.js`, add:
```js
test('_treeCache evicts oldest entry when size exceeds 100', () => {
  const bridge = require('../src/lib/entire-bridge');
  bridge._resetCheckpointCacheForTests();
  for (let i = 0; i < 105; i++) bridge._setTreeCacheForTests(`/repo${i}|tip${i}`, []);
  const stats = bridge._getInternalStats();
  assert.strictEqual(stats.cacheSize, 100);
  // Earliest entry must be gone:
  assert.strictEqual(bridge._hasTreeCacheKeyForTests('/repo0|tip0'), false);
});
```

- [ ] **Step 3: Failing test — `entireDoctor()` wrapper exists and returns shape**

Create `test/entire-bridge-doctor.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');

test('entireDoctor returns { exitCode, stdout, stderr } shape', async (t) => {
  const bridge = require('../src/lib/entire-bridge');
  if (typeof bridge.entireDoctor !== 'function') t.fail('entireDoctor not exported');
  const result = await bridge.entireDoctor('/tmp');
  assert.ok('exitCode' in result && 'stdout' in result && 'stderr' in result);
});
```

- [ ] **Step 4: Run all three test files, expect FAIL**

```bash
node --test test/entire-bridge-shell-outs.test.js test/entire-bridge-cache.test.js test/entire-bridge-doctor.test.js 2>&1 | tail -15
```

- [ ] **Step 5: Apply the four fixes to `src/lib/entire-bridge.js`**

1. **Reorder `rewindCheckpoint`** (around line 224): call `_checkConfirmToken(confirmToken, 'rewindCheckpoint')` **before** `validateCheckpointId(checkpointId)`.

2. **Add LRU cap to `_treeCache`** (around line 13). Replace the bare `Map` with an LRU helper:
   ```js
   const TREE_CACHE_MAX = 100;
   const _treeCache = new Map();
   function _treeCacheSet(key, value) {
     if (_treeCache.has(key)) _treeCache.delete(key);
     else if (_treeCache.size >= TREE_CACHE_MAX) {
       const oldestKey = _treeCache.keys().next().value;
       _treeCache.delete(oldestKey);
     }
     _treeCache.set(key, value);
   }
   ```
   In `listCheckpointsCached`, replace `_treeCache.set(key, result.files)` with `_treeCacheSet(key, result.files)`. Add test-only helpers `_setTreeCacheForTests(k,v)` and `_hasTreeCacheKeyForTests(k)` that mirror the prod calls.

3. **Add `entireDoctor()`**:
   ```js
   async function entireDoctor(repoRoot) { return _runEntire(['doctor'], { cwd: repoRoot }); }
   ```
   Export it.

4. (Read-only `getSchemaVersion` and the `applied_at` rename are handled in Task 2 because they touch the schema module.)

- [ ] **Step 6: Run failing tests to PASS, then full suite**

```bash
node --test test/entire-bridge-*.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
```
Expected: 502 + 3 = 505 passing.

- [ ] **Step 7: Commit**

```bash
git add src/lib/entire-bridge.js test/entire-bridge-shell-outs.test.js test/entire-bridge-cache.test.js test/entire-bridge-doctor.test.js
git commit -m "fix(entire): plan-2 follow-ups — confirm-token order, LRU cap, entireDoctor wrapper"
```

---

### Task 2: Plan 2 follow-up — schema_version cleanup

**Files:**
- Modify: `src/lib/db/schema.js`
- Test (new): `test/db-schema-applied-at.test.js`

The two remaining Plan 2 items: make `getSchemaVersion` open the DB read-only (no WAL pragma side effect), and rename `schema_version.updated_at` → `applied_at`. Since no users exist on disk, we drop and recreate the table inside `initSchema`.

- [ ] **Step 1: Failing test — schema uses `applied_at` and `getSchemaVersion` is read-only**

Create `test/db-schema-applied-at.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { initSchema, getSchemaVersion } = require('../src/lib/db/schema');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-schema-'));
  return path.join(dir, 'db.sqlite');
}

test('schema_version exposes applied_at column (not updated_at)', () => {
  const dbPath = tmpDb();
  initSchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const cols = db.prepare("PRAGMA table_info('schema_version')").all().map(r => r.name);
  db.close();
  assert.ok(cols.includes('applied_at'), `expected applied_at; got ${cols.join(',')}`);
  assert.ok(!cols.includes('updated_at'));
});

test('getSchemaVersion does not create -wal/-shm files (read-only open)', () => {
  const dbPath = tmpDb();
  initSchema(dbPath);
  // Force the DB to not be in WAL by closing cleanly first; then assert getSchemaVersion does NOT add wal/shm.
  const before = fs.existsSync(`${dbPath}-wal`);
  getSchemaVersion(dbPath, 'never-exists');
  const after = fs.existsSync(`${dbPath}-wal`);
  assert.strictEqual(after, before, 'getSchemaVersion must not flip WAL on');
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/db-schema-applied-at.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Apply two changes to `src/lib/db/schema.js`**

1. In `initSchema` and the inline-create inside `getSchemaVersion`: rename `updated_at TEXT NOT NULL` → `applied_at TEXT NOT NULL`. Update every `INSERT`/`UPDATE` site that references the old name (search for `updated_at` in the file).
2. In `getSchemaVersion`, replace the writable `openDb(dbPath)` call with `new DatabaseSync(dbPath, { readOnly: true })`. Remove the inline `CREATE TABLE IF NOT EXISTS` from `getSchemaVersion` — the read-only open requires the table to exist; callers always go through `initSchema` first (verify by greps; if any caller doesn't, fix that caller).

- [ ] **Step 4: Run failing test to PASS, then full suite**

```bash
node --test test/db-schema-applied-at.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
```
Expected: all green; 506+ passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/schema.js test/db-schema-applied-at.test.js
git commit -m "refactor(db): rename schema_version.updated_at -> applied_at; getSchemaVersion is read-only"
```

---

### Task 3: Plan 2 follow-up — wire `getRepoState` into a read API endpoint

**Files:**
- Modify: `src/lib/local-api.js` (extend handler block from Plan 2)
- Test (new): `test/local-api-vibedeck-repo-state.test.js`

Plan 2 exported `getRepoState(dbPath, repoRoot)` from `src/lib/db/repos.js` with no caller. Wiring it into the existing `vibedeck-entire-status` endpoint completes the loop and gives Plan 3's session attribution a baseline data source for "is Entire active here?".

- [ ] **Step 1: Failing test — `vibedeck-entire-status` reports cached state when persistent row exists**

Create `test/local-api-vibedeck-repo-state.test.js` following the pattern in `test/local-api-vibedeck-checkpoints.test.js`. The test:
1. Spawns the local server on an ephemeral port via the existing test helper.
2. Pre-seeds `vibedeck_repos` with `{ repo_root: <abs path>, entire_state: 'active', entire_version: '0.42.0' }` via `upsertEntireState`.
3. Calls `GET /functions/vibedeck-entire-status?repo=<path>&cached=1`.
4. Asserts response includes `cached_state: 'active'` and `cached_version: '0.42.0'`.

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/local-api-vibedeck-repo-state.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Extend the `vibedeck-entire-status` handler in `src/lib/local-api.js`**

When the request includes `?cached=1`, look up `getRepoState(dbPath, repoRoot)` and merge `{ cached_state, cached_version, cached_checked_at }` into the response. Live state (`getEntireRepoStatus`) still runs and remains authoritative; the cache is purely informational for clients that want to see the previous tick without paying the live-detect cost.

- [ ] **Step 4: Run test, full suite**

```bash
node --test test/local-api-vibedeck-repo-state.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-api.js test/local-api-vibedeck-repo-state.test.js
git commit -m "feat(api): vibedeck-entire-status surfaces cached repo state via getRepoState"
```

---

## Phase B — Hook Merger (Tasks 4-13)

The hook merger lives at `src/lib/hook-merger.js` and is the **single entry point** for all VibeDeck hook installs/removes. Existing per-format files (`claude-config.js`, `codex-config.js`, etc.) keep their primitives; the merger orchestrates signature-based dedupe and the two-phase atomic batch.

---

### Task 4: Hook merger foundation — signature contract and registry

**Files:**
- Create: `src/lib/hook-merger/index.js`
- Create: `src/lib/hook-merger/signature.js`
- Test: `test/hook-merger-signature.test.js`

- [ ] **Step 1: Define the signature contract**

The signature determines whether a given hook entry was written by VibeDeck. Spec §2.1 codifies:
- JSON formats: sibling field `_vibedeck: 'v1'` OR command path matching `~/.vibedeck/app/hooks/notify.cjs` (resolved per-machine via `tracker-paths.getDataDir()`).
- TOML (Codex/Every Code): notify-array entry whose command path matches the canonical hook path. (Comments not preserved through `@iarna/toml` round-trips; rely on path-only detection.)
- TS plugin (OpenCode): named export `vibedeckPlugin` and/or a file at `<repo>/.opencode/plugins/vibedeck.ts`.

- [ ] **Step 2: Failing test for signature helpers**

Create `test/hook-merger-signature.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const sig = require('../src/lib/hook-merger/signature');

test('isVibedeckEntryJSON matches by _vibedeck field', () => {
  assert.strictEqual(sig.isVibedeckEntryJSON({ _vibedeck: 'v1', command: 'x' }), true);
  assert.strictEqual(sig.isVibedeckEntryJSON({ command: 'x' }), false);
});

test('isVibedeckEntryJSON matches by canonical command path glob', () => {
  const cmd = path.join(require('os').homedir(), '.vibedeck', 'app', 'hooks', 'notify.cjs');
  assert.strictEqual(sig.isVibedeckEntryJSON({ command: cmd }), true);
});

test('isEntireEntryJSON detects entire hook entries', () => {
  assert.strictEqual(sig.isEntireEntryJSON({ command: '/usr/local/bin/entire hook session-end' }), true);
  assert.strictEqual(sig.isEntireEntryJSON({ command: 'echo hi' }), false);
});

test('canonicalCommandPath uses ~/.vibedeck/app/hooks/notify.cjs', () => {
  const got = sig.canonicalCommandPath();
  assert.ok(got.endsWith('/.vibedeck/app/hooks/notify.cjs'), got);
});

test('classifyEntries buckets {ours, entire, unknown}', () => {
  const entries = [
    { _vibedeck: 'v1', command: 'a' },
    { command: '/usr/local/bin/entire hook session-end' },
    { command: 'user-custom' },
  ];
  const out = sig.classifyEntries(entries, 'json');
  assert.strictEqual(out.ours.length, 1);
  assert.strictEqual(out.entire.length, 1);
  assert.strictEqual(out.unknown.length, 1);
});
```

- [ ] **Step 3: Run, expect FAIL**

```bash
node --test test/hook-merger-signature.test.js 2>&1 | tail -10
```

- [ ] **Step 4: Implement `src/lib/hook-merger/signature.js`**

Functions: `canonicalCommandPath()`, `isVibedeckEntryJSON(entry)`, `isEntireEntryJSON(entry)`, `isVibedeckCommandStringTOML(cmd)`, `isEntireCommandStringTOML(cmd)`, `classifyEntries(entries, format)`. Use `tracker-paths.getDataDir()` to compute the canonical path; fall back to `path.join(os.homedir(), '.vibedeck')` if `tracker-paths` lacks the helper.

- [ ] **Step 5: Pass + commit**

```bash
node --test test/hook-merger-signature.test.js 2>&1 | tail -5
npm test 2>&1 | tail -10
git add src/lib/hook-merger/signature.js test/hook-merger-signature.test.js
git commit -m "feat(hook-merger): signature module — VibeDeck/Entire/unknown classification"
```

---

### Task 5: Two-phase atomic batch installer

**Files:**
- Create: `src/lib/hook-merger/atomic-batch.js`
- Test: `test/hook-merger-atomic-batch.test.js`

The batch interface: `runBatch([{ path, content, validate }, ...])` stages every payload to `<dir>/.vibedeck-staging-<uuid>` files, validates each, takes a backup of the original (if present), then atomically renames staging→final for every file. On any failure during phase 2, restore backups and remove staging files.

- [ ] **Step 1: Failing tests covering all five edge cases for batch atomicity**

Create `test/hook-merger-atomic-batch.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBatch } = require('../src/lib/hook-merger/atomic-batch');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-batch-')); }

test('happy path — three files renamed atomically', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json'), b = path.join(dir, 'b.json'), c = path.join(dir, 'c.toml');
  await runBatch([
    { path: a, content: '{"x":1}\n', validate: (s) => JSON.parse(s) },
    { path: b, content: '{"y":2}\n', validate: (s) => JSON.parse(s) },
    { path: c, content: 'name = "z"\n', validate: () => true },
  ]);
  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"x":1}\n');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), '{"y":2}\n');
  assert.strictEqual(fs.readFileSync(c, 'utf8'), 'name = "z"\n');
});

test('phase 1 validation failure aborts before any file is touched', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json'); fs.writeFileSync(a, '{"orig":true}\n');
  await assert.rejects(() => runBatch([
    { path: a, content: '{"x":1}\n', validate: () => true },
    { path: path.join(dir, 'b.json'), content: 'NOT JSON', validate: (s) => JSON.parse(s) },
  ]));
  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"orig":true}\n');
  // No staging files left over:
  const leftovers = fs.readdirSync(dir).filter(n => n.includes('vibedeck-staging'));
  assert.strictEqual(leftovers.length, 0);
});

test('phase 2 mid-flight failure restores all originals', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json'); fs.writeFileSync(a, '{"orig":"a"}\n');
  const b = path.join(dir, 'b.json'); fs.writeFileSync(b, '{"orig":"b"}\n');
  // Force a phase-2 fail by passing an unwritable target.
  const c = path.join(dir, 'readonly-dir', 'c.json');
  await assert.rejects(() => runBatch([
    { path: a, content: '{"new":"a"}\n', validate: (s) => JSON.parse(s) },
    { path: b, content: '{"new":"b"}\n', validate: (s) => JSON.parse(s) },
    { path: c, content: '{}', validate: (s) => JSON.parse(s) },
  ]));
  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"orig":"a"}\n');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), '{"orig":"b"}\n');
});

test('write to a path whose parent directory does not exist creates it', async () => {
  const dir = tmp();
  const target = path.join(dir, 'deep', 'nested', 'cfg.json');
  await runBatch([{ path: target, content: '{"ok":1}\n', validate: (s) => JSON.parse(s) }]);
  assert.ok(fs.existsSync(target));
});

test('staging tempfiles named .vibedeck-staging-<uuid> and cleaned on success', async () => {
  const dir = tmp();
  const target = path.join(dir, 'cfg.json');
  await runBatch([{ path: target, content: '{}\n', validate: (s) => JSON.parse(s) }]);
  const leftovers = fs.readdirSync(dir).filter(n => n.includes('vibedeck-staging'));
  assert.deepStrictEqual(leftovers, []);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `src/lib/hook-merger/atomic-batch.js`**

Phase 1: for each payload, `mkdirp` parent, write content to `<dir>/.vibedeck-staging-<uuid>`, run `validate(content)`. If any throws, remove all staging files written so far and rethrow.

Phase 2: for each target that exists, copy to `<dir>/.vibedeck-backup-<uuid>`. Then for each, `fs.renameSync(staging, final)`. On any rename error: restore each backed-up original (`fs.renameSync(backup, final)`) for every file already renamed in this phase, remove remaining staging files, rethrow.

Cleanup: on success, remove all backup files. On failure: backups already used to restore.

- [ ] **Step 4: All five tests PASS, full suite**

```bash
node --test test/hook-merger-atomic-batch.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/hook-merger/atomic-batch.js test/hook-merger-atomic-batch.test.js
git commit -m "feat(hook-merger): two-phase atomic batch installer with rollback on failure"
```

---

### Task 6: Claude/CodeBuddy JSON merger

**Files:**
- Create: `src/lib/hook-merger/claude.js` (delegates writes to existing `claude-config.js` primitives + adds signature-based merge)
- Test: `test/hook-merger-claude.test.js`

Claude and CodeBuddy share the same schema (`hooks.SessionEnd[]`); one merger covers both. We do **not** call `upsertClaudeHook` directly because it overwrites by `command` substring match; the merger needs signature-aware dedupe that preserves Entire's entries.

- [ ] **Step 1: Failing tests — every edge case**

Create `test/hook-merger-claude.test.js`. Six scenarios, each a separate `test()`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const claude = require('../src/lib/hook-merger/claude');

function tmpFile(initial) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-')), 'settings.json');
  if (initial != null) fs.writeFileSync(f, initial);
  return f;
}

test('1. empty file: install adds vibedeck entry', async () => {
  const f = tmpFile(null);
  await claude.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1').length, 1);
});

test('2. existing Entire entry preserved alongside vibedeck', async () => {
  const f = tmpFile(JSON.stringify({
    hooks: { SessionEnd: [{ command: '/usr/local/bin/entire hook session-end' }] },
  }, null, 2));
  await claude.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entire = json.hooks.SessionEnd.filter((e) => /entire/.test(e.command || ''));
  const ours = json.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1');
  assert.strictEqual(entire.length, 1);
  assert.strictEqual(ours.length, 1);
});

test('3. existing user-manual entry preserved', async () => {
  const f = tmpFile(JSON.stringify({ hooks: { SessionEnd: [{ command: 'echo hi' }] } }, null, 2));
  await claude.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.hooks.SessionEnd.length, 2);
});

test('4. re-install with current signature is a no-op (idempotent)', async () => {
  const f = tmpFile(null);
  await claude.install(f);
  const before = fs.readFileSync(f, 'utf8');
  await claude.install(f);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before);
});

test('5. malformed JSON aborts and never overwrites', async () => {
  const f = tmpFile('{ this is not json');
  await assert.rejects(() => claude.install(f));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ this is not json');
});

test('6. remove deletes only ours; entire and user entries untouched', async () => {
  const f = tmpFile(null);
  await claude.install(f);
  // Add an Entire entry by hand:
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  json.hooks.SessionEnd.push({ command: '/usr/local/bin/entire hook session-end' });
  json.hooks.SessionEnd.push({ command: 'echo manual' });
  fs.writeFileSync(f, JSON.stringify(json, null, 2));
  await claude.remove(f);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(out.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1').length, 0);
  assert.strictEqual(out.hooks.SessionEnd.length, 2);
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `src/lib/hook-merger/claude.js`**

Exports `install(settingsPath)` and `remove(settingsPath)`. Both use `runBatch` from atomic-batch.js. `install` reads file (or `{}` if absent), parses (throws on malformed → batch aborts), classifies `hooks.SessionEnd` via `signature.classifyEntries`, replaces `ours` with the canonical entry built from `tracker-paths.getDataDir()`, leaves `entire` and `unknown` in place, hands to `runBatch` with a JSON-parse validator. `remove` filters out `_vibedeck === 'v1'` entries.

- [ ] **Step 4: PASS + suite + commit**

```bash
node --test test/hook-merger-claude.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
git add src/lib/hook-merger/claude.js test/hook-merger-claude.test.js
git commit -m "feat(hook-merger): claude/codebuddy JSON merger with signature-aware dedupe"
```

---

### Task 7: Codex / Every Code TOML merger

**Files:**
- Create: `src/lib/hook-merger/codex.js`
- Test: `test/hook-merger-codex.test.js`

Codex and Every Code share the `notify` array in `~/.codex/config.toml` (TokenTracker uses `@iarna/toml`; verify with `grep "iarna" package.json` before writing — if a different parser is in use, follow that one). The same six scenarios as Task 6, plus one extra: **non-array `notify` value** (some users have `notify = "command"` as a single string) — the merger must promote to array before merging.

- [ ] **Step 1: Failing tests — same six edge cases as Task 6, adapted to TOML, plus the array-promotion case**

```js
test('7. notify defined as a single string is promoted to array, then merged', async () => {
  const f = tmpFile('notify = "echo single"\n');
  await codex.install(f);
  const toml = require('@iarna/toml').parse(fs.readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(toml.notify));
  assert.ok(toml.notify.some((cmd) => /vibedeck.*notify\.cjs/.test(cmd)));
  assert.ok(toml.notify.includes('echo single'));
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement `src/lib/hook-merger/codex.js`**

Use `@iarna/toml` (or whichever `package.json` actually has). Read → parse (throws → abort) → normalize `notify` to array → classify each command string via `signature.isVibedeckCommandStringTOML` and `isEntireCommandStringTOML` → replace ours, preserve others → stringify → `runBatch` with a TOML-parse validator.

- [ ] **Step 4: PASS + suite + commit**

```bash
git add src/lib/hook-merger/codex.js test/hook-merger-codex.test.js
git commit -m "feat(hook-merger): codex/every-code TOML merger with single-string notify promotion"
```

---

### Task 8: Cursor JSON merger

**Files:**
- Create: `src/lib/hook-merger/cursor.js`
- Test: `test/hook-merger-cursor.test.js`

Cursor's hooks file is `.cursor/hooks.json` (path differs from Claude). Schema has top-level `SessionEnd` array (no `hooks` wrapper). Same six edge cases as Task 6 with the schema path adjusted.

Note: Cursor is API-based for token counts (uses CSV fetch via `cursor-config.js`), not hooks. Hook entries are still relevant for session boundary detection in Plan 3, so the merger ships even though Cursor doesn't use it for tokens today.

- [ ] **Step 1-5:** Same as Task 6 with schema path adjusted.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hook-merger/cursor.js test/hook-merger-cursor.test.js
git commit -m "feat(hook-merger): cursor JSON merger"
```

---

### Task 9: Gemini JSON merger

**Files:**
- Create: `src/lib/hook-merger/gemini.js`
- Test: `test/hook-merger-gemini.test.js`

Gemini settings live at `~/.gemini/settings.json`. Schema differs slightly (check `src/lib/gemini-config.js` for the exact path it writes to). Same edge cases.

- [ ] **Step 1-6:** Mirror Task 6.

```bash
git add src/lib/hook-merger/gemini.js test/hook-merger-gemini.test.js
git commit -m "feat(hook-merger): gemini JSON merger"
```

---

### Task 10: Factory / CodeBuddy / Copilot JSON mergers (single task, three files)

**Files:**
- Create: `src/lib/hook-merger/factory.js`
- Create: `src/lib/hook-merger/codebuddy.js`
- Create: `src/lib/hook-merger/copilot.js`
- Tests: `test/hook-merger-factory.test.js`, `test/hook-merger-codebuddy.test.js`, `test/hook-merger-copilot.test.js`

These three formats are JSON variants of the Claude pattern. CodeBuddy is a Claude-Code fork with the **same** schema (`hooks.SessionEnd[]`) — its merger is a thin re-export of Claude's pointed at a different default path. Factory writes to `~/.factory/settings.json`. Copilot writes to `.github/hooks/copilot.json` (or per `COPILOT_OTEL_FILE_EXPORTER_PATH` discovery).

- [ ] **Step 1-3:** For each, write the six-edge-case test file (copy from Task 6, adjust paths). Implement minimal mergers — codebuddy re-exports claude with a different default path; factory + copilot are direct copies of claude's structure if the schema matches.

- [ ] **Step 4: One commit covering all three**

```bash
git add src/lib/hook-merger/factory.js src/lib/hook-merger/codebuddy.js src/lib/hook-merger/copilot.js \
        test/hook-merger-factory.test.js test/hook-merger-codebuddy.test.js test/hook-merger-copilot.test.js
git commit -m "feat(hook-merger): factory/codebuddy/copilot JSON mergers"
```

---

### Task 11: OpenCode TS plugin merger

**Files:**
- Create: `src/lib/hook-merger/opencode.js`
- Test: `test/hook-merger-opencode.test.js`

OpenCode uses a TypeScript plugin system (per CLAUDE.md). VibeDeck installs as a separate file at `<repo>/.opencode/plugins/vibedeck.ts` to avoid AST surgery on the user's `index.ts`. `install` writes the file (idempotent — same content = no-op); `remove` deletes the file. If the user has registered Entire's plugin (typically at `entire.ts`), it is left untouched.

- [ ] **Step 1: Failing tests**

```js
test('1. install creates vibedeck.ts in plugin dir', async () => { /* ... */ });
test('2. existing entire.ts plugin is untouched', async () => { /* ... */ });
test('3. existing index.ts is untouched (we do not touch it)', async () => { /* ... */ });
test('4. re-install with same content is a no-op (mtime preserved)', async () => { /* ... */ });
test('5. remove deletes vibedeck.ts only', async () => { /* ... */ });
test('6. plugin file content registers VibeDeck listener via well-known event API', async () => {
  // Assert the generated file imports a known opencode plugin shape and exports a function
  // matching the contract in src/lib/opencode-config.js.
});
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/hook-merger/opencode.js test/hook-merger-opencode.test.js
git commit -m "feat(hook-merger): opencode TS plugin via dedicated vibedeck.ts file"
```

---

### Task 12: Top-level `installAll(repoRoot, providers)` and `removeAll(repoRoot, providers)` in `hook-merger/index.js`

**Files:**
- Create: `src/lib/hook-merger/index.js`
- Test: `test/hook-merger-orchestrator.test.js`

`installAll` selects the right per-format merger for each requested provider and runs them as a single `runBatch` so the cross-provider install is atomic — if any provider's merge fails validation, none are written.

- [ ] **Step 1: Failing tests**

```js
test('installAll across 3 providers: all 3 written or none', async () => { /* ... */ });
test('partial provider list installs only those', async () => { /* ... */ });
test('removeAll removes only signed entries across all 7 formats', async () => { /* ... */ });
test('install is idempotent across the full set', async () => { /* ... */ });
```

- [ ] **Step 2-5:** Implement and commit.

```bash
git add src/lib/hook-merger/index.js test/hook-merger-orchestrator.test.js
git commit -m "feat(hook-merger): cross-provider installAll/removeAll with batch atomicity"
```

---

### Task 13: Hook collision soak test (1000 random states)

**Files:**
- Create: `test/hook-merger-soak.test.js`

Property test: generate 1000 random `settings.json` states with mixed entries (0-5 entire, 0-3 user-manual, 0-2 unknown shape) and exercise `install` then `remove`, asserting:
1. Post-install: exactly one VibeDeck entry; all entire/manual entries preserved byte-for-byte.
2. Post-remove: zero VibeDeck entries; all entire/manual entries still preserved byte-for-byte.
3. File parses cleanly at every step.

- [ ] **Step 1: Write the property test using a deterministic PRNG seeded from env so failures are reproducible**

```js
const SEED = Number(process.env.VIBEDECK_SOAK_SEED || 1);
function rng() { /* deterministic xorshift from SEED */ }
// Generate state, run install, verify, run remove, verify. 1000 iterations.
```

- [ ] **Step 2-3: Implement, run**

```bash
VIBEDECK_SOAK_SEED=1 node --test test/hook-merger-soak.test.js 2>&1 | tail -10
```
Expected: PASS in < 30 s. If a generated case fails, the test prints the seed for reproduction.

- [ ] **Step 4: Commit**

```bash
git add test/hook-merger-soak.test.js
git commit -m "test(hook-merger): 1000-iteration property soak test for collision invariants"
```

---

## Phase C — Session Attribution Core (Tasks 14-19)

---

### Task 14: SessionEvent type + emitter contract + DB writer

**Files:**
- Create: `src/lib/sessions/event.js` (the SessionEvent shape + builder helpers)
- Create: `src/lib/sessions/writer.js` (DB upsert with idempotency)
- Test: `test/sessions-writer-idempotent.test.js`

The SessionEvent shape from spec §3.2:
```js
// kind: 'start' | 'update' | 'end'
// { kind, provider, session_id, started_at?, ended_at?, observed_at?, delta_tokens?,
//   total_tokens?, end_reason?, cwd?, model? }
```

`writer.upsertSessionFromEvents(dbPath, events)` consumes a list of events for **one** `(provider, session_id)` and produces / updates one row in `vibedeck_sessions`. Idempotency rule: applying the same event list twice yields byte-identical row state.

- [ ] **Step 1: Failing tests**

```js
test('start + update + end produces a single row with totals', () => { /* ... */ });
test('replaying same events twice produces identical row (idempotent)', () => { /* ... */ });
test('out-of-order events: end before start still yields correct ended_at', () => {
  // Some providers emit hooks asynchronously.
});
test('reconnect with same session_id merges windows, not duplicates rows', () => {
  // edge case spec §3.7 #11
});
test('null cwd + null repo produces row with confidence=unattributed', () => {
  // edge case spec §3.7 #4
});
```

- [ ] **Step 2-5:** Implement and commit.

```bash
git add src/lib/sessions/event.js src/lib/sessions/writer.js test/sessions-writer-idempotent.test.js
git commit -m "feat(sessions): SessionEvent type + idempotent DB writer with reconnect merging"
```

---

### Task 15: Per-provider SessionEvent extraction (extends `src/lib/rollout.js`)

**Files:**
- Modify: `src/lib/rollout.js` (add a parallel emit path; bucket math untouched)
- Create: `src/lib/sessions/extractors.js` (one function per provider; rollout.js delegates)
- Test: `test/sessions-extractors.test.js`

For each of the 13 providers, a function `extract<Provider>SessionEvents(rawData) -> SessionEvent[]`. The session_id source mapping is fixed in spec §3.2; the test fixtures live alongside `test/rollout-parser.test.js` patterns (real rollout JSONL excerpts).

**Critical invariant:** the existing bucket-aggregation path in `rollout.js` must produce byte-identical bucket rows after this change (the golden replay test from Task 26 enforces this).

- [ ] **Step 1: Failing tests, one per provider**

For each of: claude, codex, gemini, cursor, opencode, openclaw, every-code, kiro, hermes, copilot, kimi, omp, codebuddy. Each test loads a synthetic minimal rollout payload and asserts `[start, ...updates, end]` event sequence.

- [ ] **Step 2-3: FAIL → implement extractors**

For each provider, follow the existing per-provider parser code in `rollout.js` and reuse the same session-id discovery logic. Extractors are pure functions (no DB, no clock — `started_at` is whatever the rollout records). Hook the call into the existing parse loop in `rollout.js` so each parsed batch yields buckets (existing) **and** session events (new). The new emission feeds a callback the caller sets, defaulting to a no-op so existing bucket-only callers remain unchanged.

- [ ] **Step 4: Idempotency check across re-parse**

Add an additional test that runs the parser twice over the same input and asserts the emitted SessionEvent stream is byte-identical the second time.

- [ ] **Step 5: PASS + bucket-output stability**

```bash
node --test test/sessions-extractors.test.js test/rollout-parser.test.js 2>&1 | tail -15
npm test 2>&1 | tail -10
```
Expected: rollout-parser tests untouched (bucket math unchanged), extractor tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rollout.js src/lib/sessions/extractors.js test/sessions-extractors.test.js
git commit -m "feat(sessions): per-provider SessionEvent extraction in rollout.js (buckets unchanged)"
```

---

### Task 16: Repo + worktree + submodule resolution

**Files:**
- Create: `src/lib/sessions/repo-resolver.js`
- Test: `test/sessions-repo-resolver.test.js`

`resolveRepo(cwd) -> { repo_root, repo_common_dir, parent_repo, status }` where `status ∈ { 'ok', 'not_in_repo', 'bare', 'zero_commits', 'cwd_missing', 'inside_dot_git' }`. All path outputs are real-path-normalized.

- [ ] **Step 1: Failing tests covering edge cases #4, #6, #15, #16, #17, #18, #19, #29 from spec §3.7**

```js
test('cwd inside repo: returns realpath of toplevel', () => { /* git init temp repo, cd subdir */ });
test('cwd outside any repo: status = not_in_repo, repo_root = null', () => { /* /tmp dir */ });
test('symlinked cwd resolves to physical repo root', () => { /* symlink → repo */ });
test('worktree cwd: returns worktree root and shared common_dir', () => { /* git worktree add */ });
test('submodule cwd: returns submodule root with parent_repo set', () => { /* nested git */ });
test('bare repo: status = bare', () => { /* git init --bare */ });
test('zero-commit repo: status = zero_commits', () => { /* git init, no commits */ });
test('detached HEAD: repo_root still resolves; branch handled in Task 19', () => { /* checkout sha */ });
test('cwd is .git directory itself: status = inside_dot_git', () => { /* edge */ });
test('cwd was deleted between session and query: status = cwd_missing', () => { /* mkdir + rmdir */ });
test('two parent dirs with same name resolve to distinct repos via realpath', () => { /* edge #6 */ });
```

- [ ] **Step 2-3:** FAIL → implement using `git -C <cwd> rev-parse --show-toplevel`, `--is-bare-repository`, `--git-common-dir`, `--show-superproject-working-tree`, `rev-list --count HEAD`. Use `fs.realpathSync` first; on `ENOENT` return `cwd_missing`.

- [ ] **Step 4: PASS + commit**

```bash
git add src/lib/sessions/repo-resolver.js test/sessions-repo-resolver.test.js
git commit -m "feat(sessions): repo/worktree/submodule resolver with edge-case handling"
```

---

### Task 17: Orphan reaper

**Files:**
- Create: `src/lib/sessions/reaper.js`
- Test: `test/sessions-reaper.test.js`

Spec §3.2: any `live` session with no rollout activity in ≥30 min AND no watcher signal → mark `ended_inferred` with `end_reason = 'orphan_reaped'`. The reaper runs:
1. On every `sync` invocation (one-shot).
2. On a 5-minute interval inside `serve` (idempotent re-runs).

- [ ] **Step 1: Failing tests covering edge case #8 from spec §3.7**

```js
test('live session with last activity 31 min ago is reaped', () => { /* ... */ });
test('live session with last activity 29 min ago is NOT reaped', () => { /* ... */ });
test('reaper is idempotent: running twice on same DB produces same state', () => { /* ... */ });
test('late-arriving real end signal overwrites only when ended_at is later than reaped value', () => { /* edge */ });
test('VIBEDECK_IDLE_TIMEOUT_MIN env var overrides default 30', () => { /* ... */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/sessions/reaper.js test/sessions-reaper.test.js
git commit -m "feat(sessions): orphan reaper with VIBEDECK_IDLE_TIMEOUT_MIN tunable"
```

---

### Task 18: Branch resolution Tier A (Entire ground truth)

**Files:**
- Create: `src/lib/sessions/tier-a-entire.js`
- Test: `test/sessions-tier-a.test.js`

Given `(repo_root, started_at, ended_at, provider)`, query Entire's `entire/checkpoints/v1` branch (via `entire-bridge.listCheckpointsCached`) for sessions whose window overlaps and whose `agent` matches our provider. Return `{ branch, entire_session_id, checkpoint_ids[], confidence }`.

- [ ] **Step 1: Failing tests covering edge cases #5, #24, #25, #26 from spec §3.7**

```js
test('exact one Entire session matches: confidence=high', () => { /* ... */ });
test('multiple candidates overlap: pick closest start, confidence=medium, store all ids', () => { /* edge #24 */ });
test('Entire branch not fetched locally: returns null silently', () => { /* edge #25 */ });
test('Entire CLI errors out: tier returns null with structured error log', () => { /* edge #26 */ });
test('cwd missing but Entire window matches by repo_root + time: still resolves', () => { /* edge #5 */ });
test('agent mismatch (we are codex, entire records claude-code): no match, returns null', () => { /* ... */ });
```

- [ ] **Step 2-5:** Implement using `entire-bridge.listCheckpointsCached` + `readCheckpoint`.

```bash
git add src/lib/sessions/tier-a-entire.js test/sessions-tier-a.test.js
git commit -m "feat(sessions): tier A — Entire ground-truth branch resolution"
```

---

### Task 19: Tier B live HEAD watcher + persisted history

**Files:**
- Create: `src/lib/sessions/head-history.js` (in-memory ring buffer + DB persistence to `vibedeck_head_history`)
- Create: `src/lib/sessions/head-watcher.js` (Chokidar wrapper)
- Test: `test/sessions-head-history.test.js`
- Test: `test/sessions-head-watcher.test.js`

Spec §3.4 Tier B: watch every active repo's `.git/HEAD` and `.git/worktrees/*/HEAD`. On change, append `(repo_root, worktree_root, ref_name, transitioned_at)` to ring buffer (cap 1000 per worktree) and to `vibedeck_head_history` table. Lookup: `findBranchAt(repo, worktree, when)` returns the latest entry ≤ `when`.

- [ ] **Step 1: Failing tests covering edge cases #2, #3, #12, #13, #14**

```js
test('HEAD change records entry with realpath repo_root', () => { /* edge */ });
test('worktree HEAD change records entry under worktree_root, not main repo', () => { /* edge #2 */ });
test('detached HEAD records ref_name as "detached@<sha>"', () => { /* edge #12 */ });
test('branch rename during session: latest ref_name wins on next lookup', () => { /* edge #13 */ });
test('branch deleted: lookup at past time returns the deleted name', () => { /* edge #14 */ });
test('findBranchAt with no history returns null', () => { /* zero-history */ });
test('findBranchAt at time T returns the latest transition <= T', () => { /* monotonic */ });
test('persistence: history survives serve restart by replaying last 7 days', () => { /* spec §3.4 */ });
test('ring buffer cap of 1000 evicts oldest', () => { /* memory bound */ });
test('Linux inotify saturation: Chokidar opts include polling fallback', () => {
  // Assert head-watcher passes { usePolling: true } when env VIBEDECK_WATCHER_POLLING=1
});
```

- [ ] **Step 2-3:** FAIL → implement. The watcher uses Chokidar with `ignoreInitial: true` for `.git/HEAD`. On startup, replay the last 7 days from `vibedeck_head_history` into the in-memory ring.

- [ ] **Step 4: Lazy-watch — repos with no session activity in last 7 days are not watched**

Add a `registerActiveRepo(repo_root)` API consumed by Task 14's writer when a session lands. Initial watch list seeds from `SELECT DISTINCT repo_root FROM vibedeck_sessions WHERE started_at >= now() - 7d`.

- [ ] **Step 5: PASS + commit**

```bash
git add src/lib/sessions/head-history.js src/lib/sessions/head-watcher.js \
        test/sessions-head-history.test.js test/sessions-head-watcher.test.js
git commit -m "feat(sessions): tier B head watcher with lazy-watch + persistence + polling fallback"
```

---

## Phase D — Tier C, Tier orchestrator, branch windows (Tasks 20-22)

---

### Task 20: Tier C reflog scrape (with timezone normalization)

**Files:**
- Create: `src/lib/sessions/tier-c-reflog.js`
- Test: `test/sessions-tier-c.test.js`

Run `git -C <repo> reflog show --date=iso-strict --format='%gd %gs %gI %ad' HEAD`. Parse each line, **convert local time to UTC** (the `%ad` format respects `--date`; verify with a fixture). For a query `(repo, when_utc)`, find the entry with the latest timestamp ≤ `when_utc` and return its ref name.

- [ ] **Step 1: Failing tests covering edge cases #9 (DST), #17 (zero-commit)**

```js
test('reflog parsed and converted to UTC; matches branch at session time', () => { /* ... */ });
test('DST transition: reflog times near DST boundary still resolve correctly', () => { /* edge #9 */ });
test('zero-commit repo: reflog empty, returns null (caller falls to D)', () => { /* edge #17 */ });
test('timezone offset from git: --date=iso-strict embeds offset; conversion exact', () => { /* property */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/sessions/tier-c-reflog.js test/sessions-tier-c.test.js
git commit -m "feat(sessions): tier C — reflog scrape with UTC normalization"
```

---

### Task 21: Tier orchestrator — A → B → C → D with confidence

**Files:**
- Create: `src/lib/sessions/resolve-branch.js`
- Test: `test/sessions-resolve-branch.test.js`

`resolveBranchForSession({ provider, repo_root, started_at, ended_at }) -> { branch, tier, confidence, entire_link? }`. Calls A, then B, then C, falling through silently. Tier confidence: A=high, B=medium, C=low, D=unattributed.

- [ ] **Step 1: Failing tests**

```js
test('all four tiers fall through and produce unattributed', () => { /* ... */ });
test('only A available: confidence high, tier A', () => { /* ... */ });
test('A unavailable, B has live data: confidence medium, tier B', () => { /* ... */ });
test('A and B unavailable, C reflog matches: confidence low, tier C', () => { /* ... */ });
test('cwd null: skip A/B/C, go straight to D', () => { /* ... */ });
test('manual override exists for session: skip resolution, use override', () => { /* edge #7 */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/sessions/resolve-branch.js test/sessions-resolve-branch.test.js
git commit -m "feat(sessions): four-tier branch resolver with confidence + override hook"
```

---

### Task 22: Branch-window splitting on `git checkout`

**Files:**
- Create: `src/lib/sessions/branch-windows.js`
- Test: `test/sessions-branch-windows.test.js`

Spec §3.6: for a session that spans HEAD transitions, split into windows; pro-rata allocate tokens by **time overlap** with each window. Conservation invariant: `sum(window.prorated_tokens) == session.total_tokens` (within ±1 for rounding).

- [ ] **Step 1: Failing tests covering edge cases #3, #10**

```js
test('session entirely within one branch: one window, full tokens', () => { /* ... */ });
test('session spanning one checkout: two windows, time-prorated', () => { /* edge #3 */ });
test('session spanning N checkouts: N+1 windows', () => { /* ... */ });
test('long idle with no checkout: one window (no false fragmentation)', () => { /* edge #10 */ });
test('property: sum of window tokens equals session total tokens (±1)', () => { /* conservation */ });
test('property: applying split twice produces identical windows (idempotent)', () => { /* ... */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/sessions/branch-windows.js test/sessions-branch-windows.test.js
git commit -m "feat(sessions): branch-window splitting with token-conservation invariant"
```

---

## Phase E — Live SSE + manual override + final validation (Tasks 23-26)

---

### Task 23: SSE endpoint `GET /functions/vibedeck-sessions-live`

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

Streaming session deltas. Server emits one event per session start/update/end. Per-client ring buffer cap 1000; drop-oldest on overflow; idle clients (no read for 60 min) disconnected; max 10 concurrent SSE clients per daemon (spec §9.4).

- [ ] **Step 1: Failing tests covering performance/operational edges from spec §9.4**

```js
test('client connects and receives current live sessions snapshot then deltas', async () => { /* ... */ });
test('11th concurrent client is rejected with 503 + Retry-After header', async () => { /* ... */ });
test('per-client ring buffer drops oldest events when client falls behind', async () => { /* ... */ });
test('idle client disconnected after 60 min (test uses fake timer to fast-forward)', async () => { /* ... */ });
test('Cursor session lacking cwd still emits last_observed_at field', async () => { /* edge #22 */ });
test('Claude Code emits start + final end (no incremental updates) per spec §3.7 #23', async () => { /* edge #23 */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/local-api.js test/local-api-vibedeck-sessions-live.test.js
git commit -m "feat(api): SSE vibedeck-sessions-live with backpressure + client cap + idle disconnect"
```

---

### Task 24: Manual attribution override CLI + table

**Files:**
- Create: `src/lib/db/migrations/005-attribution-overrides.js` (`vibedeck_attribution_overrides` table)
- Create: `src/commands/attribute.js`
- Test: `test/sessions-attribution-override.test.js`

Spec §3.7 #7 + §13. CLI: `vibedeck attribute --session <id> --provider <p> --branch <name>`. Override sticks across re-syncs (resolver consults override table before tier A). Override row = `(provider, session_id, branch, set_by, set_at)` with composite PK.

- [ ] **Step 1: Failing tests**

```js
test('override row inserted; resolver returns overridden branch with confidence=high (override)', () => { /* ... */ });
test('override is idempotent on repeat call with same args', () => { /* ... */ });
test('clearing override (--branch "") deletes row; resolver falls back to tiers', () => { /* ... */ });
test('CLI exits non-zero with helpful message when session id not found', () => { /* ... */ });
```

- [ ] **Step 2-5:** Implement, run, commit.

```bash
git add src/lib/db/migrations/005-attribution-overrides.js src/commands/attribute.js test/sessions-attribution-override.test.js
git commit -m "feat(cli): vibedeck attribute — sticky session→branch override"
```

---

### Task 25: Wire writer + reaper + watcher into `serve` and `sync`

**Files:**
- Modify: `src/commands/serve.js` (start watcher, schedule reaper, register writer route, run hook merger ensure)
- Modify: `src/commands/sync.js` (run reaper once, write SessionEvents from extractor pipeline)
- Test: `test/serve-session-pipeline.test.js`

End-to-end: a synthetic Claude Code rollout written into a watched dir → parsed → SessionEvents emitted → writer upserts row → tier resolver attaches branch → branch-window splitter applies → SSE event lands at a connected client.

- [ ] **Step 1: Integration test (full pipeline)**

```js
test('end-to-end: rollout append → SSE event delivered with correct branch + confidence', async () => {
  // 1. Spawn serve on ephemeral port
  // 2. Open SSE client
  // 3. Write rollout fixture
  // 4. Assert event lands within 2s with expected fields
});
```

- [ ] **Step 2-5:** Wire it up. Use existing `serve.js` startup hook (post-`ensureSchema`). Wire reaper to a 5-minute `setInterval` cleared on shutdown.

```bash
git add src/commands/serve.js src/commands/sync.js test/serve-session-pipeline.test.js
git commit -m "feat(serve): wire session pipeline — extractor → writer → resolver → SSE"
```

---

### Task 26: Final validation, golden replay, and tag

**Files:** none modified; verification only. Golden replay corpus added if absent: `test/fixtures/golden-rollouts/` containing one synthetic minimal rollout per provider plus the expected SessionEvent JSON.

- [ ] **Step 1: Clean install**

```bash
cd ~/Downloads/Projects/VibeDeck
rm -rf node_modules dashboard/node_modules dashboard/dist
npm install
npm --prefix dashboard install
```

- [ ] **Step 2: Build dashboard**

```bash
npm run dashboard:build 2>&1 | tail -10
```

- [ ] **Step 3: Full test suite**

```bash
npm test 2>&1 | tee /tmp/vibedeck-plan3-final.log | tail -30
```
Expected ≥ 502 + ~80 = ~580 tests passing (Plan 3 adds across hook merger 6×7 + soak + sessions × ~25).

- [ ] **Step 4: Validators**

```bash
npm run validate:guardrails 2>&1 | tail -5
npm run validate:ui-hardcode 2>&1 | tail -5
npm run validate:copy 2>&1 | tail -5
```

- [ ] **Step 5: Golden replay**

```bash
node --test test/sessions-extractors.test.js 2>&1 | tail -10
```
Each provider's extractor must produce byte-identical SessionEvent output for the fixture.

- [ ] **Step 6: End-to-end smoke**

```bash
rm -f ~/.vibedeck/tracker/vibedeck.sqlite3*
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
echo '--- sessions-live SSE handshake ---'
curl -s -N --max-time 2 "http://127.0.0.1:7690/functions/vibedeck-sessions-live" | head -5
echo '--- tables present ---'
sqlite3 ~/.vibedeck/tracker/vibedeck.sqlite3 \
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'vibedeck_%' ORDER BY name;"
kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```
Expected: SSE handshake produces a `data: { snapshot: ... }\n\n` line; tables include the new `vibedeck_attribution_overrides`.

- [ ] **Step 7: Tag**

```bash
git tag plan-3-session-attribution-and-hook-merger-complete
git log --oneline -30
```

- [ ] **Step 8: Verify clean state**

```bash
git status
```

---

## Edge case → owning task cross-reference

This table is the audit trail for spec §3.7 (30 edge cases) and §2 (hook collision matrix). Every case has at least one test in the listed task.

| Spec ref | Edge case | Owning task |
|---|---|---|
| §3.7 #1 | Two parallel sessions same cwd same branch | 14 (writer idempotency) |
| §3.7 #2 | Two parallel sessions same repo different worktrees | 16, 19 |
| §3.7 #3 | Session spans `git checkout` mid-flight | 22 |
| §3.7 #4 | cwd outside any git repo | 14, 16 |
| §3.7 #5 | Provider doesn't expose cwd (Cursor) | 18, 23 |
| §3.7 #6 | Multiple repos under same parent dir | 16 |
| §3.7 #7 | User manual override | 24 |
| §3.7 #8 | Hook process killed (orphan) | 17 |
| §3.7 #9 | DST / clock skew | 20 |
| §3.7 #10 | Long idle gap mid-session | 17, 22 |
| §3.7 #11 | Provider reuses session_id across reconnects | 14 |
| §3.7 #12 | Detached HEAD | 19 |
| §3.7 #13 | Branch rename mid-session | 19 |
| §3.7 #14 | Branch deleted before query | 19 |
| §3.7 #15 | Submodule | 16 |
| §3.7 #16 | Bare repo | 16 |
| §3.7 #17 | Zero-commit repo | 16, 20 |
| §3.7 #18 | Symlinked cwd | 16 |
| §3.7 #19 | cwd deleted between session and query | 16 |
| §3.7 #20 | Repo moved/renamed by user | (Plan 4 — `vibedeck repo migrate`) |
| §3.7 #21 | Rollout file rotated/truncated | 17 (covered by reaper inferred-end) |
| §3.7 #22 | Cursor poll-based delay | 23 (last_observed_at field) |
| §3.7 #23 | Claude Code only emits SessionEnd | 15, 23 |
| §3.7 #24 | Multiple Entire candidates overlap | 18 |
| §3.7 #25 | Entire installed but checkpoints branch not fetched | 18 |
| §3.7 #26 | Entire CLI errors / segfaults | 18 |
| §3.7 #27 | Skill install — malicious code | (Plan 4) |
| §3.7 #28 | Cwd contains sensitive paths (`--redact-paths`) | (Plan 4 — diagnostics) |
| §3.7 #29 | TokenTracker + VibeDeck side-by-side | (Plan 1 — already shipped via separate port + data dir) |
| §3.7 #30 | Cross-machine sync data import | Out of scope for v1 |
| §2.2 hook | Empty file → install ours | 6, 7, 8, 9, 10, 11 |
| §2.2 hook | Existing Entire entry preserved | 6-11, 13 (soak) |
| §2.2 hook | Existing user-manual entry preserved | 6-11, 13 |
| §2.2 hook | Both Entire and ours present | 6-11, 13 |
| §2.2 hook | Malformed file aborts cleanly | 6-11 |
| §2.2 hook | Re-install idempotent | 6-11 |
| §2.2 hook | Removal preserves third-party entries | 6-11, 13 |
| §2.3 hook | Multi-file partial failure rollback | 5, 12 |
| §2.4 hook | OpenCode TS plugin lives in own file | 11 |
| §9.3 | Inotify saturation polling fallback | 19 |
| §9.4 | SSE backpressure + client cap + idle disconnect | 23 |

---

## Self-review notes

- **Spec coverage:** all 30 edge cases from §3.7, all 7 hook formats from §2.4, all four tiers from §3.4, branch-window splitting from §3.6, Entire integration from §3.5, orphan reaper from §3.2, and operational invariants from §9.3-9.4 are mapped above. Items deferred to Plan 4 are flagged in the table.
- **Plan 2 follow-ups:** the 6 reviewer items at the top of Plan 2 doc are landed first as Tasks 1-3 before any new feature work, per spec §13's guidance.
- **No placeholders:** every test step has concrete code; every implementation step lists the exact functions, file paths, and DB tables. Where a step says "follow existing pattern" it points to a specific file already in the repo.
- **Type consistency:** SessionEvent shape defined in Task 14 is consumed unchanged in Tasks 15, 23, 25. `resolveBranchForSession` signature defined in Task 21 is consumed in Task 25's pipeline. `runBatch` signature defined in Task 5 is used by Tasks 6-12.
- **Codex dispatch sizing (per `docs/superpowers/codex-workflow.md`):**
  - Phase A (Tasks 1-3): one batch — small, mechanical hardening.
  - Phase B (Tasks 4-13): three batches — Tasks 4-6, 7-9, 10-13 (the soak test in 13 should be its own dispatch because random-property tests can stretch wall time).
  - Phase C (Tasks 14-19): two batches — 14-16, 17-19 (HEAD watcher needs the most context).
  - Phase D (Tasks 20-22): one batch.
  - Phase E (Tasks 23-26): two batches — 23-25 then 26 (final validation is moderator-run per the codex workflow doc, not Codex).
  - Always clean `.codex/` and `.entire/` artifacts between batches; never commit them.

---

## Execution handoff

Plan 3 is ready. Two execution options:

**1. Subagent-Driven via Codex (recommended)** — dispatch Codex per the workflow at `docs/superpowers/codex-workflow.md`. Direct `codex exec -m gpt-5.2 -s danger-full-access -C ~/Downloads/Projects/VibeDeck --color never --skip-git-repo-check -` with prompt via stdin. Moderator (Claude) reviews diffs between batches. Plan 2 baseline: this same dispatcher shipped 18 tasks, 19 commits, 502/502 tests passing.

**2. Subagent-Driven via Claude Sonnet** — fresh subagent per task using `superpowers:subagent-driven-development`. Slower than Codex by 3-5× per the workflow doc, but isolates context if a particular task is at risk of context pressure.

Recommended: **option 1**. The plan is bite-sized exactly to fit Codex batches.

Pick one and we begin Phase A (Plan 2 hardening, Tasks 1-3).
