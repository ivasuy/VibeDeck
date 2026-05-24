# Tier 1+2 Provider Breadth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete Phase 2 provider breadth by preserving proof-backed cwd/workspace attribution for existing Tier 1+2 parsers, adding Goose and Crush ingestion, surfacing provider/attribution quality safely, and proving `/dashboard`, `/usage`, `/branches`, Unknown branch, and Historical unknown remain consistent.

**Architecture:** Keep VibeDeck's canonical `SessionEvent -> vibedeck_sessions -> session buckets -> branch usage facts` pipeline as the only write path for project, branch, token, and cost data. New or repaired provider adapters emit normal session events with raw cwd only when the provider source proves a local path; otherwise they emit provider-only/unattributed events and label attribution quality honestly. Existing Claude/Codex and Phase 1.5 grouping totals must not change.

**Tech Stack:** Node.js CommonJS, `node:test`, `node:sqlite`/`sqlite3` CLI, existing VibeDeck rollout parser conventions, SQLite migrations already in place through 013, React/Vite dashboard, SwiftUI Mac app provider icon helpers.

---

## Runtime Rules

- Work in `.worktrees/phase-2-tier-1-2-provider-breadth` on branch `agent/phase-2-tier-1-2-provider-breadth`.
- Do not implement on `main`.
- Use exactly one implementer and one reviewer per task.
- Implementer model: `gpt-5.5`, reasoning effort `high`.
- Reviewer model: `gpt-5.5`, reasoning effort `xhigh`.
- The same implementer/reviewer identities must handle all revisions for their task.
- Implementer must commit before returning `GREEN`.
- Do not change pricing semantics or branch-resolution tiers except by feeding proven `cwd` through the existing resolver.
- Do not remove or relabel `Unknown branch` or `Historical unknown` rows.
- Do not infer provider grouping or parent-child relationships in this phase unless a provider exposes explicit proof. Goose and Crush are `grouping_support="none"`.

## Phase 2 Scope Decision

The repository already contains shipped parsers for several Phase 2 providers: OpenCode JSON/SQLite, Pi, OMP, Cursor account CSV, Kiro IDE, Kiro CLI, and Copilot CLI OTEL. The safe Phase 2 work is therefore:

- Repair cwd pass-through where existing parsers currently drop proof: OpenCode JSON/SQLite, OMP, Pi, Copilot OTEL, Kiro CLI session JSON.
- Add the two missing strongest local providers: Goose and Crush.
- Keep Cursor API account CSV as account-level provider-only data. Cursor IDE local composer mapping is not implemented in current code and must not be faked from account CSV. If Cursor IDE local workspace mapping is discovered later, it gets a separate adapter.
- Add attribution-quality labels and provider registry surfaces so mapped/provider-only rows are visually honest.

## File Structure

- Create `src/lib/provider-registry.js`: provider metadata, Phase 2 visibility/flag helpers, attribution-quality helper labels, provider display names.
- Modify `src/lib/source-metadata.js`: consume provider registry for account-level/local scope and expose attribution quality helpers without changing default rollups.
- Modify `src/lib/sessions/extractors.js`: allow Cursor/Copilot/OMP/Pi/Kiro/OpenCode adapters to pass through `batch.cwd` when present; export a new `extractPiSessionEvents`, `extractGooseSessionEvents`, and `extractCrushSessionEvents`.
- Modify `src/lib/rollout.js`: cwd extraction helpers; OpenCode DB `onSessionEvent`; OMP/Pi header cwd capture; Copilot workspace attr extraction; Kiro CLI session-event emission when cwd exists; Goose SQLite reader/parser; Crush registry/SQLite reader/parser; exports.
- Modify `src/commands/sync.js`: import and run Goose/Crush parsers with lifecycle progress and existing `onSessionEvent`; keep other providers' behavior stable.
- Modify `test/rollout-parser.test.js`: parser coverage for cwd pass-through, Goose, Crush, idempotency.
- Modify `test/sessions-extractors.test.js`: event-shape coverage for new and repaired providers.
- Modify `test/local-api-source-scope.test.js`: source scope and attribution-quality registry behavior.
- Modify dashboard provider visuals only if existing components already use source ids; otherwise add small registry helpers in `dashboard/src/lib/provider-registry.js` and tests.
- Modify Mac provider icon mapping only in `VibeDeckMac/VibeDeckMac/Utilities/BrandLogoResolver.swift` and/or `Views/TopModelsView.swift` if missing provider mappings.
- Modify `PROJECT.md` after final smoke only.

## Provider Contracts

| Provider | Phase 2 status | cwd policy | grouping policy | cost policy |
|---|---|---|---|---|
| OpenCode JSON | existing parser repaired | `msg.path.cwd` if absolute string, else `null` | none | VibeDeck token pricing |
| OpenCode DB | existing parser repaired | `message.data.path.cwd` if absolute string, else `null` | none | VibeDeck token pricing |
| OMP | existing parser repaired | first `type:"session"` row `cwd` if absolute string, else `null` | none | VibeDeck token pricing |
| Pi | existing parser repaired | first `type:"session"` row `cwd` if absolute string, else `null` | none | VibeDeck token pricing |
| Copilot CLI | existing parser repaired | OTEL attr/resource cwd/workspace path if absolute or `file://`, else `null` | none | VibeDeck token pricing |
| Copilot VS Code | current OTEL support only | same OTEL cwd policy; no transcript DB work in this phase | none | VibeDeck token pricing |
| Kiro CLI | existing parser repaired | session JSON top-level `cwd` if absolute string, else `null` | none | existing approximate token policy |
| Kiro IDE | existing parser remains provider-only unless full folder proof is found | `null` for `tokens_generated` rows | none | existing token policy |
| Cursor account CSV | existing parser remains account-level | `null` | none | existing account-level handling |
| Goose | new parser | SQLite `sessions.working_dir` if absolute string, else `null` | none | VibeDeck token pricing |
| Crush | new parser | registry project `path` if absolute string, else `null` | none | VibeDeck token pricing from tokens; provider cost not canonical |

