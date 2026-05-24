# Phase 3 Tier 3+4 Provider Breadth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish safe Tier 3+4 provider breadth by adding the missing session-safe providers and hardening existing weak-attribution providers without weakening `/dashboard`, `/usage`, `/branches`, Unknown branch, Historical unknown, or session grouping richness.

**Architecture:** All providers enter through the existing `SessionEvent -> vibedeck_sessions -> session buckets -> branch usage facts` pipeline. A provider may pass `cwd` only when its local source proves an absolute workspace path; otherwise it emits provider-only session events with `cwd: null` and no branch/project invention. Existing Phase 2 adapters, grouping tables, branch fact projections, and cost engine remain the source of truth.

**Tech Stack:** Node.js CommonJS, SQLite via `sqlite3` CLI for existing parser tests, Node test runner, React/Vite dashboard smoke, Swift Mac app fallback display only where fixed maps require it.

---

## Phase 3 Scope Lock

Phase 3 spec providers and current branch status:

| Provider | Current status on Phase 2 branch | Phase 3 action |
|---|---|---|
| Gemini | Parser exists, provider-only/session-safe, no cwd proof from temp hash | Harden with `.project_root` proof when present; keep hash/temp misses provider-only; log hash-match stats in cursor state |
| OpenClaw | Parser exists, provider-only/session-safe, explicit `cwd: null` | Keep provider-only; add missing registry/status honesty only if needed; no branch attribution |
| Kiro IDE passive | Parser exists for `devdata.sqlite` / `tokens_generated.jsonl`, provider-only | Keep provider-only unless a future source proves workspace; add explicit tests that it does not invent cwd |
| Droid / Factory | Missing | Add passive `.factory/sessions/**/*.jsonl` adapter; `session_start.cwd` is cwd proof; per-call splits are estimated via activity/tool labels only, not canonical cost writes |
| Qwen | Missing | Add passive `~/.qwen/projects/*/chats/*.jsonl` adapter; use entry-level absolute `cwd` only when present |
| Cursor Agent | Missing | Add passive transcript adapter; provider-only unless a transcript entry or sidecar JSON has an absolute `cwd`/`workspaceFolder`; estimated token counts must be labeled in activity/tools, not as a second cost source |
| Antigravity | Missing | Add safe cache/metadata adapter only for JSON cache/brain metadata that carries numeric usage; `.pb` files alone must not create usage or branch facts |
| IBM Bob | Missing | Add shared Cline-family parser; use `Current Workspace Directory (...)` proof from conversation history only |
| Roo Code | Missing | Same shared Cline-family parser |
| KiloCode | Missing | Same shared Cline-family parser |

Already-added Phase 3-adjacent providers (`hermes`, `kimi`, `codebuddy`, `craft`) are not rewritten in this phase. They remain in the smoke matrix so regressions are caught.

## Non-Negotiable Data Gates

- New adapters emit only canonical `SessionEvent`s and hourly queue rows. They never write `vibedeck_branch_usage_facts` directly.
- `row.cost_usd` or provider-computed cost fields from raw provider sources are never visible canonical cost. Visible cost remains VibeDeck pricing over token buckets.
- Relative paths, basenames, temp hashes, project folder names, agent names, and provider constants must become `cwd: null`.
- `Unknown branch` and `Historical unknown` counts must not disappear in copied-live or isolated rebuild smoke.
- Grouping remains additive. No Phase 3 provider creates group edges unless it exposes proof-backed parent/child ids; this plan records `grouping_support = none` through comments/tests rather than guessed edges.

## File Map

- `src/lib/provider-registry.js` — provider metadata, phase number, source scope, attribution quality labels.
- `src/lib/sessions/extractors.js` — provider-specific SessionEvent wrapper functions.
- `src/lib/rollout.js` — provider discovery, incremental parsers, token normalization, hourly queue writes, SessionEvent emission.
- `src/commands/sync.js` — provider invocation and progress wiring.
- `test/rollout-parser.test.js` — parser, resolver, idempotency, and cwd-honesty fixtures.
- `test/sessions-extractors.test.js` — canonical SessionEvent extraction smoke for every Phase 3 provider that emits session events.
- `test/local-api-source-scope.test.js` — registry/source-scope assertions.
- `PROJECT.md` — release 0.1.4 Phase 3 record and local smoke evidence.

## Task 1: Provider Registry And Phase 3 Honesty Matrix

**Files:**
- Modify: `src/lib/provider-registry.js`
- Modify: `test/local-api-source-scope.test.js`

- [ ] **Step 1: Write failing registry tests**

