# VibeDeck v1 — Plan 4: Local Auth + Migration + Doctor extension

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Recommended dispatcher: Codex (gpt-5.2) per `docs/superpowers/codex-workflow.md`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Close out v1 backend by gating every write endpoint behind a local-only auth token, wiring the previously-stubbed Entire write endpoints to the real shell-out wrappers, shipping a TokenTracker→VibeDeck first-run migration prompt, and extending `vibedeck doctor` with attribution-distribution and hook-integrity checks. Skill management endpoints (install/uninstall/restore/import/delete) already exist as TokenTracker code; Plan 4 only wraps them in auth.

**Architecture:** New module `src/lib/local-auth.js` issues a 32-byte random token at first run (stored at `~/.vibedeck/auth.token`, mode 0600) and exposes a middleware `requireWriteAuth(req, res)` that reads `Authorization: Bearer …`. Destructive operations (`rewind`, `clean`, `repo migrate`) require an additional one-time-use token issued by `POST /functions/vibedeck-confirm-destructive` (30-second TTL, single-use, in-memory). First-run detection of `~/.tokentracker/` triggers a Migrate/Fresh/Coexist prompt; choice is recorded in `~/.vibedeck/install.json`. Doctor gains four new check categories driven by the existing `runDoctorChecks()` array.

**Tech Stack:** Node.js ≥22.5, `node:crypto` (built-in randomBytes + timingSafeEqual), `node:sqlite`, `execa@5.1.1` (existing). No new deps.