## Task 1: Provider Registry and Source-Scope Guardrails

**Files:**
- Create: `src/lib/provider-registry.js`
- Modify: `src/lib/source-metadata.js`
- Test: `test/local-api-source-scope.test.js`

- [ ] **Step 1: Write failing tests for provider metadata and attribution quality**

Append to `test/local-api-source-scope.test.js`:

```js
test('provider registry keeps Cursor account CSV account-level and Phase 2 locals local', () => {
  const { getSourceScope } = require('../src/lib/source-metadata');
  assert.equal(getSourceScope('cursor'), 'account');
  for (const source of ['opencode', 'omp', 'pi', 'copilot', 'kiro', 'goose', 'crush']) {
    assert.equal(getSourceScope(source), 'local', `${source} must remain local-scoped`);
  }
});

test('provider registry exposes honest Phase 2 attribution labels', () => {
  const { getProviderMetadata, attributionQualityForCwd } = require('../src/lib/provider-registry');
  assert.equal(getProviderMetadata('goose').displayName, 'Goose');
  assert.equal(getProviderMetadata('crush').displayName, 'Crush');
  assert.equal(getProviderMetadata('cursor').sourceScope, 'account');
  assert.equal(attributionQualityForCwd('/Users/example/repo'), 'cwd_proven');
  assert.equal(attributionQualityForCwd(null), 'provider_only');
  assert.equal(attributionQualityForCwd('repo-basename-only'), 'provider_only');
});
```

- [ ] **Step 2: Run the registry tests and verify they fail**

Run:

```bash
node --test test/local-api-source-scope.test.js
```

Expected: FAIL because `src/lib/provider-registry.js` does not exist.

- [ ] **Step 3: Create the provider registry**

Create `src/lib/provider-registry.js`:

```js
'use strict';

const PROVIDERS = Object.freeze({
  claude: { id: 'claude', displayName: 'Claude Code', sourceScope: 'local', phase: 1 },
  codex: { id: 'codex', displayName: 'Codex', sourceScope: 'local', phase: 1 },
  'every-code': { id: 'every-code', displayName: 'EveryCode', sourceScope: 'local', phase: 1 },
  opencode: { id: 'opencode', displayName: 'OpenCode', sourceScope: 'local', phase: 2, attribution: 'cwd_proven' },
  goose: { id: 'goose', displayName: 'Goose', sourceScope: 'local', phase: 2, attribution: 'cwd_proven' },
  crush: { id: 'crush', displayName: 'Crush', sourceScope: 'local', phase: 2, attribution: 'cwd_proven' },
  pi: { id: 'pi', displayName: 'Pi', sourceScope: 'local', phase: 2, attribution: 'cwd_proven' },
  omp: { id: 'omp', displayName: 'OMP', sourceScope: 'local', phase: 2, attribution: 'cwd_proven' },
  cursor: { id: 'cursor', displayName: 'Cursor', sourceScope: 'account', phase: 2, attribution: 'account_level' },
  copilot: { id: 'copilot', displayName: 'GitHub Copilot', sourceScope: 'local', phase: 2, attribution: 'workspace_mapped' },
  kiro: { id: 'kiro', displayName: 'Kiro', sourceScope: 'local', phase: 2, attribution: 'workspace_mapped' },
  gemini: { id: 'gemini', displayName: 'Gemini', sourceScope: 'local', phase: 3, attribution: 'provider_only' },
  openclaw: { id: 'openclaw', displayName: 'OpenClaw', sourceScope: 'local', phase: 3, attribution: 'provider_only' },
  hermes: { id: 'hermes', displayName: 'Hermes', sourceScope: 'local', phase: 3, attribution: 'provider_only' },
  kimi: { id: 'kimi', displayName: 'Kimi', sourceScope: 'local', phase: 3, attribution: 'provider_only' },
  codebuddy: { id: 'codebuddy', displayName: 'CodeBuddy', sourceScope: 'local', phase: 3, attribution: 'provider_only' },
  craft: { id: 'craft', displayName: 'Craft', sourceScope: 'local', phase: 3, attribution: 'workspace_mapped' },
});

function normalizeProviderId(value) {
  return String(value || '').trim().toLowerCase();
}

function getProviderMetadata(value) {
  const id = normalizeProviderId(value);
  return PROVIDERS[id] || { id: id || 'unknown', displayName: id || 'Unknown', sourceScope: 'local', phase: null, attribution: 'provider_only' };
}

function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({ ...provider }));
}

function isAbsoluteLocalPath(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return false;
  if (text.startsWith('file://')) return true;
  if (text.startsWith('/')) return true;
  return /^[A-Za-z]:[\\/]/.test(text);
}

function attributionQualityForCwd(cwd) {
  return isAbsoluteLocalPath(cwd) ? 'cwd_proven' : 'provider_only';
}

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getProviderMetadata,
  listProviders,
  isAbsoluteLocalPath,
  attributionQualityForCwd,
};
```

- [ ] **Step 4: Wire `source-metadata.js` to the registry without changing behavior**

Replace the hard-coded account-level set in `src/lib/source-metadata.js` with:

```js
const { getProviderMetadata, normalizeProviderId } = require('./provider-registry');

function normalizeSource(value) {
  return normalizeProviderId(value);
}

function getSourceScope(source) {
  return getProviderMetadata(source).sourceScope === 'account' ? 'account' : 'local';
}
```