Append to `test/local-api-source-scope.test.js`:

```js
test('provider registry exposes Phase 3 provider attribution honestly', () => {
  const { getProviderMetadata } = require('../src/lib/provider-registry');
  const expected = {
    gemini: 'provider_only',
    openclaw: 'provider_only',
    droid: 'cwd_proven',
    qwen: 'cwd_optional',
    'cursor-agent': 'provider_only',
    antigravity: 'provider_only',
    'ibm-bob': 'cwd_optional',
    roo: 'cwd_optional',
    kilocode: 'cwd_optional',
  };
  for (const [id, attribution] of Object.entries(expected)) {
    const meta = getProviderMetadata(id);
    assert.equal(meta.id, id);
    assert.equal(meta.phase, 3);
    assert.equal(meta.sourceScope, 'local');
    assert.equal(meta.attribution, attribution);
  }
});
```

Run:

```bash
node --test test/local-api-source-scope.test.js
```

Expected: FAIL for missing Phase 3 provider metadata.

- [ ] **Step 2: Add provider metadata**

Edit the `PROVIDERS` object in `src/lib/provider-registry.js` so it includes these exact entries, preserving existing entries:

```js
  droid: { id: "droid", displayName: "Droid", sourceScope: "local", phase: 3, attribution: "cwd_proven" },
  qwen: { id: "qwen", displayName: "Qwen", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  "cursor-agent": {
    id: "cursor-agent",
    displayName: "Cursor Agent",
    sourceScope: "local",
    phase: 3,
    attribution: "provider_only",
  },
  antigravity: {
    id: "antigravity",
    displayName: "Antigravity",
    sourceScope: "local",
    phase: 3,
    attribution: "provider_only",
  },
  "ibm-bob": { id: "ibm-bob", displayName: "IBM Bob", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  roo: { id: "roo", displayName: "Roo Code", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  kilocode: { id: "kilocode", displayName: "KiloCode", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
```

If `gemini`, `openclaw`, and `kiro` already exist, leave their ids stable and only adjust attribution if tests prove a mismatch. Do not change `cursor` account source scope.

- [ ] **Step 3: Run registry tests**

Run:

```bash
node --test test/local-api-source-scope.test.js
```

Expected: PASS with the new test included.

- [ ] **Step 4: Commit**

```bash
git add src/lib/provider-registry.js test/local-api-source-scope.test.js
git commit -m "feat: register phase 3 provider metadata"
```

## Task 2: Gemini And Existing Weak-Attribution Hardening

**Files:**
- Modify: `src/lib/rollout.js`
- Modify: `test/rollout-parser.test.js`
- Modify: `test/sessions-extractors.test.js`

- [ ] **Step 1: Add Gemini `.project_root` proof tests**

Add tests near existing Gemini tests in `test/rollout-parser.test.js`:

```js
test("parseGeminiIncremental preserves cwd only from adjacent .project_root proof", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-gemini-root-"));
  try {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo, { recursive: true });
    const chatsDir = path.join(tmp, "gemini", "tmp", "hash-a", "chats");
    await fs.mkdir(chatsDir, { recursive: true });
    await fs.writeFile(path.join(tmp, "gemini", "tmp", "hash-a", ".project_root"), repo, "utf8");
    const sessionPath = path.join(chatsDir, "session-root.json");
    const session = {
      sessionId: "gemini-root",
      messages: [{ timestamp: "2026-05-22T10:00:00.000Z", model: "gemini-2.5-pro", tokens: { input: 10, output: 5 } }],
    };
    await fs.writeFile(sessionPath, JSON.stringify(session), "utf8");
    const queuePath = path.join(tmp, "queue.jsonl");
    const cursors = { version: 1 };
    const events = [];
    await parseGeminiIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (event) => events.push(event) });
    assert.equal(events.find((event) => event.kind === "start")?.cwd, repo);
    assert.equal(events.find((event) => event.kind === "update")?.cwd, repo);
    assert.equal(events.find((event) => event.kind === "end")?.cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseGeminiIncremental keeps temp hash sessions provider-only when .project_root is absent", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-gemini-provider-only-"));
  try {
    const chatsDir = path.join(tmp, "gemini", "tmp", "hash-b", "chats");
    await fs.mkdir(chatsDir, { recursive: true });
    const sessionPath = path.join(chatsDir, "session-provider.json");
    await fs.writeFile(sessionPath, JSON.stringify({
      sessionId: "gemini-provider-only",
      messages: [{ timestamp: "2026-05-22T10:00:00.000Z", model: "gemini-2.5-pro", tokens: { input: 8, output: 3 } }],
    }), "utf8");
    const events = [];
    await parseGeminiIncremental({ sessionFiles: [sessionPath], cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(events.find((event) => event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

Add an extractor smoke in `test/sessions-extractors.test.js` if existing Gemini smoke does not assert cwd null/proof behavior. The expected behavior is: `.project_root` absolute path passes through; no `.project_root` stays null.

Run:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js
```