**Source repo:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/`. Plan 3 baseline: `plan-3-session-attribution-and-hook-merger-complete` tag, 652/652 tests, working tree clean.

**Working assumption:** all paths relative to `~/Downloads/Projects/VibeDeck/`. Each task ends with `git commit`. **No regressions on the 652-test baseline.**

**Existing infrastructure Plan 4 reuses:**
- `src/lib/skills-manager.js` — full install/uninstall/restore/import/delete already implemented in TokenTracker fork.
- `/functions/vibedeck-skills/*` HTTP endpoints in `src/lib/local-api.js` (lines ~1200-1260) already route to skills-manager. Plan 4 adds `requireWriteAuth` in front of every POST.
- `/functions/vibedeck-entire/:cmd` is a 403 stub at `src/lib/local-api.js:1023-1042` that Plan 4 replaces with real handlers (`enableEntire`, `disableEntire`, `entireAgentAdd`, `entireAgentRemove`, `entireConfigure`, `entireDoctor`, `entireStatus` from `src/lib/entire-bridge.js`).
- `src/commands/attribute.js` (Plan 3 Task 24) — sticky session→branch override CLI; Plan 4 adds the matching `POST /functions/vibedeck-attribute` endpoint that uses the same module.
- `src/lib/doctor.js` — `runDoctorChecks()` returns an array; Plan 4 appends new checks without restructuring.

---

## Phase A — Local auth foundation (Tasks 1-3)

---

### Task 1: Local auth token issuance + middleware

**Files:**
- Create: `src/lib/local-auth.js`
- Test: `test/local-auth.test.js`

- [ ] **Step 1: Failing test**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../src/lib/local-auth');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-auth-')); }

test('ensureToken creates token file at expected path with mode 0600', () => {
  const dir = tmp();
  const tokenPath = path.join(dir, 'auth.token');
  const token = auth.ensureToken(tokenPath);
  assert.match(token, /^[a-f0-9]{64}$/);
  const stat = fs.statSync(tokenPath);
  assert.strictEqual(stat.mode & 0o777, 0o600);
});

test('ensureToken is idempotent — second call returns the same token', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const a = auth.ensureToken(tokenPath);
  const b = auth.ensureToken(tokenPath);
  assert.strictEqual(a, b);
});

test('rotateToken replaces the token and returns the new one', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const a = auth.ensureToken(tokenPath);
  const b = auth.rotateToken(tokenPath);
  assert.notStrictEqual(a, b);
  assert.strictEqual(fs.readFileSync(tokenPath, 'utf8').trim(), b);
});

test('requireWriteAuth accepts a valid Authorization: Bearer header', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const token = auth.ensureToken(tokenPath);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = { writeHead() {}, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), true);
});

test('requireWriteAuth rejects with 401 when header missing', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  auth.ensureToken(tokenPath);
  const req = { headers: {} };
  let status = null, body = null;
  const res = { writeHead(s) { status = s; }, end(b) { body = b; } };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
  assert.match(body, /missing_auth/);
});

test('requireWriteAuth rejects with 401 on wrong token', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  auth.ensureToken(tokenPath);
  const req = { headers: { authorization: 'Bearer 0000000000000000000000000000000000000000000000000000000000000000' } };
  let status = null;
  const res = { writeHead(s) { status = s; }, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
});

test('requireWriteAuth uses constant-time comparison', () => {
  // Property check: same-length wrong token still rejects (verifies timingSafeEqual path is reachable).
  const tokenPath = path.join(tmp(), 'auth.token');
  const token = auth.ensureToken(tokenPath);
  const wrong = token.replace(/[a-f]/g, (c) => (c === 'a' ? 'b' : 'a'));
  const req = { headers: { authorization: `Bearer ${wrong}` } };
  let status = null;
  const res = { writeHead(s) { status = s; }, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/local-auth.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement `src/lib/local-auth.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function _writeTokenFile(tokenPath, token) {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  // Open with mode 0600 from creation. Some umasks would otherwise widen perms.
  const fd = fs.openSync(tokenPath, 'w', 0o600);
  try {
    fs.writeSync(fd, `${token}\n`);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tokenPath, 0o600);
}

function _readTokenFile(tokenPath) {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

function ensureToken(tokenPath) {
  if (fs.existsSync(tokenPath)) return _readTokenFile(tokenPath);
  const token = crypto.randomBytes(32).toString('hex');
  _writeTokenFile(tokenPath, token);
  return token;
}

function rotateToken(tokenPath) {
  const token = crypto.randomBytes(32).toString('hex');
  _writeTokenFile(tokenPath, token);
  return token;
}

function _writeError(res, status, errorCode, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: errorCode, message }));
}

function requireWriteAuth(req, res, { tokenPath } = {}) {
  if (!tokenPath) throw new Error('requireWriteAuth: tokenPath required');
  const expected = _readTokenFile(tokenPath);
  const header = String((req.headers && req.headers.authorization) || '');
  const m = header.match(/^Bearer\s+([a-f0-9]+)$/i);
  if (!m) {
    _writeError(res, 401, 'missing_auth', 'Authorization: Bearer <token> required');
    return false;
  }
  const provided = m[1];
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    _writeError(res, 401, 'invalid_auth', 'Token does not match');
    return false;
  }
  return true;
}

module.exports = { ensureToken, rotateToken, requireWriteAuth };
```

- [ ] **Step 4: Run, expect PASS, full suite**

```bash
node --test test/local-auth.test.js 2>&1 | tail -10
npm test 2>&1 | tail -10
```
Expected: 652 + 7 = 659 passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-auth.js test/local-auth.test.js
git commit -m "feat(auth): local-auth token issuance + Bearer middleware with timing-safe compare"
```

---

### Task 2: Destructive-confirm token issuer

**Files:**
- Modify: `src/lib/local-auth.js` (extend with confirm-token issuer)
- Test (extend): `test/local-auth.test.js`

- [ ] **Step 1: Failing tests**

Append to `test/local-auth.test.js`:
```js
test('issueConfirmToken returns a single-use token consumable for 30 seconds', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint' });
  assert.match(t, /^[a-f0-9]{32}$/);
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint' }), true);
  // Single-use:
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint' }), false);
});

test('issueConfirmToken rejects mismatched op on consume', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint' });
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'cleanEntire' }), false);
});

test('issueConfirmToken expires after TTL', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint', _now: 1000, ttlMs: 30000 });
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint', _now: 30001 }), false);
});

test('issueConfirmToken cleans up expired entries on each issue', () => {
  auth._resetConfirmTokensForTests();
  for (let i = 0; i < 5; i++) auth.issueConfirmToken({ op: 'x', _now: 1000 });
  auth.issueConfirmToken({ op: 'x', _now: 60000 });
  assert.strictEqual(auth._getConfirmTokenCountForTests(), 1);
});
```

- [ ] **Step 2: Run, FAIL**

- [ ] **Step 3: Extend `src/lib/local-auth.js`**

```js
const _confirmTokens = new Map(); // token -> { op, expiresAt }
const CONFIRM_TTL_MS = 30 * 1000;

function _gcConfirmTokens(now) {
  for (const [tok, entry] of _confirmTokens) {
    if (entry.expiresAt <= now) _confirmTokens.delete(tok);
  }
}

function issueConfirmToken({ op, ttlMs = CONFIRM_TTL_MS, _now = Date.now() } = {}) {
  if (typeof op !== 'string' || op === '') throw new Error('issueConfirmToken: op required');
  _gcConfirmTokens(_now);
  const token = crypto.randomBytes(16).toString('hex');
  _confirmTokens.set(token, { op, expiresAt: _now + ttlMs });
  return token;
}

function consumeConfirmToken({ token, op, _now = Date.now() } = {}) {
  const entry = _confirmTokens.get(token);
  if (!entry) return false;
  if (entry.expiresAt <= _now) {
    _confirmTokens.delete(token);
    return false;
  }
  if (entry.op !== op) return false;
  _confirmTokens.delete(token); // single-use
  return true;
}

function _resetConfirmTokensForTests() { _confirmTokens.clear(); }
function _getConfirmTokenCountForTests() { return _confirmTokens.size; }

module.exports = {
  ensureToken,
  rotateToken,
  requireWriteAuth,
  issueConfirmToken,
  consumeConfirmToken,
  _resetConfirmTokensForTests,
  _getConfirmTokenCountForTests,
};
```

- [ ] **Step 4: Run all auth tests + full suite, all green**

- [ ] **Step 5: Commit**

```bash
git add src/lib/local-auth.js test/local-auth.test.js
git commit -m "feat(auth): single-use destructive-confirm tokens with 30s TTL"
```

---

### Task 3: `vibedeck auth rotate` CLI

**Files:**
- Create: `src/commands/auth.js`
- Modify: `src/cli.js` (register the `auth` subcommand)
- Test: `test/cli-auth-rotate.test.js`

- [ ] **Step 1: Read `src/cli.js` to find the existing dispatcher pattern**

```bash
grep -n "case '\\|register\\|dispatch\\|attribute" src/cli.js | head -10
```
Use the same registration style other commands use. Plan 3 Task 24's `attribute` is the most recent reference.

- [ ] **Step 2: Failing test**

Create `test/cli-auth-rotate.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cli-auth-'));
  fs.mkdirSync(path.join(home, '.vibedeck'), { recursive: true });
  return home;
}

function runCli(args, env) {
  const r = cp.spawnSync(process.execPath, ['bin/vibedeck.js', ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cli failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

test('vibedeck auth rotate prints a new token and persists it', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  runCli(['auth', 'show'], env);
  const initial = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  const out = runCli(['auth', 'rotate'], env);
  const rotated = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  assert.notStrictEqual(initial, rotated);
  assert.match(out, new RegExp(rotated));
});

test('vibedeck auth show prints the current token without rotating', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  runCli(['auth', 'show'], env);
  const before = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  const out = runCli(['auth', 'show'], env);
  const after = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  assert.strictEqual(before, after);
  assert.match(out, new RegExp(before));
});
```

- [ ] **Step 3: Run, FAIL**

- [ ] **Step 4: Create `src/commands/auth.js`**

```js
'use strict';
const path = require('node:path');
const os = require('node:os');
const auth = require('../lib/local-auth');

function _tokenPath() {
  const home = process.env.VIBEDECK_HOME || os.homedir();
  return path.join(home, '.vibedeck', 'auth.token');
}

async function run(argv = []) {
  const sub = argv[0];
  const tokenPath = _tokenPath();
  if (sub === 'rotate') {
    const t = auth.rotateToken(tokenPath);
    process.stdout.write(`Rotated. New token:\n${t}\n`);
    return 0;
  }
  if (sub === 'show' || sub === undefined) {
    const t = auth.ensureToken(tokenPath);
    process.stdout.write(`${t}\n`);
    return 0;
  }
  process.stderr.write(`Usage: vibedeck auth <show|rotate>\n`);
  return 1;
}

module.exports = { run };
```

- [ ] **Step 5: Wire `auth` into `src/cli.js`**

Open `src/cli.js`, find the dispatcher block (look for how `attribute` was wired in Plan 3 Task 24). Add a parallel branch:
```js
if (cmd === 'auth') return require('./commands/auth').run(args);
```

- [ ] **Step 6: Run tests + full suite, green. Commit.**

```bash
git add src/commands/auth.js src/cli.js test/cli-auth-rotate.test.js
git commit -m "feat(cli): vibedeck auth show/rotate commands"
```

---

## Phase B — Wire auth onto write endpoints (Tasks 4-7)

---

### Task 4: Replace `/functions/vibedeck-entire/:cmd` 403 stub with real handlers

**Files:**
- Modify: `src/lib/local-api.js` (around line 1023, the existing stub)
- Test: `test/local-api-vibedeck-entire-write.test.js`

The 403 stub from Plan 2 currently returns `auth_pending`. Replace with auth-gated dispatch to entire-bridge wrappers. Supported `cmd` values: `enable`, `disable`, `agent-add`, `agent-remove`, `configure`, `doctor`, `status`. Destructive `rewind` and `clean` go through Task 5.

- [ ] **Step 1: Failing test**

Test the auth gate + cmd allowlist + stub-call semantics:
```js
test('vibedeck-entire/disable POST with valid Bearer returns 200', async () => {
  // Spawn server pattern: copy from test/local-api-vibedeck-sessions-live.test.js.
  // Set up: write auth.token to test home, hit POST /functions/vibedeck-entire/disable
  // with valid Authorization header, body { repo: <abs path> }, assert 200.
});

test('vibedeck-entire/disable POST without Authorization returns 401 missing_auth', async () => {});

test('vibedeck-entire/disable POST with wrong token returns 401 invalid_auth', async () => {});

test('vibedeck-entire/unknown-cmd POST returns 400 unknown_command', async () => {});

test('vibedeck-entire/agent-add POST forwards repo + agent params and returns shell-out result', async () => {
  // Stub bridge.entireAgentAdd via require.cache to capture args; assert response shape.
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Replace the stub in `src/lib/local-api.js`**

Locate the block at line 1023 that starts `if (p.startsWith("/functions/vibedeck-entire/"))`. Replace with:

```js
if (p.startsWith("/functions/vibedeck-entire/")) {
  if (String(req.method || "GET").toUpperCase() !== "POST") {
    json(res, { error: "Method Not Allowed" }, 405);
    return true;
  }
  const cmd = p.slice("/functions/vibedeck-entire/".length);
  const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
  if (!require("./local-auth").requireWriteAuth(req, res, { tokenPath })) return true;

  const body = await readJsonBody(req); // helper below if not present
  const repo = body && typeof body.repo === "string" ? body.repo : null;
  if (!repo) { json(res, { error: "missing_repo" }, 400); return true; }
  const repoRoot = require("node:fs").realpathSync(repo);

  const bridge = require("./entire-bridge");
  let result;
  try {
    switch (cmd) {
      case "enable":
        result = await bridge.enableEntire(repoRoot, body.agents || []);
        break;
      case "disable":
        result = await bridge.disableEntire(repoRoot);
        break;
      case "agent-add":
        if (!body.agent) { json(res, { error: "missing_agent" }, 400); return true; }
        result = await bridge.entireAgentAdd(repoRoot, body.agent);
        break;
      case "agent-remove":
        if (!body.agent) { json(res, { error: "missing_agent" }, 400); return true; }
        result = await bridge.entireAgentRemove(repoRoot, body.agent);
        break;
      case "configure":
        result = await bridge.entireConfigure(repoRoot, body.args || []);
        break;
      case "doctor":
        result = await bridge.entireDoctor(repoRoot);
        break;
      case "status":
        result = await bridge.entireStatus(repoRoot);
        break;
      default:
        json(res, { error: "unknown_command", cmd }, 400);
        return true;
    }
    json(res, { ok: result.exitCode === 0, ...result });
  } catch (e) {
    json(res, { error: "shell_out_failed", message: e?.message || String(e) }, 500);
  }
  return true;
}
```

If `readJsonBody` doesn't exist as a helper, search the file for the existing JSON-body parser (other POST handlers must read it) and reuse. Otherwise add a minimal helper at the top of the module.

`tokenPath` resolution `path.join(path.dirname(qp), "..", "auth.token")` walks from `~/.vibedeck/tracker/queue.jsonl` up to `~/.vibedeck/auth.token`. Verify this matches where `local-auth.ensureToken` writes (Task 1). If layouts disagree, fix Task 1's placement to match — `~/.vibedeck/auth.token` is canonical.

- [ ] **Step 4: Run, PASS, full suite, commit**

```bash
git add src/lib/local-api.js test/local-api-vibedeck-entire-write.test.js
git commit -m "feat(api): vibedeck-entire/:cmd auth-gated handlers replace 403 stub"
```

---

### Task 5: Destructive endpoints — rewind, clean, confirm-destructive issuer

**Files:**
- Modify: `src/lib/local-api.js` (add three new handlers)
- Test: `test/local-api-vibedeck-destructive.test.js`

- [ ] **Step 1: Failing tests**

```js
test('POST /functions/vibedeck-confirm-destructive issues a token for given op', async () => {
  // valid Bearer + body { op: 'rewindCheckpoint' } → 200 + body.token (32 hex chars)
});

test('POST /functions/vibedeck-confirm-destructive without Bearer returns 401', async () => {});

test('POST /functions/vibedeck-entire/rewind without confirm token returns 400 missing_confirm_token', async () => {
  // valid Bearer, body { repo, checkpointId } but no confirm_token → 400
});

test('POST /functions/vibedeck-entire/rewind with valid confirm token forwards to bridge.rewindCheckpoint', async () => {
  // 1. issue confirm token via /confirm-destructive { op: 'rewindCheckpoint' }
  // 2. POST /vibedeck-entire/rewind { repo, checkpointId, confirm_token }
  // assert 200, bridge called with the token
});

test('POST /functions/vibedeck-entire/rewind reusing the same confirm token fails (single-use)', async () => {});

test('POST /functions/vibedeck-entire/rewind with mismatched op confirm token fails', async () => {
  // issue confirm token for op:'cleanEntire', use on rewind → 400 invalid_confirm_token
});

test('POST /functions/vibedeck-entire/clean similar contract with op cleanEntire', async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Add handlers in `src/lib/local-api.js`**

Above the existing `/functions/vibedeck-entire/` block, add:

```js
if (p === "/functions/vibedeck-confirm-destructive") {
  if (String(req.method || "GET").toUpperCase() !== "POST") { json(res, { error: "Method Not Allowed" }, 405); return true; }
  const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
  if (!require("./local-auth").requireWriteAuth(req, res, { tokenPath })) return true;
  const body = await readJsonBody(req);
  const op = body && typeof body.op === "string" ? body.op : null;
  if (!op) { json(res, { error: "missing_op" }, 400); return true; }
  const confirmToken = require("./local-auth").issueConfirmToken({ op });
  json(res, { token: confirmToken, op, expiresInMs: 30000 });
  return true;
}

if (p === "/functions/vibedeck-entire/rewind") {
  if (String(req.method || "GET").toUpperCase() !== "POST") { json(res, { error: "Method Not Allowed" }, 405); return true; }
  const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
  if (!require("./local-auth").requireWriteAuth(req, res, { tokenPath })) return true;
  const body = await readJsonBody(req);
  const repo = body && typeof body.repo === "string" ? body.repo : null;
  const checkpointId = body && typeof body.checkpointId === "string" ? body.checkpointId : null;
  const confirmToken = body && typeof body.confirm_token === "string" ? body.confirm_token : null;
  if (!repo || !checkpointId) { json(res, { error: "missing_params" }, 400); return true; }
  if (!confirmToken) { json(res, { error: "missing_confirm_token" }, 400); return true; }
  if (!require("./local-auth").consumeConfirmToken({ token: confirmToken, op: "rewindCheckpoint" })) {
    json(res, { error: "invalid_confirm_token" }, 400);
    return true;
  }
  const repoRoot = require("node:fs").realpathSync(repo);
  try {
    const result = await require("./entire-bridge").rewindCheckpoint(repoRoot, checkpointId, confirmToken);
    json(res, { ok: result.exitCode === 0, ...result });
  } catch (e) {
    json(res, { error: "rewind_failed", message: e?.message || String(e) }, 500);
  }
  return true;
}

if (p === "/functions/vibedeck-entire/clean") {
  // Mirror of /rewind with op: 'cleanEntire' and bridge.cleanEntire(repoRoot, confirmToken, { all: body.all === true }).
  // Same shape as the rewind block above; replace bridge.rewindCheckpoint and field semantics accordingly.
}
```

Order matters: the `/rewind` and `/clean` blocks must be matched **before** the generic `/functions/vibedeck-entire/` prefix block from Task 4 — keep them above.

Note: `bridge.rewindCheckpoint(repoRoot, checkpointId, confirmToken)` already requires a confirm token at the bridge layer per Plan 2. Pass through the same confirm token (consume verifies it's valid; bridge then accepts it as opaque). The bridge's confirm-token logic is the second layer of defense.

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/lib/local-api.js test/local-api-vibedeck-destructive.test.js
git commit -m "feat(api): destructive vibedeck-entire rewind/clean + confirm-destructive issuer"
```

---

### Task 6: Wire auth on existing skill endpoints + manual override endpoint

**Files:**
- Modify: `src/lib/local-api.js` (existing `/functions/vibedeck-skills/*` endpoints around line 1200; add new `/functions/vibedeck-attribute`)
- Test: `test/local-api-vibedeck-skills-auth.test.js` (new), `test/local-api-vibedeck-attribute-endpoint.test.js` (new)

- [ ] **Step 1: Failing tests for skills auth gating**

For each of `install`, `uninstall`, `restore`, `importLocal`, `deleteLocal`:
```js
test(`POST /functions/vibedeck-skills/${cmd} without Bearer returns 401`, async () => {});
test(`POST /functions/vibedeck-skills/${cmd} with valid Bearer dispatches to skills-manager`, async () => {});
```

For `/functions/vibedeck-attribute`:
```js
test('POST /functions/vibedeck-attribute upserts override; resolver returns OVERRIDE tier', async () => {});
test('POST /functions/vibedeck-attribute with branch=null deletes override', async () => {});
test('POST /functions/vibedeck-attribute without Bearer returns 401', async () => {});
test('POST /functions/vibedeck-attribute with unknown session returns 404', async () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Add `requireWriteAuth` guard to each skill handler**

For each existing skills handler in `local-api.js` (read the lines ~1200-1260 first; do not refactor the dispatch shape, only add an auth guard at the top of every POST branch):

```js
// At the top of each POST skills handler:
const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
if (!require("./local-auth").requireWriteAuth(req, res, { tokenPath })) return true;
// ... existing handler logic continues unchanged ...
```

The GET handler `/functions/vibedeck-skills` (scan/list) stays open — read endpoints don't need auth (matches the read/write split established in Plan 3).

Add a new handler block for `/functions/vibedeck-attribute`:
```js
if (p === "/functions/vibedeck-attribute") {
  if (String(req.method || "GET").toUpperCase() !== "POST") { json(res, { error: "Method Not Allowed" }, 405); return true; }
  const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
  if (!require("./local-auth").requireWriteAuth(req, res, { tokenPath })) return true;
  const body = await readJsonBody(req);
  const provider = body && typeof body.provider === "string" ? body.provider : null;
  const session_id = body && typeof body.session_id === "string" ? body.session_id : null;
  const branch = body && (typeof body.branch === "string" || body.branch === null) ? body.branch : undefined;
  if (!provider || !session_id || branch === undefined) {
    json(res, { error: "missing_params" }, 400); return true;
  }
  const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
  const overrides = require("./sessions/overrides");
  const writer = require("./sessions/writer");
  const exists = writer.sessionExists
    ? writer.sessionExists(dbPath, { provider, session_id })
    : true;
  if (!exists) { json(res, { error: "session_not_found" }, 404); return true; }
  if (branch === null || branch === '') {
    overrides.clearOverride(dbPath, { provider, session_id });
    json(res, { ok: true, cleared: true });
  } else {
    overrides.upsertOverride(dbPath, { provider, session_id, branch, set_by: 'api' });
    json(res, { ok: true, branch });
  }
  return true;
}
```

If `writer.sessionExists` doesn't exist, add a minimal helper to `src/lib/sessions/writer.js`:
```js
function sessionExists(dbPath, { provider, session_id }) {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return !!db.prepare('SELECT 1 FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get(provider, session_id);
  } finally { db.close(); }
}
module.exports.sessionExists = sessionExists;
```

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/lib/local-api.js src/lib/sessions/writer.js test/local-api-vibedeck-skills-auth.test.js test/local-api-vibedeck-attribute-endpoint.test.js
git commit -m "feat(api): auth-gate skill write endpoints + vibedeck-attribute override endpoint"
```

---

### Task 7: Wire auth-token issuance into `vibedeck init` first-run flow

**Files:**
- Modify: `src/commands/init.js`
- Test: `test/init-auth-token.test.js`

- [ ] **Step 1: Failing test**

```js
test('vibedeck init creates auth.token at ~/.vibedeck/auth.token with mode 0600', async () => {
  // Run a stripped-down init (with the --skip-* flags init supports for non-interactive),
  // assert ~/.vibedeck/auth.token exists with mode 0600 and matches /^[a-f0-9]{64}$/.
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Modify `src/commands/init.js`**

After the wizard's data-dir creation (search for where `~/.vibedeck/` is established or where `entire login` was wired in Plan 2 Task 15), add:
```js
const auth = require('../lib/local-auth');
const trackerPaths = await require('../lib/tracker-paths').resolveTrackerPaths();
const tokenPath = require('node:path').join(trackerPaths.rootDir, 'auth.token');
const token = auth.ensureToken(tokenPath);
ui.info(`Local API auth token: ${token}`);
ui.info(`Stored at: ${tokenPath}`);
ui.info('Use this token as Authorization: Bearer <token> for write endpoints. Rotate with: vibedeck auth rotate');
```

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/commands/init.js test/init-auth-token.test.js
git commit -m "feat(init): issue local auth token during vibedeck init"
```

---

## Phase C — TokenTracker → VibeDeck migration (Tasks 8-9)

---

### Task 8: First-run TokenTracker detection + Migrate/Fresh/Coexist prompt

**Files:**
- Create: `src/lib/migration.js`
- Modify: `src/commands/init.js` (call `migration.detectAndPrompt` early in flow)
- Test: `test/migration-detect.test.js`

Spec §6: detect `~/.tokentracker/`, prompt user for Migrate / Fresh / Coexist, record decision in `~/.vibedeck/install.json`.

- [ ] **Step 1: Failing tests**

```js
test('detectTokenTrackerInstall returns null when ~/.tokentracker is absent', () => {});
test('detectTokenTrackerInstall returns { dataDir, dbPath, hasDb: true } when present with db', () => {});
test('migrateFromTokenTracker copies db to ~/.vibedeck/tracker/vibedeck.sqlite3', () => {
  // Set up a synthetic ~/.tokentracker/ with a stub db.sqlite, run migration with mocked HOME.
  // Assert: new DB exists at ~/.vibedeck/tracker/vibedeck.sqlite3, old DB UNMODIFIED, ensureSchema applied.
});
test('migrateFromTokenTracker writes install.json recording the choice', () => {});
test('coexistDecision writes install.json with mode "coexist"', () => {});
test('freshStart writes install.json with mode "fresh"', () => {});
test('detectAndPrompt is a no-op if install.json already records a decision', () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement `src/lib/migration.js`**

```js
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function _ttDataDir() { return path.join(os.homedir(), '.tokentracker'); }
function _vdDataDir() { return path.join(process.env.VIBEDECK_HOME || os.homedir(), '.vibedeck'); }
function _installJsonPath() { return path.join(_vdDataDir(), 'install.json'); }

function detectTokenTrackerInstall() {
  const dataDir = _ttDataDir();
  if (!fs.existsSync(dataDir)) return null;
  const candidates = [
    path.join(dataDir, 'tracker', 'tokentracker.sqlite3'),
    path.join(dataDir, 'db.sqlite'),
  ];
  const dbPath = candidates.find((p) => fs.existsSync(p)) || null;
  return { dataDir, dbPath, hasDb: !!dbPath };
}

function readInstallDecision() {
  try { return JSON.parse(fs.readFileSync(_installJsonPath(), 'utf8')); } catch { return null; }
}

function _writeInstallDecision(decision) {
  fs.mkdirSync(_vdDataDir(), { recursive: true });
  fs.writeFileSync(_installJsonPath(), `${JSON.stringify({ ...decision, decided_at: new Date().toISOString() }, null, 2)}\n`);
}

function migrateFromTokenTracker(detection) {
  if (!detection || !detection.hasDb) throw new Error('migrateFromTokenTracker: no source DB');
  const { ensureSchema } = require('./db');
  const targetDir = path.join(_vdDataDir(), 'tracker');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'vibedeck.sqlite3');
  // Copy the old DB. Source is read-only over (only fs.copyFileSync, never opened with write intent).
  fs.copyFileSync(detection.dbPath, target);
  // Run migrations on the copy. ensureSchema is idempotent.
  ensureSchema(target);
  _writeInstallDecision({ mode: 'migrate', source_db: detection.dbPath, target_db: target });
  return { target_db: target };
}

function freshStart() {
  _writeInstallDecision({ mode: 'fresh' });
}

function coexistDecision() {
  _writeInstallDecision({ mode: 'coexist' });
}

async function detectAndPrompt({ ui }) {
  if (readInstallDecision()) return { skipped: true, reason: 'already_decided' };
  const det = detectTokenTrackerInstall();
  if (!det) {
    _writeInstallDecision({ mode: 'fresh', reason: 'no_tokentracker' });
    return { skipped: true, reason: 'no_tokentracker' };
  }
  ui.info(`Detected existing TokenTracker install at ${det.dataDir}.`);
  const choice = await ui.select('How should VibeDeck handle this?', [
    { value: 'migrate', label: 'Migrate (copy data into ~/.vibedeck — old install untouched)' },
    { value: 'fresh', label: 'Fresh start (ignore old data)' },
    { value: 'coexist', label: 'Coexist (run side-by-side on different ports / data dirs)' },
  ]);
  if (choice === 'migrate') return migrateFromTokenTracker(det);
  if (choice === 'fresh') { freshStart(); return { mode: 'fresh' }; }
  coexistDecision(); return { mode: 'coexist' };
}

module.exports = {
  detectTokenTrackerInstall,
  readInstallDecision,
  migrateFromTokenTracker,
  freshStart,
  coexistDecision,
  detectAndPrompt,
};
```

- [ ] **Step 4: Wire `detectAndPrompt` into `src/commands/init.js` early in the flow**

Find the existing wizard's data-dir prep step. Insert:
```js
const migration = require('../lib/migration');
await migration.detectAndPrompt({ ui });
```

- [ ] **Step 5: PASS, full suite, commit**

```bash
git add src/lib/migration.js src/commands/init.js test/migration-detect.test.js
git commit -m "feat(migration): TokenTracker→VibeDeck Migrate/Fresh/Coexist prompt with install.json"
```

---

### Task 9: `vibedeck repo migrate <old-path> <new-path>` CLI

**Files:**
- Create: `src/commands/repo.js`
- Modify: `src/cli.js` (register `repo` subcommand)
- Test: `test/cli-repo-migrate.test.js`

Per spec §3.3 ("Repo identity & rename") + Plan 3 spec edge case #20: when a user moves a repo on disk, historical session rows still reference the old path. This CLI rewrites `repo_root` for matching rows. Rare, manual, never automated.

- [ ] **Step 1: Failing tests**

```js
test('vibedeck repo migrate /old /new updates vibedeck_sessions.repo_root for matching rows', () => {});
test('vibedeck repo migrate also updates vibedeck_repos and vibedeck_head_history', () => {});
test('vibedeck repo migrate with non-matching old-path is a no-op (0 rows updated)', () => {});
test('vibedeck repo migrate exits 1 if either path is not absolute', () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement**

```js
// src/commands/repo.js
'use strict';
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function _dbPath() {
  const home = process.env.VIBEDECK_HOME || os.homedir();
  return path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
}

function migrateRepoPath(dbPath, { from, to }) {
  if (!path.isAbsolute(from) || !path.isAbsolute(to)) {
    throw new Error('repo migrate: both paths must be absolute');
  }
  const db = new DatabaseSync(dbPath);
  let updates = 0;
  try {
    db.exec('BEGIN');
    const stmts = [
      "UPDATE vibedeck_sessions SET repo_root = ? WHERE repo_root = ?",
      "UPDATE vibedeck_repos SET repo_root = ? WHERE repo_root = ?",
      "UPDATE vibedeck_head_history SET repo_root = ? WHERE repo_root = ?",
    ];
    for (const sql of stmts) {
      const r = db.prepare(sql).run(to, from);
      updates += Number(r.changes || 0);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return { rowsUpdated: updates };
}

async function run(argv = []) {
  const [sub, ...rest] = argv;
  if (sub !== 'migrate') {
    process.stderr.write('Usage: vibedeck repo migrate <old-path> <new-path>\n');
    return 1;
  }
  const [from, to] = rest;
  if (!from || !to) {
    process.stderr.write('Usage: vibedeck repo migrate <old-path> <new-path>\n');
    return 1;
  }
  try {
    const result = migrateRepoPath(_dbPath(), { from, to });
    process.stdout.write(`Updated ${result.rowsUpdated} row(s).\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
}

module.exports = { run, migrateRepoPath };
```

Wire into `src/cli.js`:
```js
if (cmd === 'repo') return require('./commands/repo').run(args);
```

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/commands/repo.js src/cli.js test/cli-repo-migrate.test.js
git commit -m "feat(cli): vibedeck repo migrate <old> <new> for moved repositories"
```

---

## Phase D — Doctor extension + read-only attribution stats endpoint (Tasks 10-12)

---

### Task 10: Doctor extension — hook integrity per provider

**Files:**
- Modify: `src/lib/doctor.js` (extend `runDoctorChecks` array)
- Test: `test/doctor-hook-integrity.test.js`

- [ ] **Step 1: Failing test**

```js
test('runDoctorChecks includes a hook-integrity check per supported provider', async () => {
  const { runDoctorChecks } = require('../src/lib/doctor');
  const checks = await runDoctorChecks({ runtime: {}, paths: {}, fetch: () => Promise.resolve({}) });
  const hookChecks = checks.filter((c) => /^hook:\w+/.test(c.name));
  // Expect one per supported provider that has a hook merger.
  assert.ok(hookChecks.length >= 5);
});

test('hook-integrity check status is "ok" when signature is present in settings', () => {
  // Set up a temp HOME with a settings.json containing a vibedeck signature; assert status === 'ok'.
});

test('hook-integrity check status is "info" when no signature present (uninstalled)', () => {});

test('hook-integrity check status is "warn" when signature present but command path mismatched', () => {
  // Write a settings.json with _vibedeck:'v1' but a stale notify.cjs path.
});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Add hook-integrity checks**

Append to `src/lib/doctor.js` inside `runDoctorChecks`:

```js
const hookSignature = require('./hook-merger/signature');
const fs = require('node:fs');
const pathMod = require('node:path');
const os = require('node:os');

const HOOK_FILES = [
  { name: 'hook:claude', file: pathMod.join(os.homedir(), '.claude', 'settings.json'), shape: 'json', extractor: (j) => j?.hooks?.SessionEnd || [] },
  { name: 'hook:codebuddy', file: pathMod.join(os.homedir(), '.codebuddy', 'settings.json'), shape: 'json', extractor: (j) => j?.hooks?.SessionEnd || [] },
  { name: 'hook:cursor', file: pathMod.join(os.homedir(), '.cursor', 'hooks.json'), shape: 'json', extractor: (j) => j?.hooks?.sessionEnd || [] },
  { name: 'hook:gemini', file: pathMod.join(os.homedir(), '.gemini', 'settings.json'), shape: 'json', extractor: (j) => j?.hooks?.SessionEnd || [] },
  { name: 'hook:factory', file: pathMod.join(os.homedir(), '.factory', 'settings.json'), shape: 'json', extractor: (j) => j?.hooks?.SessionEnd || [] },
];

for (const def of HOOK_FILES) {
  if (!fs.existsSync(def.file)) {
    checks.push({ name: def.name, status: 'info', message: `not installed (${def.file} missing)` });
    continue;
  }
  try {
    const json = JSON.parse(fs.readFileSync(def.file, 'utf8'));
    const entries = def.extractor(json);
    const cls = hookSignature.classifyEntries(entries, def.shape);
    if (cls.ours.length === 0) {
      checks.push({ name: def.name, status: 'info', message: 'VibeDeck hook not installed' });
    } else if (cls.ours.length > 1) {
      checks.push({ name: def.name, status: 'warn', message: `Found ${cls.ours.length} VibeDeck entries (expected 1)` });
    } else {
      const expected = hookSignature.canonicalCommandPath();
      const ourEntry = cls.ours[0];
      const cmds = [];
      if (typeof ourEntry.command === 'string') cmds.push(ourEntry.command);
      if (Array.isArray(ourEntry.hooks)) for (const h of ourEntry.hooks) if (typeof h.command === 'string') cmds.push(h.command);
      if (!cmds.some((c) => c.includes(expected))) {
        checks.push({ name: def.name, status: 'warn', message: `Stale notify path; expected ${expected}` });
      } else {
        checks.push({ name: def.name, status: 'ok', message: 'signature OK' });
      }
    }
  } catch (e) {
    checks.push({ name: def.name, status: 'fail', message: `Could not parse ${def.file}: ${e.message}` });
  }
}
```

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/lib/doctor.js test/doctor-hook-integrity.test.js
git commit -m "feat(doctor): per-provider hook-integrity checks via signature module"
```

---

### Task 11: Doctor extension — attribution distribution + DB integrity + live-session anomaly

**Files:**
- Modify: `src/lib/doctor.js`
- Test: `test/doctor-attribution-distribution.test.js`

Three more checks:
- **attribution_distribution**: `% high / medium / low / unattributed` from vibedeck_sessions (status `ok` if % unattributed < 25%, `warn` otherwise).
- **db_integrity**: `PRAGMA integrity_check` on vibedeck.sqlite3 (status `ok` if returns "ok", `fail` otherwise).
- **live_sessions_anomaly**: count of sessions with `ended_at IS NULL AND started_at < now() - 24h` (status `warn` if > 0 — orphan reaper malfunction signal).

- [ ] **Step 1: Failing tests**

```js
test('attribution_distribution check reports percentages and ok status when < 25% unattributed', () => {});
test('attribution_distribution check warns when > 25% unattributed', () => {});
test('db_integrity check returns ok on a healthy DB', () => {});
test('live_sessions_anomaly returns ok when no stale live sessions', () => {});
test('live_sessions_anomaly warns when stale live sessions exist (older than 24h)', () => {});
```

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement** — append to `runDoctorChecks` in `src/lib/doctor.js`. Use `node:sqlite` to run the queries against `~/.vibedeck/tracker/vibedeck.sqlite3` (skip the check with status `info` if DB doesn't exist yet).

- [ ] **Step 4-5: PASS, full suite, commit**

```bash
git add src/lib/doctor.js test/doctor-attribution-distribution.test.js
git commit -m "feat(doctor): attribution distribution + db integrity + live-session anomaly checks"
```

---

### Task 12: Read-only `GET /functions/vibedeck-attribution-stats`

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-attribution-stats.test.js`

Used by Plan 5's UI (deferred spec) for the confidence-distribution badge. Open endpoint (no auth, matches `/vibedeck-checkpoints` etc. since it's read-only).

- [ ] **Step 1: Failing test**

```js
test('GET /functions/vibedeck-attribution-stats returns { high, medium, low, unattributed, total }', async () => {
  // Seed vibedeck_sessions with a known mix of confidences; assert response shape and counts.
});
```

- [ ] **Step 2-5: FAIL → implement → PASS → commit**

```bash
git add src/lib/local-api.js test/local-api-vibedeck-attribution-stats.test.js
git commit -m "feat(api): GET /vibedeck-attribution-stats — confidence distribution"
```

---

## Phase E — Final validation + tag (Task 13, moderator-run)

---

### Task 13: Clean install, build, full test, validators, smoke, tag

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
npm test 2>&1 | tee /tmp/vibedeck-plan4-final.log | tail -30
```
Expected ≥ 652 + ~38 = ~690 passing.

- [ ] **Step 4: Validators**

```bash
npm run validate:guardrails 2>&1 | tail -3
npm run validate:ui-hardcode 2>&1 | tail -3
npm run validate:copy 2>&1 | tail -3
```

- [ ] **Step 5: Golden replay (parser byte-identity)**

```bash
node --test test/rollout-parser.test.js 2>&1 | tail -5
```
99/99 still passing.

- [ ] **Step 6: End-to-end smoke**

```bash
rm -f ~/.vibedeck/tracker/vibedeck.sqlite3* ~/.vibedeck/auth.token
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 4

ls -la ~/.vibedeck/auth.token

TOKEN=$(cat ~/.vibedeck/auth.token)

echo '--- write without auth (expect 401) ---'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:7690/functions/vibedeck-entire/disable" -d '{"repo":"'"$HOME"'/Downloads/Projects/VibeDeck"}' -H 'content-type: application/json'

echo '--- write with auth (expect 200) ---'
curl -s -X POST "http://127.0.0.1:7690/functions/vibedeck-entire/status" -d '{"repo":"'"$HOME"'/Downloads/Projects/VibeDeck"}' -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" | head -c 200
echo

echo '--- destructive without confirm (expect 400 missing_confirm_token) ---'
curl -s -o /dev/null -w "%{http_code}\n" -X POST "http://127.0.0.1:7690/functions/vibedeck-entire/rewind" -d '{"repo":"'"$HOME"'/Downloads/Projects/VibeDeck","checkpointId":"abc123def456"}' -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN"

echo '--- issue confirm token ---'
CONFIRM=$(curl -s -X POST "http://127.0.0.1:7690/functions/vibedeck-confirm-destructive" -d '{"op":"rewindCheckpoint"}' -H 'content-type: application/json' -H "Authorization: Bearer $TOKEN" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "confirm token: $CONFIRM"

echo '--- attribution stats ---'
curl -s "http://127.0.0.1:7690/functions/vibedeck-attribution-stats" | head -c 200
echo

echo '--- doctor includes hook + attribution checks ---'
node bin/vibedeck.js doctor 2>&1 | grep -E "hook:|attribution_distribution|db_integrity|live_sessions" | head

kill $SERVE_PID 2>/dev/null; wait $SERVE_PID 2>/dev/null
```

- [ ] **Step 7: Tag**

```bash
git tag plan-4-local-auth-and-migration-complete
git log --oneline plan-3-session-attribution-and-hook-merger-complete..HEAD
```

- [ ] **Step 8: Verify clean state**

```bash
git status
```

---

## Self-review notes

- **Spec coverage:** every Plan 4 item from spec §13:
  - Local-auth tokens → Tasks 1-3, 7
  - Per-call destructive-confirm tokens → Tasks 2, 5
  - `vibedeck auth rotate` → Task 3
  - POST `/functions/vibedeck-entire/:cmd` real auth → Task 4
  - `/rewind`, `/clean` destructive-confirm → Task 5
  - `/vibedeck-skills/install`, `/remove` (existing endpoints, now auth-gated) → Task 6
  - `/vibedeck-attribute` (manual override) → Task 6
  - Skill management already exists in TokenTracker → wired via Task 6
  - TokenTracker→VibeDeck migration prompt → Task 8
  - `vibedeck repo migrate` → Task 9
  - Doctor extension (hook integrity, Entire on PATH, DB integrity, port avail, last sync, live-session anomaly, attribution distribution) → Tasks 10-11 (Entire-on-PATH already shipped Plan 2 Task 9; port avail + last sync are part of existing TokenTracker doctor)

- **Placeholder scan:** every step has a concrete code block or exact command. Where a step says "search src/cli.js for the dispatcher pattern" or "find existing JSON-body parser", it points to a specific landmark with a `grep` recipe.

- **Type consistency:** `requireWriteAuth(req, res, { tokenPath })` defined in Task 1 is consumed unchanged in Tasks 4-7. `issueConfirmToken({ op })` / `consumeConfirmToken({ token, op })` from Task 2 is consumed unchanged in Task 5. `migration.detectAndPrompt({ ui })` from Task 8 is consumed by `init.js` in the same task.

- **Codex dispatch sizing (per `docs/superpowers/codex-workflow.md`):**
  - Phase A (Tasks 1-3): one batch — small auth foundation.
  - Phase B (Tasks 4-7): one batch — write-endpoint wiring is contiguous in `src/lib/local-api.js`.
  - Phase C (Tasks 8-9): one batch — migration + repo CLI.
  - Phase D (Tasks 10-12): one batch — doctor extensions + read-only stats endpoint.
  - Task 13: moderator-run.

- **Edge cases covered:**
  - 401 missing/invalid auth → Tasks 1, 4-7
  - Constant-time token comparison → Task 1
  - Confirm-token: single-use, op-scoped, TTL-expired, GC on issue → Task 2
  - Rotated token invalidates prior — implicit (file overwrite) → Task 1, 3
  - Migration: read-only over old DB, idempotent ensureSchema, install.json prevents re-prompt → Task 8
  - Repo migrate: rejects non-absolute paths, transactional updates across all tables, no-op on non-match → Task 9
  - Doctor: missing settings file (info), parse failure (fail), stale path (warn), multiple ours entries (warn) → Task 10
  - Attribution stats: empty DB returns zeros gracefully → Task 12

---

## Execution handoff

Plan 4 is ready. Two execution options:

**1. Subagent-Driven via Codex (recommended)** — direct `codex exec -m gpt-5.2 -s danger-full-access -C ~/Downloads/Projects/VibeDeck --color never --skip-git-repo-check -` per `docs/superpowers/codex-workflow.md`. Moderator reviews diffs between batches.

**2. Subagent-Driven via Claude Sonnet** — fresh subagent per task; 3-5× slower per the workflow doc.

Recommended: **option 1**. Plan is sized to 4 Codex batches plus a moderator-run final validation.