Keep `isAccountLevelSource`, `normalizeUsageScope`, `filterRowsByUsageScope`, and `listExcludedSources` behavior unchanged.

- [ ] **Step 5: Run tests**

Run:

```bash
node --test test/local-api-source-scope.test.js
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/provider-registry.js src/lib/source-metadata.js test/local-api-source-scope.test.js
git commit -m "feat: add provider breadth registry"
```

## Task 2: Repair cwd Pass-Through for Existing Phase 2 Parsers

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Test: `test/rollout-parser.test.js`
- Test: `test/sessions-extractors.test.js`

- [ ] **Step 1: Write failing extractor tests**

Add tests to `test/sessions-extractors.test.js` near the existing Cursor/OpenCode/Copilot/OMP cases:

```js
test('SessionEvent extraction: OpenCode preserves cwd from message path', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-opencode-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const messageDir = path.join(tmp, 'message', 'ses_cwd');
    await fs.mkdir(messageDir, { recursive: true });
    const messagePath = path.join(messageDir, 'msg_cwd.json');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };
    const message = buildOpencodeMessage({
      modelID: 'gpt-4o',
      created: '2026-05-09T00:00:00.000Z',
      completed: '2026-05-09T00:00:10.000Z',
      tokens: { input: 10, output: 2, reasoning: 0, cached: 0, cacheWrite: 0 },
    });
    message.path = { cwd: repo };
    await fs.writeFile(messagePath, JSON.stringify(message), 'utf8');
    const events = [];
    await parseOpencodeIncremental({ messageFiles: [messagePath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });
    assertStartUpdateEnd(events, 'opencode');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: OMP preserves header cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-omp-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const sessionPath = path.join(tmp, 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const ts = '2026-05-09T00:00:00.000Z';
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({ type: 'session', id: 'omp-session', cwd: repo, timestamp: ts }),
        buildOmpAssistantLine({ id: 'msg-1', model: 'claude-sonnet', input: 10, output: 2, timestamp: ts, totalTokens: 12 }),
      ].join('\n') + '\n',
      'utf8',
    );
    const events = [];
    await parseOmpIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });
    assertStartUpdateEnd(events, 'omp');
    assert.equal(events[0].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Pi emits session events and preserves header cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-pi-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const sessionPath = path.join(tmp, 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const ts = '2026-05-09T00:00:00.000Z';
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({ type: 'session', id: 'pi-session', cwd: repo, timestamp: ts }),
        buildOmpAssistantLine({ id: 'msg-1', model: 'mimo-v2.5-pro', input: 10, output: 2, timestamp: ts, totalTokens: 12 }),
      ].join('\n') + '\n',
      'utf8',
    );
    const events = [];
    await parsePiIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });
    assertStartUpdateEnd(events, 'pi');
    assert.equal(events[0].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Write failing rollout parser tests for Copilot and OpenCode DB cwd**

Append to `test/rollout-parser.test.js`:

```js
test('parseCopilotIncremental preserves absolute workspace cwd from OTEL attributes in session events', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-copilot-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const otelPath = path.join(tmp, 'copilot-otel.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const span = makeCopilotChatSpan({ traceId: 'cwd-t1', spanId: 'cwd-s1' });
    span.attributes['process.cwd'] = repo;
    writeCopilotOtelFile(otelPath, [span]);
    const events = [];
    await parseCopilotIncremental({ otelPaths: [otelPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });
    assert.equal(events.find((e) => e.kind === 'start')?.cwd, repo);
    assert.equal(events.find((e) => e.kind === 'update')?.cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run the new tests and verify they fail**

Run:

```bash
node --test test/sessions-extractors.test.js test/rollout-parser.test.js
```

Expected: FAIL on missing cwd pass-through and missing Pi session events.

- [ ] **Step 4: Modify extractors to pass through cwd**

In `src/lib/sessions/extractors.js`:

- Change `extractCursorSessionEvents`, `extractCopilotSessionEvents`, and `extractOmpSessionEvents` from `cwd: null` to `cwd: batch.cwd ?? null`.
- Add:

```js
function extractPiSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'pi',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    branch: batch.branch ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}
```

- Export `extractPiSessionEvents`.

- [ ] **Step 5: Add cwd helpers in `rollout.js`**

Add near `expandHomePath` or shared helper section:

```js
function cleanAbsoluteCwd(value) {
  if (typeof value !== 'string') return null;
  let text = value.trim();
  if (!text) return null;
  if (text.startsWith('file://')) {
    try {
      text = new URL(text).pathname;
    } catch {
      return null;
    }
  }
  if (text.startsWith('/') || /^[A-Za-z]:[\\/]/.test(text)) return text;
  return null;
}

function readPiOmpHeaderCwd(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (entry.type !== 'session') return null;
  return cleanAbsoluteCwd(entry.cwd || entry.working_dir || entry.workingDir || entry.path);
}

function pickCopilotWorkspaceCwd(record) {
  const attrs = record?.attributes && typeof record.attributes === 'object' ? record.attributes : {};
  const resourceAttrs = record?.resource?.attributes && typeof record.resource.attributes === 'object'
    ? record.resource.attributes
    : {};
  for (const key of [
    'process.cwd',
    'cwd',
    'workspace.folder',
    'workspace.path',
    'vscode.workspace.folder',
    'vscode.workspace.path',
    'github.copilot.workspace.folder',
    'github.copilot.workspace.path',
  ]) {
    const value = cleanAbsoluteCwd(attrs[key]) || cleanAbsoluteCwd(resourceAttrs[key]);
    if (value) return value;
  }
  return null;
}
```

- [ ] **Step 6: Patch OpenCode JSON and DB session events**

- Include `onSessionEvent` in `parseOpencodeDbIncremental` destructuring.
- In `parseOpencodeMessageFile`, set `const cwd = cleanAbsoluteCwd(msg?.path?.cwd);` and pass `cwd` into `extractOpenCodeSessionEvents`.
- In `parseOpencodeDbIncremental`, after bucket updates, emit session events using `extractOpenCodeSessionEvents` with `cwd: cleanAbsoluteCwd(msg?.path?.cwd)`.

Use this shape:

```js
emitSessionEvents(
  extractOpenCodeSessionEvents,
  {
    session_id: typeof msg?.sessionID === 'string' ? msg.sessionID : (entry.sessionID || entry.id),
    started_at: tsIso,
    ended_at: tsIso,
    end_reason: 'log_complete',
    cwd: cleanAbsoluteCwd(msg?.path?.cwd),
    model,
    updates: [{ observed_at: tsIso, delta_tokens: Number(delta.total_tokens || 0) }],
    total_tokens: Number(delta.total_tokens || 0),
  },
  onSessionEvent,
);
```

- [ ] **Step 7: Patch OMP and Pi parser loops**

- Track `let sessionCwd = null;` before the line loop.
- When parsing each line, if `entry.type === 'session'`, set `sessionCwd = readPiOmpHeaderCwd(entry) || sessionCwd; continue;`.
- In OMP emit block, pass `cwd: sessionCwd`.
- Add `onSessionEvent` to `parsePiIncremental` signature.
- In Pi, emit `extractPiSessionEvents` with `cwd: sessionCwd` using the same start/update/end shape as OMP.

- [ ] **Step 8: Patch Copilot parser cwd**

Inside `parseCopilotIncremental`, after `const attrs = record.attributes || {};`, add:

```js
const sessionCwd = pickCopilotWorkspaceCwd(record);
```

Pass `cwd: sessionCwd` to `extractCopilotSessionEvents`.

- [ ] **Step 9: Run tests**

Run:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/sessions/extractors.js src/lib/rollout.js test/rollout-parser.test.js test/sessions-extractors.test.js
git commit -m "fix: preserve provider cwd for phase 2 parsers"
```

## Task 3: Add Goose SQLite Provider

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Test: `test/rollout-parser.test.js`
- Test: `test/sessions-extractors.test.js`

- [ ] **Step 1: Write failing Goose parser test**

Append to `test/rollout-parser.test.js`:

```js
function createGooseDb(dbPath, sessions) {
  cp.execFileSync('sqlite3', [
    dbPath,
    `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      description TEXT,
      working_dir TEXT,
      created_at TEXT,
      updated_at TEXT,
      provider_name TEXT,
      model_config_json TEXT,
      accumulated_input_tokens INTEGER,
      accumulated_output_tokens INTEGER,
      accumulated_total_tokens INTEGER
    );
    `,
  ]);
  for (const s of sessions) {
    cp.execFileSync('sqlite3', [
      dbPath,
      `INSERT INTO sessions (id, description, working_dir, created_at, updated_at, provider_name, model_config_json, accumulated_input_tokens, accumulated_output_tokens, accumulated_total_tokens)
       VALUES ('${s.id}', '${s.description || ''}', '${s.working_dir}', '${s.created_at}', '${s.updated_at}', '${s.provider_name || 'anthropic'}', '${JSON.stringify({ model_name: s.model }).replace(/'/g, "''")}', ${s.input}, ${s.output}, ${s.total});`,
    ]);
  }
}

test('parseGooseIncremental reads sessions.db with working_dir cwd and emits session events', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-goose-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const dbPath = path.join(tmp, 'sessions.db');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    createGooseDb(dbPath, [{
      id: 'goose-001',
      working_dir: repo,
      created_at: '2026-05-20T10:00:00.000Z',
      updated_at: '2026-05-20T10:30:00.000Z',
      model: 'claude-sonnet-4-5',
      input: 100,
      output: 25,
      total: 125,
    }]);
    const events = [];
    const { parseGooseIncremental } = require('../src/lib/rollout');
    const result = await parseGooseIncremental({ dbPath, cursors, queuePath, onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 1);
    assert.equal(events.find((event) => event.kind === 'start')?.provider, 'goose');
    assert.equal(events.find((event) => event.kind === 'start')?.cwd, repo);
    const queued = await readJsonLines(queuePath);
    assert.equal(queued[0].source, 'goose');
    assert.equal(queued[0].input_tokens, 100);
    assert.equal(queued[0].output_tokens, 25);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('parseGooseIncremental is idempotent and emits only growth deltas', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-goose-'));
  try {
    const dbPath = path.join(tmp, 'sessions.db');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    createGooseDb(dbPath, [{ id: 'goose-001', working_dir: tmp, created_at: '2026-05-20T10:00:00.000Z', updated_at: '2026-05-20T10:30:00.000Z', model: 'gpt-5.5', input: 100, output: 25, total: 125 }]);
    const { parseGooseIncremental } = require('../src/lib/rollout');
    assert.equal((await parseGooseIncremental({ dbPath, cursors, queuePath })).eventsAggregated, 1);
    assert.equal((await parseGooseIncremental({ dbPath, cursors, queuePath })).eventsAggregated, 0);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test test/rollout-parser.test.js
```

Expected: FAIL because `parseGooseIncremental` is not exported.

- [ ] **Step 3: Add Goose extractor**

In `src/lib/sessions/extractors.js`, add and export:

```js
function extractGooseSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'goose',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    branch: batch.branch ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}
```

- [ ] **Step 4: Implement Goose reader and parser**

In `src/lib/rollout.js` import `extractGooseSessionEvents`.

Add helpers:

```js
function resolveGooseDbPath(env = process.env) {
  const home = env.HOME || require('node:os').homedir();
  if (env.GOOSE_PATH_ROOT) return path.join(expandHomePath(env.GOOSE_PATH_ROOT, env), 'data', 'sessions', 'sessions.db');
  const candidates = [
    path.join(home, '.local', 'share', 'goose', 'sessions', 'sessions.db'),
    path.join(home, 'Library', 'Application Support', 'goose', 'sessions', 'sessions.db'),
    path.join(home, '.local', 'share', 'Block', 'goose', 'sessions', 'sessions.db'),
  ];
  return candidates.find((candidate) => fssync.existsSync(candidate)) || candidates[0];
}

function pickGooseModel(row) {
  if (typeof row?.model === 'string' && row.model.trim()) return row.model.trim();
  if (typeof row?.model_name === 'string' && row.model_name.trim()) return row.model_name.trim();
  if (typeof row?.model_config_json === 'string' && row.model_config_json.trim()) {
    try {
      const parsed = JSON.parse(row.model_config_json);
      return parsed.model_name || parsed.model || parsed.id || null;
    } catch {}
  }
  return 'goose-unknown';
}
```

Add `readGooseSessions(dbPath)` using `sqlite3 -json` and dynamic column tolerance:

```js
function readGooseSessions(dbPath) {
  if (!dbPath || !fssync.existsSync(dbPath)) return [];
  const sql = `SELECT * FROM sessions ORDER BY COALESCE(updated_at, created_at) ASC`;
  let raw;
  try {
    raw = cp.execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 30_000 });
  } catch {
    return [];
  }
  if (!raw || !raw.trim()) return [];
  try {
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
```

Add `parseGooseIncremental`:

```js
async function parseGooseIncremental({ dbPath, cursors, queuePath, onProgress, onSessionEvent, env } = {}) {
  await ensureDir(path.dirname(queuePath));
  const resolvedDbPath = dbPath || resolveGooseDbPath(env || process.env);
  const rows = readGooseSessions(resolvedDbPath);
  const gooseState = cursors.goose && typeof cursors.goose === 'object' ? cursors.goose : {};
  const snapshots = gooseState.snapshots && typeof gooseState.snapshots === 'object' ? { ...gooseState.snapshots } : {};
  if (rows.length === 0) {
    cursors.goose = { ...gooseState, snapshots, updatedAt: new Date().toISOString() };
    return { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
  }
  const hourlyState = normalizeHourlyState(cursors?.hourly);
  const touchedBuckets = new Set();
  const cb = typeof onProgress === 'function' ? onProgress : null;
  let recordsProcessed = 0;
  let eventsAggregated = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    recordsProcessed++;
    const sessionId = String(row.id || row.session_id || '').trim();
    if (!sessionId) continue;
    const totalInput = toNonNegativeInt(row.accumulated_input_tokens ?? row.input_tokens);
    const totalOutput = toNonNegativeInt(row.accumulated_output_tokens ?? row.output_tokens);
    const totalReported = toNonNegativeInt(row.accumulated_total_tokens ?? row.total_tokens ?? (totalInput + totalOutput));
    const prev = snapshots[sessionId] || { input: 0, output: 0, total: 0 };
    const dInput = Math.max(0, totalInput - toNonNegativeInt(prev.input));
    const dOutput = Math.max(0, totalOutput - toNonNegativeInt(prev.output));
    const dTotal = Math.max(0, totalReported - toNonNegativeInt(prev.total));
    snapshots[sessionId] = { input: totalInput, output: totalOutput, total: totalReported };
    if (dInput === 0 && dOutput === 0 && dTotal === 0) continue;
    const observed = row.updated_at || row.last_updated_at || row.created_at || new Date().toISOString();
    const observedIso = new Date(observed).toISOString();
    const bucketStart = toUtcHalfHourStart(observedIso);
    if (!bucketStart) continue;
    const model = normalizeModelInput(pickGooseModel(row)) || 'goose-unknown';
    const totalTokens = dTotal > 0 ? dTotal : dInput + dOutput;
    const delta = { input_tokens: dInput, cached_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: dOutput, reasoning_output_tokens: Math.max(0, totalTokens - dInput - dOutput), total_tokens: totalTokens, conversation_count: 1 };
    const bucket = getHourlyBucket(hourlyState, 'goose', model, bucketStart);
    addTotals(bucket.totals, delta);
    touchedBuckets.add(bucketKey('goose', model, bucketStart));
    emitSessionEvents(extractGooseSessionEvents, { session_id: sessionId, started_at: row.created_at || observedIso, ended_at: observedIso, end_reason: 'log_complete', cwd: cleanAbsoluteCwd(row.working_dir), model, updates: [{ observed_at: observedIso, delta_tokens: totalTokens }], total_tokens: totalTokens }, onSessionEvent);
    eventsAggregated++;
    if (cb) cb({ index: i + 1, total: rows.length, recordsProcessed, eventsAggregated, bucketsQueued: touchedBuckets.size });
  }
  const bucketsQueued = await enqueueTouchedBuckets({ queuePath, hourlyState, touchedBuckets });
  const updatedAt = new Date().toISOString();
  hourlyState.updatedAt = updatedAt;
  cursors.hourly = hourlyState;
  cursors.goose = { ...gooseState, snapshots, updatedAt };
  return { recordsProcessed, eventsAggregated, bucketsQueued };
}
```

Export `resolveGooseDbPath`, `readGooseSessions`, and `parseGooseIncremental`.

- [ ] **Step 5: Wire Goose into sync**

In `src/commands/sync.js`:

- Import `resolveGooseDbPath` and `parseGooseIncremental`.
- After OpenCode DB and before Cursor, add:

```js
let gooseResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
const gooseDbPath = resolveGooseDbPath(process.env);
if (fssync.existsSync(gooseDbPath)) {
  if (progress?.enabled) progress.start(`Parsing Goose ${renderBar(0)} | buckets 0`);
  gooseResult = await parseGooseIncremental({
    dbPath: gooseDbPath,
    cursors,
    queuePath,
    env: process.env,
    onSessionEvent,
    onProgress: (p) => {
      if (!progress?.enabled) return;
      const pct = p.total > 0 ? p.index / p.total : 1;
      progress.update(`Parsing Goose ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} sessions | buckets ${formatNumber(p.bucketsQueued)}`);
    },
  });
}
```

- Include `gooseResult` in any sync result object only if the nearby code has explicit result summaries. Do not invent a new public API if not present.

- [ ] **Step 6: Run tests**

Run:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sessions/extractors.js src/lib/rollout.js src/commands/sync.js test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git commit -m "feat: add goose provider ingestion"
```

## Task 4: Add Crush Registry Provider

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Test: `test/rollout-parser.test.js`
- Test: `test/sessions-extractors.test.js`

- [ ] **Step 1: Write failing Crush parser test**

Append to `test/rollout-parser.test.js`:

```js
function createCrushDb(dbPath, sessions) {
  cp.execFileSync('sqlite3', [
    dbPath,
    `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      model TEXT,
      created_at TEXT,
      updated_at TEXT,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      total_tokens INTEGER,
      cost_usd REAL
    );
    `,
  ]);
  for (const s of sessions) {
    cp.execFileSync('sqlite3', [
      dbPath,
      `INSERT INTO sessions (id, title, model, created_at, updated_at, prompt_tokens, completion_tokens, total_tokens, cost_usd)
       VALUES ('${s.id}', '${s.title || ''}', '${s.model}', '${s.created_at}', '${s.updated_at}', ${s.input}, ${s.output}, ${s.total}, ${s.cost || 0});`,
    ]);
  }
}

test('parseCrushIncremental reads projects registry paths and emits cwd-backed session events', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tt-crush-'));
  try {
    const repo = path.join(tmp, 'repo');
    const crushDir = path.join(repo, '.crush');
    await fs.mkdir(crushDir, { recursive: true });
    const dbPath = path.join(crushDir, 'crush.db');
    createCrushDb(dbPath, [{ id: 'crush-001', model: 'gpt-5.5', created_at: '2026-05-21T10:00:00.000Z', updated_at: '2026-05-21T10:10:00.000Z', input: 90, output: 30, total: 120 }]);
    const projectsPath = path.join(tmp, 'projects.json');
    await fs.writeFile(projectsPath, JSON.stringify({ projects: [{ id: 'repo', path: repo }] }), 'utf8');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const events = [];
    const { parseCrushIncremental } = require('../src/lib/rollout');
    const result = await parseCrushIncremental({ projectsPath, cursors, queuePath, onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 1);
    assert.equal(events.find((event) => event.kind === 'start')?.provider, 'crush');
    assert.equal(events.find((event) => event.kind === 'start')?.cwd, repo);
    const queued = await readJsonLines(queuePath);
    assert.equal(queued[0].source, 'crush');
    assert.equal(queued[0].input_tokens, 90);
    assert.equal(queued[0].output_tokens, 30);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run and verify failure**

Run:

```bash
node --test test/rollout-parser.test.js
```

Expected: FAIL because `parseCrushIncremental` is not exported.

- [ ] **Step 3: Add Crush extractor**

In `src/lib/sessions/extractors.js`, add/export:

```js
function extractCrushSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'crush',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    branch: batch.branch ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}
```

- [ ] **Step 4: Implement Crush discovery and parser**

In `src/lib/rollout.js` import `extractCrushSessionEvents`.

Add:

```js
function resolveCrushProjectsPath(env = process.env) {
  const home = env.HOME || require('node:os').homedir();
  if (env.CRUSH_GLOBAL_DATA) return path.join(expandHomePath(env.CRUSH_GLOBAL_DATA, env), 'projects.json');
  return path.join(home, '.local', 'share', 'crush', 'projects.json');
}

function readCrushProjects(projectsPath) {
  if (!projectsPath || !fssync.existsSync(projectsPath)) return [];
  try {
    const parsed = JSON.parse(fssync.readFileSync(projectsPath, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.projects) ? parsed.projects : [];
    return list
      .map((entry) => cleanAbsoluteCwd(entry?.path || entry?.projectPath || entry?.root || entry?.cwd))
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function readCrushSessions(dbPath) {
  if (!dbPath || !fssync.existsSync(dbPath)) return [];
  const sql = `SELECT * FROM sessions ORDER BY COALESCE(updated_at, created_at) ASC`;
  try {
    const raw = cp.execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, timeout: 30_000 });
    if (!raw.trim()) return [];
    const rows = JSON.parse(raw);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}
```

Add `parseCrushIncremental` mirroring Goose with snapshots under `cursors.crush.snapshots`, using:

```js
const totalInput = toNonNegativeInt(row.prompt_tokens ?? row.input_tokens);
const totalOutput = toNonNegativeInt(row.completion_tokens ?? row.output_tokens);
const totalReported = toNonNegativeInt(row.total_tokens ?? (totalInput + totalOutput));
const model = normalizeModelInput(row.model || row.model_id || row.model_name) || 'crush-unknown';
const sessionKey = `${projectRoot}:${sessionId}`;
```

Important: never use `row.cost_usd` as canonical. Ignore it for bucket/session event totals.

- [ ] **Step 5: Wire Crush into sync**

In `src/commands/sync.js`:

- Import `resolveCrushProjectsPath` and `parseCrushIncremental`.
- After Goose, add the same progress/lifecycle shape:

```js
let crushResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
const crushProjectsPath = resolveCrushProjectsPath(process.env);
if (fssync.existsSync(crushProjectsPath)) {
  if (progress?.enabled) progress.start(`Parsing Crush ${renderBar(0)} | buckets 0`);
  crushResult = await parseCrushIncremental({
    projectsPath: crushProjectsPath,
    cursors,
    queuePath,
    env: process.env,
    onSessionEvent,
    onProgress: (p) => {
      if (!progress?.enabled) return;
      const pct = p.total > 0 ? p.index / p.total : 1;
      progress.update(`Parsing Crush ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} sessions | buckets ${formatNumber(p.bucketsQueued)}`);
    },
  });
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/sessions/extractors.js src/lib/rollout.js src/commands/sync.js test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git commit -m "feat: add crush provider ingestion"
```

## Task 5: Provider UI Honesty and Phase 2 Smoke Harness

**Files:**
- Modify: `dashboard/src/lib/provider-registry.js` if missing
- Modify: `dashboard/src/pages/BranchesPage.jsx` only if it already renders provider strings in drawer/model rows
- Modify: `VibeDeckMac/VibeDeckMac/Utilities/BrandLogoResolver.swift` only if provider mapping is missing
- Modify: `VibeDeckMac/VibeDeckMac/Views/TopModelsView.swift` only if source colors/icons are missing
- Modify: `PROJECT.md`
- Test: `dashboard/src/pages/BranchesPage.test.jsx` if UI code changes
- Test: existing backend smoke commands below

- [ ] **Step 1: Inspect before editing**

Run:

```bash
rg -n "providerIcon|sourceColor|brandLogo|provider|source" dashboard/src/pages/BranchesPage.jsx dashboard/src/pages/LivePage.jsx dashboard/src/lib VibeDeckMac/VibeDeckMac/Utilities VibeDeckMac/VibeDeckMac/Views/TopModelsView.swift
```

Expected: identify existing provider rendering paths. If the existing UI already renders arbitrary provider ids as text and generic color, do not change UI code except adding provider display labels/icons where a fixed map exists.

- [ ] **Step 2: Add dashboard provider registry only if fixed maps exist**

If no `dashboard/src/lib/provider-registry.js` exists, create it with:

```js
export const PROVIDERS = {
  claude: { label: 'Claude Code', quality: 'cwd-proven' },
  codex: { label: 'Codex', quality: 'cwd-proven' },
  opencode: { label: 'OpenCode', quality: 'cwd-proven' },
  goose: { label: 'Goose', quality: 'cwd-proven' },
  crush: { label: 'Crush', quality: 'cwd-proven' },
  pi: { label: 'Pi', quality: 'cwd-proven' },
  omp: { label: 'OMP', quality: 'cwd-proven' },
  cursor: { label: 'Cursor', quality: 'account-level' },
  copilot: { label: 'GitHub Copilot', quality: 'workspace-mapped' },
  kiro: { label: 'Kiro', quality: 'workspace-mapped' },
};

export function providerLabel(id) {
  const key = String(id || '').trim().toLowerCase();
  return PROVIDERS[key]?.label || id || 'Unknown';
}

export function providerQuality(id) {
  const key = String(id || '').trim().toLowerCase();
  return PROVIDERS[key]?.quality || 'provider-only';
}
```

Use it only in places that already show provider text. Do not redesign pages in this phase.

- [ ] **Step 3: Add Mac provider icon fallbacks only if necessary**

If Swift maps are missing provider ids, add these cases:

```swift
case "opencode": return "opencode.svg"
case "goose": return nil
case "crush": return nil
case "pi": return nil
case "omp": return nil
case "copilot": return "copilot.svg"
case "kiro": return "kiro.svg"
```

Providers without assets must fall back to existing letter/color icon. Do not add new image assets in this phase.

- [ ] **Step 4: Install dashboard deps if missing and run UI checks**

Run:

```bash
if [ ! -d dashboard/node_modules ]; then npm --prefix dashboard install; fi
npm --prefix dashboard run test -- --run dashboard/src/pages/BranchesPage.test.jsx dashboard/src/pages/LivePage.test.jsx
npm --prefix dashboard run build
```

Expected: tests pass; build may warn about chunk size but must exit 0.

- [ ] **Step 5: Run backend targeted checks**

Run:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-vibedeck-branch-usage-groups.test.js test/local-api-vibedeck-sessions-live-groups.test.js
```

Expected: PASS.

- [ ] **Step 6: Run copied-live DB smoke**

Use a copy of the live DB, never the user's live DB:

```bash
TMPDIR=$(mktemp -d /tmp/vibedeck-phase2-smoke-XXXXXX)
cp "$HOME/.vibedeck/vibedeck.sqlite3" "$TMPDIR/vibedeck.sqlite3"
node - <<'NODE' "$TMPDIR/vibedeck.sqlite3"
const dbPath = process.argv[2];
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
const sessionCount = db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get().c;
const unknown = db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Unknown branch'").get().c;
const historical = db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Historical unknown'").get().c;
const providerRows = db.prepare("SELECT provider, COUNT(*) AS c FROM vibedeck_sessions GROUP BY provider ORDER BY provider").all();
console.log(JSON.stringify({ sessionCount, unknown, historical, providerRows }, null, 2));
db.close();
NODE
```

Expected: command exits 0; Unknown/Historical counts are present and not corrupted.

- [ ] **Step 7: Run isolated rebuild smoke when backend code changes are green**

Run with an isolated tracker directory:

```bash
TMPHOME=$(mktemp -d /tmp/vibedeck-phase2-home-XXXXXX)
TMPTRACKER=$(mktemp -d /tmp/vibedeck-phase2-tracker-XXXXXX)
START=$(date +%s)
VIBEDECK_HOME="$TMPTRACKER" HOME="$HOME" node bin/vibedeck.js sync --rebuild-vibedeck-db --no-progress
END=$(date +%s)
echo "phase2_rebuild_seconds=$((END-START))"
node bin/vibedeck.js doctor --db "$TMPTRACKER/vibedeck.sqlite3" || true
```

If this command shape does not match the CLI, inspect `bin/vibedeck.js` and use the existing Phase 1.5 smoke command from shell history or test scripts. The invariant is non-negotiable: run against isolated DB, not live DB.

- [ ] **Step 8: Update `PROJECT.md`**

Append under Release `0.1.4` or create a new Phase 2 subsection with:

```markdown
### Phase 2: Tier 1+2 Provider Breadth
**Date:** 2026-05-23
**Branch:** agent/phase-2-tier-1-2-provider-breadth
**Plan:** docs/superpowers/plans/2026-05-23-phase-2-tier-1-2-provider-breadth.md

#### What changed
- Repaired proof-backed cwd pass-through for OpenCode, OMP, Pi, Copilot, and Kiro CLI where the local provider source exposes a real workspace path.
- Added Goose and Crush provider ingestion through the canonical SessionEvent pipeline.
- Kept Cursor account CSV as account-level/provider-only data; no fake branch/project attribution is inferred.
- Preserved `/dashboard`, `/usage`, `/branches`, Unknown branch, Historical unknown, and session grouping totals through smoke checks.

#### Smoke Results
- Backend provider tests: <paste command + pass count>
- Dashboard smoke: <paste command + result>
- Copied-live DB smoke: <paste session/provider/unknown/historical counts>
- Isolated rebuild smoke: <paste elapsed seconds and high-level counts>

#### Caveats
- Cursor IDE local composer workspace mapping remains a future adapter, not part of account CSV.
- Goose/Crush grouping support is explicitly `none` until those providers expose parent-child proof.
```

- [ ] **Step 9: Commit**

```bash
git add dashboard/src VibeDeckMac/VibeDeckMac PROJECT.md
git commit -m "docs: record phase 2 provider breadth smoke"
```

If no dashboard/Mac files changed, do not include them in `git add`.

## Final Audit Gate for Phase 2

Before declaring Phase 2 complete, orchestrator must personally run:

```bash
git status --short
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js
npm --prefix dashboard run build
```

Then verify:

- `git status --short` is clean.
- All task commits exist on `agent/phase-2-tier-1-2-provider-breadth`.
- No file outside the task file lists changed except lockfiles created by `npm --prefix dashboard install` if needed.
- Unknown branch rows still exist if they existed before the phase.
- Historical unknown rows still exist if they existed before the phase.
- Session group tables are untouched except by rebuild/smoke DBs outside the repo.
- No new provider writes directly to `vibedeck_branch_usage_facts`.
- `row.cost_usd` from Crush is not used as canonical visible cost.

## Gap Fix Task 2b: Kiro CLI SessionEvent and cwd Pass-Through

Audit finding before Phase 2 close: `src/commands/sync.js` passes `onSessionEvent` into `parseKiroCliIncremental`, and Kiro CLI fixture files contain `cwd`, but `src/lib/rollout.js` currently ignores `onSessionEvent` in the Kiro CLI parser signature and never carries cwd into canonical `SessionEvent`s. This violates the Phase 2 repair pass-through goal for providers with proof-backed local cwd.

### Files

- `src/lib/rollout.js`
- `test/rollout-parser.test.js`

### Implementation Steps

- [ ] Extend `readKiroCliSessionTurns(jsonPath)` so each flattened turn includes:
  - `cwd` from top-level `parsed.cwd`, sanitized with existing `cleanAbsoluteCwd`.
  - `session_started_at` from `parsed.created_at` when parseable.
  - `session_updated_at` from `parsed.updated_at` when parseable.
- [ ] Extend `parseKiroCliFromSessionFiles(...)` to accept `onSessionEvent` and emit canonical Kiro `SessionEvent`s through `extractKiroSessionEvents` for newly processed turns.
- [ ] Extend `parseKiroCliIncremental(...)` to accept `onSessionEvent` and emit canonical Kiro `SessionEvent`s for DB/live-session merged turns in the main path. Use per-turn `cwd` when available; SQLite rows may remain `cwd: null` because the DB source does not provide workspace proof.
- [ ] Preserve existing Kiro CLI bucket math, retraction behavior, mutation fingerprinting, and cursor isolation under `cursors.kiroCli`.
- [ ] Add tests proving:
  - Back-compat `sessionFiles` parser emits start/update/end events with cwd from fixture.
  - Default live-session path emits session events with cwd when `KIRO_HOME` points at a session file.
  - SQLite-only rows still do not invent cwd.

### Required Checks

```bash
node --test test/rollout-parser.test.js
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js
git diff --check
```

### Acceptance

- Kiro CLI repair can see proof-backed `cwd` through canonical `SessionEvent`s.
- `/usage` totals and Kiro CLI hourly buckets remain unchanged except for legitimate SessionEvent-derived repair attribution.
- Unknown branch and Historical unknown are preserved; no guessed project/branch is introduced when cwd is absent.
- Existing Kiro CLI migration/retraction tests still pass.

## Self-Review Checklist

- Spec coverage: Phase 2 providers are covered as follows: OpenCode, Pi, OMP, Copilot, Kiro CLI repaired; Goose and Crush added; Cursor account remains honest account-level; Kiro IDE remains provider-only until full folder proof exists.
- Placeholder scan: this plan intentionally contains no `TBD`, no `TODO`, and no unspecified test commands.
- Type consistency: provider ids are lowercase strings matching existing `provider`/`source` values in VibeDeck: `opencode`, `goose`, `crush`, `pi`, `omp`, `cursor`, `copilot`, `kiro`.
- Safety: new providers emit only `SessionEvent` and hourly queue records; no direct branch fact writes.