Expected: FAIL because Gemini parser currently does not read `.project_root`.

- [ ] **Step 2: Implement Gemini project root proof helper**

In `src/lib/rollout.js`, add helpers near `listGeminiSessionFiles` or Gemini parser code:

```js
function resolveGeminiProjectRootForSessionFile(filePath) {
  if (typeof filePath !== "string" || !filePath) return null;
  const chatsDir = path.basename(path.dirname(filePath)) === "chats" ? path.dirname(filePath) : null;
  if (!chatsDir) return null;
  const projectDir = path.dirname(chatsDir);
  const proofPath = path.join(projectDir, ".project_root");
  let raw;
  try {
    raw = fssync.readFileSync(proofPath, "utf8");
  } catch (_e) {
    return null;
  }
  return cleanAbsoluteCwd(String(raw || "").trim());
}
```

Then in `parseGeminiIncremental`, before calling `parseGeminiFile`, compute:

```js
const sessionCwd = resolveGeminiProjectRootForSessionFile(filePath);
```

Pass `sessionCwd` into `parseGeminiFile`, and in `parseGeminiFile` include `cwd: sessionCwd` in the `emitSessionEvents(extractGeminiSessionEvents, ...)` batch. If `sessionCwd` is null, existing behavior remains provider-only.

Also add cursor stats after processing Gemini files:

```js
cursors.gemini = {
  ...(cursors.gemini && typeof cursors.gemini === "object" ? cursors.gemini : {}),
  projectRootProofs: (cursors.gemini?.projectRootProofs || 0) + (sessionCwd ? 1 : 0),
  providerOnlyFiles: (cursors.gemini?.providerOnlyFiles || 0) + (sessionCwd ? 0 : 1),
  updatedAt: new Date().toISOString(),
};
```

If `cursors.gemini` already stores another shape, preserve it with object spread and do not overwrite existing file cursors.

- [ ] **Step 3: Add Kiro/OpenClaw no-cwd regression tests**

Add tests near Kiro/OpenClaw tests:

```js
test("parseKiroIncremental does not invent cwd from Kiro IDE paths", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-kiro-no-cwd-"));
  try {
    const jsonlPath = path.join(tmp, "tokens_generated.jsonl");
    await fs.writeFile(jsonlPath, JSON.stringify({ model: "agent", provider: "kiro", promptTokens: 10, generatedTokens: 5, timestamp: "2026-05-22T10:00:00.000Z" }) + "\n");
    const events = [];
    await parseKiroIncremental({ jsonlPath, dbPath: path.join(tmp, "missing.db"), cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(events.find((event) => event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseOpenclawIncremental remains provider-only when no cwd proof exists", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-openclaw-no-cwd-"));
  try {
    const sessionPath = path.join(tmp, "session.jsonl");
    await fs.writeFile(sessionPath, JSON.stringify({ type: "message", role: "assistant", timestamp: "2026-05-22T10:00:00.000Z", model: "claude-sonnet-4", usage: { inputTokens: 10, outputTokens: 5 } }) + "\n");
    const events = [];
    await parseOpenclawIncremental({ sessionFiles: [sessionPath], cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(events.find((event) => event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run tests and commit**

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js
git add src/lib/rollout.js test/rollout-parser.test.js test/sessions-extractors.test.js
git commit -m "fix: harden weak provider attribution"
```

## Task 3: Droid And Qwen Passive Providers

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Modify: `test/rollout-parser.test.js`
- Modify: `test/sessions-extractors.test.js`
- Modify: `test/sync-readme-sync.test.js` only if sync mocks require new parser exports

- [ ] **Step 1: Add extractor wrappers**

In `src/lib/sessions/extractors.js`, add:

```js
function extractDroidSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'droid',
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

function extractQwenSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'qwen',
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

Export both in `module.exports`.

- [ ] **Step 2: Add failing parser tests**

Add to `test/rollout-parser.test.js`:

```js
test("parseDroidIncremental uses session_start.cwd proof and marks split usage estimated in activity", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-droid-"));
  try {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo, { recursive: true });
    const sessionFile = path.join(tmp, ".factory", "sessions", "project-a", "session.jsonl");
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(sessionFile, [
      JSON.stringify({ type: "session_start", session_id: "droid-1", cwd: repo, model: "factory-model", timestamp: "2026-05-22T10:00:00.000Z" }),
      JSON.stringify({ type: "assistant", id: "a1", timestamp: "2026-05-22T10:01:00.000Z", usage: { input_tokens: 100, output_tokens: 25 }, tool: "Edit" }),
    ].join("\n") + "\n");
    const events = [];
    const cursors = { version: 1 };
    const result = await parseDroidIncremental({ sessionFiles: [sessionFile], cursors, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 1);
    assert.equal(events.find((event) => event.kind === "start")?.cwd, repo);
    const queued = await readJsonLines(path.join(tmp, "queue.jsonl"));
    assert.equal(queued[0].source, "droid");
    assert.match(String(queued[0].activity_json || ""), /estimated/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseQwenIncremental preserves cwd only when entry cwd is absolute", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-qwen-"));
  try {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo, { recursive: true });
    const chatFile = path.join(tmp, ".qwen", "projects", "hash", "chats", "chat.jsonl");
    await fs.mkdir(path.dirname(chatFile), { recursive: true });
    await fs.writeFile(chatFile, [
      JSON.stringify({ sessionId: "qwen-1", cwd: repo, timestamp: "2026-05-22T10:00:00.000Z", model: "qwen-coder", usage: { input_tokens: 50, output_tokens: 20, cached_tokens: 5 }, tools: [{ name: "Read" }] }),
      JSON.stringify({ sessionId: "qwen-2", cwd: "hash-only", timestamp: "2026-05-22T10:30:00.000Z", model: "qwen-coder", usage: { input_tokens: 10, output_tokens: 4 } }),
    ].join("\n") + "\n");
    const events = [];
    const result = await parseQwenIncremental({ chatFiles: [chatFile], cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 2);
    assert.equal(events.find((event) => event.session_id === "qwen-1" && event.kind === "start")?.cwd, repo);
    assert.equal(events.find((event) => event.session_id === "qwen-2" && event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

Also add `SessionEvent extraction: Droid` and `SessionEvent extraction: Qwen` tests to `test/sessions-extractors.test.js` using the same shapes. Expected before implementation: FAIL because parser exports are missing.

- [ ] **Step 3: Implement discovery helpers**

In `src/lib/rollout.js`, add near other passive providers:

```js
function resolveDroidSessionFiles(env = process.env) {
  const home = env.HOME || require("node:os").homedir();
  const factoryDir = env.FACTORY_DIR || path.join(home, ".factory");
  const sessionsDir = path.join(factoryDir, "sessions");
  const files = [];
  walkJsonlFilesSync(sessionsDir, files);
  return files.sort((a, b) => a.localeCompare(b));
}

function resolveQwenChatFiles(env = process.env) {
  const home = env.HOME || require("node:os").homedir();
  const qwenDir = env.QWEN_DATA_DIR || path.join(home, ".qwen");
  const projectsDir = path.join(qwenDir, "projects");
  const files = [];
  walkJsonlFilesSync(projectsDir, files);
  return files.filter((file) => file.includes(`${path.sep}chats${path.sep}`)).sort((a, b) => a.localeCompare(b));
}

function walkJsonlFilesSync(rootDir, out) {
  if (!rootDir || !fssync.existsSync(rootDir)) return;
  let entries;
  try { entries = fssync.readdirSync(rootDir, { withFileTypes: true }); } catch (_e) { return; }
  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);
    if (entry.isDirectory()) walkJsonlFilesSync(full, out);
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) out.push(full);
  }
}
```

If `walkJsonlFilesSync` already exists, reuse it rather than adding a duplicate.

- [ ] **Step 4: Implement parsers**

Use existing parser patterns: file offsets under `cursors.droid.fileOffsets` and `cursors.qwen.fileOffsets`, `readline.createInterface`, `getHourlyBucket`, `addTotals`, `enqueueTouchedBuckets`, and `emitSessionEvents`.

For Droid rows:

```js
const sessionCwd = cleanAbsoluteCwd(entry.cwd || entry.working_dir || entry.workingDir);
const model = normalizeModelInput(entry.model) || currentSession.model || "droid-unknown";
const input = toNonNegativeInt(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens);
const output = toNonNegativeInt(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens);
const cacheRead = toNonNegativeInt(usage.cached_tokens ?? usage.cache_read_input_tokens);
```

When a Droid session-level total is split across multiple assistant rows, write `activity_json` with `{"estimated_split":1}` on the queued row. Do not write a separate `estimated_cost_usd` field.

For Qwen rows, use `entry.cwd` only through `cleanAbsoluteCwd`; if missing or relative, emit `cwd: null`.

- [ ] **Step 5: Wire sync**

In `src/commands/sync.js`, import and call:

```js
resolveDroidSessionFiles,
parseDroidIncremental,
resolveQwenChatFiles,
parseQwenIncremental,
```

Call Droid and Qwen near other passive providers. Each parser receives `{ sessionFiles/chatFiles, cursors, queuePath, env: process.env, onSessionEvent, onProgress }` and contributes to the final totals.

- [ ] **Step 6: Run tests and commit**

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git add src/lib/sessions/extractors.js src/lib/rollout.js src/commands/sync.js test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git commit -m "feat: add droid and qwen providers"
```

## Task 4: Cline-Family Providers (`ibm-bob`, `roo`, `kilocode`)

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Modify: `test/rollout-parser.test.js`
- Modify: `test/sessions-extractors.test.js`
- Modify: `test/sync-readme-sync.test.js` only if sync mocks require new parser exports

- [ ] **Step 1: Add shared Cline tests**

Add to `test/rollout-parser.test.js`:

```js
test("parseClineFamilyIncremental uses Current Workspace Directory proof and keeps missing proof provider-only", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cline-family-"));
  try {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo, { recursive: true });
    const taskWithProof = path.join(tmp, "globalStorage", "rooveterinaryinc.roo-cline", "tasks", "task-a");
    const taskWithoutProof = path.join(tmp, "globalStorage", "kilocode.kilo-code", "tasks", "task-b");
    await fs.mkdir(taskWithProof, { recursive: true });
    await fs.mkdir(taskWithoutProof, { recursive: true });
    await fs.writeFile(path.join(taskWithProof, "api_conversation_history.json"), JSON.stringify([{ content: `Current Workspace Directory (${repo})` }]), "utf8");
    await fs.writeFile(path.join(taskWithoutProof, "api_conversation_history.json"), JSON.stringify([{ content: "No workspace proof here" }]), "utf8");
    const ui = [{ ts: "2026-05-22T10:00:00.000Z", model: "claude-sonnet-4", tokensIn: 100, tokensOut: 20, tool: "read_file" }];
    await fs.writeFile(path.join(taskWithProof, "ui_messages.json"), JSON.stringify(ui), "utf8");
    await fs.writeFile(path.join(taskWithoutProof, "ui_messages.json"), JSON.stringify(ui), "utf8");
    const files = resolveClineFamilyTaskDirs({ HOME: tmp });
    const events = [];
    const result = await parseClineFamilyIncremental({ taskDirs: files, cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 2);
    assert.equal(events.find((event) => event.provider === "roo" && event.kind === "start")?.cwd, repo);
    assert.equal(events.find((event) => event.provider === "kilocode" && event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add extractor wrappers**

Add a generic wrapper in `src/lib/sessions/extractors.js`:

```js
function extractClineFamilySessionEvents(batch) {
  return extractSessionEvents({
    provider: batch.provider,
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

Export it.

- [ ] **Step 3: Implement resolver and parser**

In `src/lib/rollout.js`, add:

```js
const CLINE_FAMILY_EXTENSIONS = Object.freeze([
  { provider: "ibm-bob", extensionIds: ["ibm.bob-code", "ibm.bob-ide"] },
  { provider: "roo", extensionIds: ["rooveterinaryinc.roo-cline"] },
  { provider: "kilocode", extensionIds: ["kilocode.kilo-code", "kilo-code.kilo-code"] },
]);
```

Implement `resolveClineFamilyTaskDirs(env)` to return objects `{ provider, taskDir }` by walking:

```js
path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", extensionId, "tasks")
path.join(home, ".config", "Code", "User", "globalStorage", extensionId, "tasks")
```

For tests, also support `path.join(home, "globalStorage", extensionId, "tasks")`.

Implement `readClineWorkspaceProof(taskDir)` by reading `api_conversation_history.json` and regex matching:

```js
/Current Workspace Directory\s*\(([^)]+)\)/i
```

Pass the captured value through `cleanAbsoluteCwd`. If null, provider-only.

Implement `parseClineFamilyIncremental({ taskDirs, cursors, queuePath, onProgress, onSessionEvent, env })` using `ui_messages.json` arrays. Accept token fields:

```js
input = tokensIn || input_tokens || inputTokens || prompt_tokens
output = tokensOut || output_tokens || outputTokens || completion_tokens
cacheRead = cached_tokens || cache_read_input_tokens
cacheWrite = cache_write_input_tokens || cache_creation_input_tokens
```

Each task dir is one session id: `${provider}:${taskDir}`. Use snapshot idempotency under `cursors.clineFamily.snapshots[sessionKey]` with a content fingerprint of mtime/size plus token totals. Emit SessionEvents provider-specific (`ibm-bob`, `roo`, `kilocode`). Tools can be extracted from `tool`, `toolName`, `name`, or `type` strings and placed in `tools_json`.

- [ ] **Step 4: Wire sync and exports**

Export `resolveClineFamilyTaskDirs` and `parseClineFamilyIncremental` from `src/lib/rollout.js`. Import them in `src/commands/sync.js`, run after Kiro/Craft passive providers, and add result counts to final totals.

- [ ] **Step 5: Run tests and commit**

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git add src/lib/sessions/extractors.js src/lib/rollout.js src/commands/sync.js test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git commit -m "feat: add cline family providers"
```

## Task 5: Cursor Agent And Antigravity Provider-Only Adapters

**Files:**
- Modify: `src/lib/sessions/extractors.js`
- Modify: `src/lib/rollout.js`
- Modify: `src/commands/sync.js`
- Modify: `test/rollout-parser.test.js`
- Modify: `test/sessions-extractors.test.js`
- Modify: `test/sync-readme-sync.test.js` only if sync mocks require new parser exports

- [ ] **Step 1: Add tests for provider-only safety**

Add to `test/rollout-parser.test.js`:

```js
test("parseCursorAgentIncremental keeps transcripts provider-only unless absolute cwd is present", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-cursor-agent-"));
  try {
    const repo = path.join(tmp, "repo");
    await fs.mkdir(repo, { recursive: true });
    const transcriptsDir = path.join(tmp, ".cursor", "projects", "project-hash", "agent-transcripts");
    await fs.mkdir(transcriptsDir, { recursive: true });
    const jsonl = path.join(transcriptsDir, "agent.jsonl");
    await fs.writeFile(jsonl, [
      JSON.stringify({ sessionId: "cursor-agent-a", cwd: repo, timestamp: "2026-05-22T10:00:00.000Z", model: "cursor-agent", usage: { input_tokens: 40, output_tokens: 10 }, tool: "edit" }),
      JSON.stringify({ sessionId: "cursor-agent-b", project: "project-hash", timestamp: "2026-05-22T10:30:00.000Z", model: "cursor-agent", usage: { input_tokens: 20, output_tokens: 5 } }),
    ].join("\n") + "\n");
    const events = [];
    const result = await parseCursorAgentIncremental({ transcriptFiles: [jsonl], cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 2);
    assert.equal(events.find((event) => event.session_id === "cursor-agent-a" && event.kind === "start")?.cwd, repo);
    assert.equal(events.find((event) => event.session_id === "cursor-agent-b" && event.kind === "start")?.cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test("parseAntigravityIncremental reads JSON cache usage and ignores pb-only files", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-antigravity-"));
  try {
    const cachePath = path.join(tmp, ".cache", "codeburn", "antigravity-results.json");
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify([{ id: "ag-1", timestamp: "2026-05-22T10:00:00.000Z", model: "gemini-2.5-pro", input_tokens: 12, output_tokens: 4 }]), "utf8");
    const events = [];
    const result = await parseAntigravityIncremental({ cachePath, pbFiles: [path.join(tmp, "raw.pb")], cursors: { version: 1 }, queuePath: path.join(tmp, "queue.jsonl"), onSessionEvent: (event) => events.push(event) });
    assert.equal(result.eventsAggregated, 1);
    assert.equal(events.find((event) => event.kind === "start")?.cwd, null);
    const queued = await readJsonLines(path.join(tmp, "queue.jsonl"));
    assert.equal(queued[0].source, "antigravity");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add extractor wrappers**

Add `extractCursorAgentSessionEvents` and `extractAntigravitySessionEvents` in `src/lib/sessions/extractors.js`, mirroring other wrappers with providers `cursor-agent` and `antigravity`.

- [ ] **Step 3: Implement Cursor Agent parser**

In `src/lib/rollout.js`, implement:

```js
function resolveCursorAgentTranscriptFiles(env = process.env) {
  const home = env.HOME || require("node:os").homedir();
  const cursorHome = env.CURSOR_HOME || path.join(home, ".cursor");
  const projectsDir = path.join(cursorHome, "projects");
  const files = [];
  walkJsonlFilesSync(projectsDir, files);
  return files.filter((file) => file.includes(`${path.sep}agent-transcripts${path.sep}`)).sort((a, b) => a.localeCompare(b));
}
```

Implement `parseCursorAgentIncremental` with file-offset idempotency. If token fields are missing, estimate from text length using `Math.floor(chars / 4)` and put `activity_json` with `{"estimated_tokens":1}`. Use `cwd` only through `cleanAbsoluteCwd`.

- [ ] **Step 4: Implement Antigravity parser**

Implement:

```js
function resolveAntigravityCachePath(env = process.env) {
  const home = env.HOME || require("node:os").homedir();
  return env.ANTIGRAVITY_CACHE_PATH || path.join(home, ".cache", "codeburn", "antigravity-results.json");
}

function resolveAntigravityPbFiles(env = process.env) {
  const home = env.HOME || require("node:os").homedir();
  const dir = env.ANTIGRAVITY_HOME || path.join(home, ".gemini", "antigravity", "conversations");
  if (!fssync.existsSync(dir)) return [];
  return fssync.readdirSync(dir).filter((name) => name.endsWith(".pb")).map((name) => path.join(dir, name)).sort();
}
```

`parseAntigravityIncremental` reads JSON cache rows only. It must not decode `.pb`; if only pb files exist, return zero events and update `cursors.antigravity.lastPbSeen` for status/debug. Accept row token fields: `input_tokens`, `inputTokens`, `prompt_tokens`; `output_tokens`, `outputTokens`, `completion_tokens`; `thinking_tokens`, `reasoning_output_tokens`. Emit `cwd: null` always.

- [ ] **Step 5: Wire sync and commit**

Import and run Cursor Agent and Antigravity. Then:

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git add src/lib/sessions/extractors.js src/lib/rollout.js src/commands/sync.js test/rollout-parser.test.js test/sessions-extractors.test.js test/sync-readme-sync.test.js
git commit -m "feat: add cursor agent and antigravity adapters"
```

## Task 6: Phase 3 Smoke, Reconciliation, And PROJECT.md

**Files:**
- Modify: `PROJECT.md`
- Test-only commands against copied/isolated DBs

- [ ] **Step 1: Run backend provider matrix**

```bash
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js test/local-api-vibedeck-branch-usage.test.js test/local-api-vibedeck-branch-usage-groups.test.js test/local-api-vibedeck-sessions-live-groups.test.js
```

Expected: PASS. Record pass count.

- [ ] **Step 2: Run dashboard smoke**

```bash
if [ ! -d dashboard/node_modules ]; then npm --prefix dashboard install; fi
npm --prefix dashboard run test -- --run src/pages/BranchesPage.test.jsx src/pages/LivePage.test.jsx
npm --prefix dashboard run build
```

Expected: tests PASS; build exits 0. Existing large chunk warning is acceptable.

- [ ] **Step 3: Run copied-live DB read-only smoke**

Use actual tracker DB path if the legacy path is zero bytes:

```bash
TMPDIR=$(mktemp -d /tmp/vibedeck-phase3-smoke-XXXXXX)
LIVE_DB="$HOME/.vibedeck/tracker/vibedeck.sqlite3"
cp "$LIVE_DB" "$TMPDIR/vibedeck.sqlite3"
node - <<'NODE' "$TMPDIR/vibedeck.sqlite3"
const dbPath = process.argv[2];
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(dbPath, { readOnly: true });
const out = {
  sessionCount: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get().c,
  eventCount: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_events').get().c,
  branchFacts: db.prepare('SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts').get().c,
  unknown: db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Unknown branch'").get().c,
  historical: db.prepare("SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts WHERE branch = 'Historical unknown'").get().c,
  providers: db.prepare('SELECT provider, COUNT(*) AS c FROM vibedeck_sessions GROUP BY provider ORDER BY provider').all(),
};
console.log(JSON.stringify(out, null, 2));
db.close();
NODE
```

Expected: exits 0; Unknown/Historical counts are preserved.

- [ ] **Step 4: Run isolated rebuild smoke**

Use the proven Phase 2 safe shape: temporary `HOME` with symlinks to real provider directories and isolated `.vibedeck/tracker` DB. Do not write to live DB.

```bash
TMPHOME=$(mktemp -d /tmp/vibedeck-phase3-home-XXXXXX)
for name in .claude .codex .cursor .gemini .openclaw .config .qwen .factory .kiro .kimi .codebuddy .craft-agent; do
  if [ -e "$HOME/$name" ]; then ln -s "$HOME/$name" "$TMPHOME/$name"; fi
done
START=$(date +%s)
HOME="$TMPHOME" node bin/vibedeck.js sync --rebuild-vibedeck-db --auto
END=$(date +%s)
echo "phase3_rebuild_seconds=$((END-START))"
node bin/vibedeck.js doctor || true
```

Then query `$TMPHOME/.vibedeck/tracker/vibedeck.sqlite3` for the same counts as Step 3.

- [ ] **Step 5: Verify direct branch-fact write boundary**

```bash
node - <<'NODE'
const fs = require('fs');
for (const file of ['src/lib/rollout.js', 'src/lib/sessions/extractors.js']) {
  const text = fs.readFileSync(file, 'utf8');
  if (/vibedeck_branch_usage_facts|INSERT INTO\s+vibedeck_branch_usage_facts|UPDATE\s+vibedeck_branch_usage_facts/i.test(text)) {
    throw new Error(`${file} writes branch facts directly`);
  }
}
console.log('ok: provider adapters do not write branch facts directly');
NODE
```

Expected: prints ok.

- [ ] **Step 6: Update PROJECT.md**

Append under Release `0.1.4`:

```markdown
#### Phase 3 - Tier 3+4 Provider Breadth

**Date:** 2026-05-23
**Branch:** `agent/phase-3-tier-3-4-provider-breadth`
**Plan:** `docs/superpowers/plans/2026-05-23-phase-3-tier-3-4-provider-breadth.md`

What changed:

- Added missing Tier 3+4 session-safe providers through canonical `SessionEvent` ingestion.
- Hardened Gemini, Kiro IDE, and OpenClaw so cwd is used only when local proof exists.
- Added Droid, Qwen, Cursor Agent, Antigravity, and Cline-family adapters with provider-only/cwd-optional honesty rules.
- Preserved `/dashboard`, `/usage`, `/branches`, `Unknown branch`, `Historical unknown`, and session grouping totals through smoke checks.

Smoke results:

| Check | Result |
|---|---:|
| Backend provider/session/branch smoke suite | `<pass count>` |
| Dashboard page tests | `<pass count>` |
| Dashboard production build | `<result>` |
| Copied-live DB sessions/events/branch facts | `<counts>` |
| Copied-live DB Unknown/Historical | `<counts>` |
| Isolated rebuild wall clock | `<seconds>` |
| Isolated rebuild providers | `<provider counts>` |

Caveats:

- Antigravity `.pb` files remain provider-only and unparsed unless a JSON usage cache exists.
- Cursor Agent transcript rows are estimated when numeric token fields are absent.
- Cline-family rows are branch/project eligible only when `Current Workspace Directory (...)` contains an absolute path.
```

Replace bracket placeholders with actual smoke numbers before committing.

- [ ] **Step 7: Commit**

```bash
git add PROJECT.md
git commit -m "docs: record phase 3 provider breadth smoke"
```

## Final Audit Gate For Phase 3

Run personally after all task reviewers are GREEN:

```bash
git status --short
node --test test/rollout-parser.test.js test/sessions-extractors.test.js test/local-api-source-scope.test.js
npm --prefix dashboard run build
```

Verify:

- Worktree is clean.
- All task commits exist on `agent/phase-3-tier-3-4-provider-breadth`.
- No provider adapter writes `vibedeck_branch_usage_facts` directly.
- New providers with missing cwd remain provider-only/unattributed.
- Unknown branch and Historical unknown are visible after copied-live and isolated rebuild smoke.
- Grouped and raw sessions remain additive; no Phase 3 provider invents group edges.

## Self-Review Checklist

- Spec coverage: Phase 3 spec providers are covered: Gemini/OpenClaw/Kiro hardening; Droid/Qwen; Cursor Agent/Antigravity; IBM Bob/Roo/KiloCode. Existing Hermes/Kimi/CodeBuddy/Craft remain smoke-covered but are not rewritten.
- Placeholder scan: this plan intentionally uses replacement markers only inside the `PROJECT.md` template step, and that step explicitly requires replacing them with measured smoke values before commit. No implementation step contains `TBD`, `TODO`, or unspecified commands.
- Type consistency: provider ids are lowercase and stable: `droid`, `qwen`, `cursor-agent`, `antigravity`, `ibm-bob`, `roo`, `kilocode`, `gemini`, `openclaw`, `kiro`.
- Safety: cwd uses only `cleanAbsoluteCwd`; adapter cost fields do not become canonical visible dollars; branch/project facts are only produced through canonical session processing.
