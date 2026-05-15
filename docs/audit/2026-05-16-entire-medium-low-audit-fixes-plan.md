# Entire Medium/Low Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the remaining medium/low `/entire` audit findings without changing the new dashboard layout or the high-risk destructive/performance flows.

**Architecture:** Keep the current `/entire` card/timeline UI intact. Apply small, test-driven fixes to legacy inspector polish, configure argument parsing, repo-state cache aliases, and checkpoint path validation. Use the same execution loop as the previous phase: one implementer per task and one reviewer per task; if review red-flags a task, send fixes back to the same implementer, then back to the same reviewer until green.

**Tech Stack:** React 18, Vitest, Node `node:test`, CommonJS backend helpers, SQLite via `node:sqlite`.

---

## Execution Rules

- Do not include the high-risk confirm-token bridge cleanup in this phase.
- Do not include checkpoint usage hydration performance changes in this phase.
- Do not rewrite the `/entire` page layout, `CheckpointTimeline`, or `CheckpointCard` unless a test reveals a direct regression.
- Each task gets exactly one implementer and one reviewer.
- If the reviewer finds bugs, pass the reviewer findings to the same implementer.
- Re-review with the same reviewer until the reviewer gives a green flag.
- Commit after each green-flagged task.

## Files

- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`
- Modify: `dashboard/src/components/entire/AdvancedConfigurePanel.jsx`
- Create: `dashboard/src/components/entire/AdvancedConfigurePanel.test.jsx`
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `src/lib/db/repos.js`
- Modify: `test/local-api-vibedeck-repo-state.test.js`
- Create: `src/lib/entire-checkpoint-paths.js`
- Modify: `src/lib/entire-bridge.js`
- Modify: `src/lib/local-api.js`
- Modify: `test/entire-bridge-checkpoint-read.test.js`
- Modify: `test/local-api-vibedeck-checkpoints.test.js`
- Modify: `docs/audit/2026-05-16.md`

## Task 1: Legacy Checkpoint Inspector Polish

**Files:**
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`

- [ ] **Step 1: Add failing tests for parse errors, truncation, and clipboard feedback**

Add tests to `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`:

```jsx
it("surfaces JSON parse errors in preview mode", () => {
  render(
    <CheckpointFileInspector
      file={{
        path: "06/e2abdc1ec6/bad.json",
        file_name: "bad.json",
        kind: "json",
        raw: "{\"broken\": }",
        parsed: null,
        parse_error: "Unexpected token }",
        size_bytes: 12,
        line_count: 1,
      }}
    />,
  );

  expect(screen.getByText("Parse error")).toBeTruthy();
  expect(screen.getByText("Unexpected token }")).toBeTruthy();
});

it("caps large raw payload rendering and shows truncation state", () => {
  const raw = "x".repeat(16000);
  render(
    <CheckpointFileInspector
      file={{
        path: "06/e2abdc1ec6/0/full.jsonl",
        file_name: "full.jsonl",
        kind: "jsonl",
        raw,
        parsed: { valid_lines: 1, invalid_lines: 0, preview: [] },
        size_bytes: raw.length,
        line_count: 1,
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Raw" }));

  expect(screen.getByText(/Preview truncated/)).toBeTruthy();
  expect(screen.queryByText(raw)).toBeNull();
});

it("shows clipboard success and failure states", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });

  render(
    <CheckpointFileInspector
      file={{
        path: "06/e2abdc1ec6/0/prompt.txt",
        file_name: "prompt.txt",
        kind: "text",
        raw: "Quality review",
        parsed: null,
        size_bytes: 14,
        line_count: 1,
      }}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Copied")).toBeTruthy();

  writeText.mockRejectedValueOnce(new Error("denied"));
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByText("Copy failed")).toBeTruthy();
});
```

Also update the test imports to include `fireEvent`, `waitFor` if needed, and `vi`.

- [ ] **Step 2: Run the focused inspector tests and confirm failure**

Run:

```bash
npm --prefix dashboard run test -- CheckpointFileInspector.test.jsx
```

Expected: FAIL because parse-error, truncation, and clipboard status UI do not exist yet.

- [ ] **Step 3: Implement bounded preview and clipboard status**

In `CheckpointFileInspector.jsx`, add small helpers and state:

```jsx
const TEXT_PREVIEW_LIMIT = 12000;

function truncateText(value, limit = TEXT_PREVIEW_LIMIT) {
  const text = String(value || "");
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function stringifyPreview(value) {
  try {
    return truncateText(JSON.stringify(value, null, 2));
  } catch {
    return truncateText("");
  }
}
```

Inside the component:

```jsx
const [copyStatus, setCopyStatus] = useState("");
const rawPreview = useMemo(() => truncateText(file?.raw || ""), [file?.raw]);
const parsedPreview = useMemo(() => stringifyPreview(file?.parsed), [file?.parsed]);

async function handleCopy() {
  try {
    await navigator.clipboard?.writeText(file?.raw || "");
    setCopyStatus("Copied");
  } catch {
    setCopyStatus("Copy failed");
  }
}
```

Replace the copy button handler with `onClick={handleCopy}` and render `copyStatus` near the button.

Use `rawPreview.text` in raw views and `parsedPreview.text` in parsed views. When `rawPreview.truncated` or `parsedPreview.truncated` is true, render text like:

```jsx
<div className="mb-2 text-xs font-medium text-oai-amber-700 dark:text-oai-amber-300">
  Preview truncated to 12,000 characters.
</div>
```

When `file.parse_error` is present, render:

```jsx
<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
  <div className="font-semibold">Parse error</div>
  <div className="mt-1 break-words">{file.parse_error}</div>
</div>
```

- [ ] **Step 4: Run focused inspector tests and fix until green**

Run:

```bash
npm --prefix dashboard run test -- CheckpointFileInspector.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit task 1**

```bash
git add dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/components/entire/CheckpointFileInspector.test.jsx
git commit -m "fix: polish checkpoint file inspector"
```

## Task 2: Configure Parser Quoting

**Files:**
- Modify: `dashboard/src/components/entire/AdvancedConfigurePanel.jsx`
- Create: `dashboard/src/components/entire/AdvancedConfigurePanel.test.jsx`

- [ ] **Step 1: Add failing tests for quoted args and unmatched quotes**

Create `dashboard/src/components/entire/AdvancedConfigurePanel.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { AdvancedConfigurePanel } from "./AdvancedConfigurePanel.jsx";

const postEntireCommand = vi.fn();

vi.mock("../../lib/vibedeck-api", () => ({
  postEntireCommand: (...args) => postEntireCommand(...args),
}));

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  postEntireCommand.mockReset();
  postEntireCommand.mockResolvedValue({ ok: true, stdout: "configured" });
  window.localStorage.clear();
});

describe("AdvancedConfigurePanel", () => {
  it("preserves simple whitespace args", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" />);

    fireEvent.change(screen.getByPlaceholderText("--arg value --flag"), {
      target: { value: "--agent codex --mode careful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("configure", {
        repo: "/tmp/project",
        args: ["--agent", "codex", "--mode", "careful"],
      });
    });
  });

  it("keeps quoted values as one arg", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" />);

    fireEvent.change(screen.getByPlaceholderText("--arg value --flag"), {
      target: { value: '--label "Product Review" --agent codex' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("configure", {
        repo: "/tmp/project",
        args: ["--label", "Product Review", "--agent", "codex"],
      });
    });
  });

  it("shows a parse error for unmatched quotes and does not call configure", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" />);

    fireEvent.change(screen.getByPlaceholderText("--arg value --flag"), {
      target: { value: '--label "Product Review' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    expect(await screen.findByText("Unmatched quote in configure arguments.")).toBeTruthy();
    expect(postEntireCommand).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run focused configure tests and confirm failure**

Run:

```bash
npm --prefix dashboard run test -- AdvancedConfigurePanel.test.jsx
```

Expected: FAIL because quoted parsing and parse errors do not exist yet.

- [ ] **Step 3: Implement a minimal parser**

In `AdvancedConfigurePanel.jsx`, replace `parseArgv` with:

```jsx
function parseArgv(raw) {
  const text = String(raw || "");
  const args = [];
  let current = "";
  let quote = "";
  let escaping = false;

  for (const ch of text) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === "\\") {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }

  if (escaping) current += "\\";
  if (quote) throw new Error("Unmatched quote in configure arguments.");
  if (current) args.push(current);
  return args;
}
```

In `runConfigure`, catch parser errors before the API call:

```jsx
let args;
try {
  args = parseArgv(argsText);
} catch (cause) {
  setOutput(cause instanceof Error ? cause.message : copy("entire.configure.error_fallback"));
  setBusy(false);
  return;
}
```

- [ ] **Step 4: Run focused configure tests and fix until green**

Run:

```bash
npm --prefix dashboard run test -- AdvancedConfigurePanel.test.jsx EntirePage.actions.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit task 2**

```bash
git add dashboard/src/components/entire/AdvancedConfigurePanel.jsx dashboard/src/components/entire/AdvancedConfigurePanel.test.jsx
git commit -m "fix: parse configure arguments safely"
```

## Task 3: Repo Remove Error Copy

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Modify: `dashboard/src/content/copy.csv`

- [ ] **Step 1: Add failing test for hide/remove fallback**

Add to `dashboard/src/pages/EntirePage.test.jsx`:

```jsx
it("shows a remove-specific fallback when hiding a repo fails without an Error", async () => {
  getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/workspace/repo-02" }] });
  getBranchUsage.mockResolvedValue({ repos: [] });
  getEntireStatus.mockResolvedValue({ state: "active" });
  getCheckpoints.mockResolvedValue({ available: true, files: [] });
  hideKnownRepo.mockRejectedValue("failed");

  render(<EntirePage />);

  await screen.findByRole("button", { name: "Remove recent repo repo-02" });
  fireEvent.click(screen.getByRole("button", { name: "Remove recent repo repo-02" }));

  expect(await screen.findByText("Unable to remove recent repository.")).toBeTruthy();
});
```

- [ ] **Step 2: Run focused page test and confirm failure**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: FAIL because the fallback still uses the absolute-path validation copy.

- [ ] **Step 3: Add copy key and use it**

Add to `dashboard/src/content/copy.csv`:

```csv
entire.repo.remove.error_fallback,dashboard,EntirePage,RecentReposPane,error_fallback,Unable to remove recent repository.,,active
```

In `EntirePage.jsx`, replace:

```jsx
const message = cause instanceof Error ? cause.message : copy("entire.repo.validation.absolute_path");
```

with:

```jsx
const message = cause instanceof Error ? cause.message : copy("entire.repo.remove.error_fallback");
```

- [ ] **Step 4: Run focused page test and fix until green**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit task 3**

```bash
git add dashboard/src/pages/EntirePage.jsx dashboard/src/pages/EntirePage.test.jsx dashboard/src/content/copy.csv
git commit -m "fix: clarify recent repo removal errors"
```

## Task 4: Alias-Aware Repo-State Lookup

**Files:**
- Modify: `src/lib/db/repos.js`
- Modify: `test/local-api-vibedeck-repo-state.test.js`

- [ ] **Step 1: Add failing alias lookup test**

Add to `test/local-api-vibedeck-repo-state.test.js`:

```js
test("vibedeck-entire-status resolves cached state through repo root aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-local-api-repo-state-alias-"));
  const repoDir = path.join(root, "repo");
  const aliasDir = path.join(root, "repo-alias");
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

  await fs.mkdir(repoDir, { recursive: true });
  await fs.symlink(repoDir, aliasDir, "dir");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");

  ensureSchema(dbPath);
  upsertEntireState(dbPath, {
    repoRoot: repoDir,
    entire_state: "active",
    entire_version: "0.43.0",
  });

  const mod = require("../src/lib/local-api");
  const handler = mod.createLocalApiHandler({ queuePath });
  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL(
      `http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(aliasDir)}&cached=1`,
    ),
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body.toString("utf8"));
  assert.equal(payload.cached_state, "active");
  assert.equal(payload.cached_version, "0.43.0");
});
```

- [ ] **Step 2: Run focused backend test and confirm failure**

Run:

```bash
node --test test/local-api-vibedeck-repo-state.test.js
```

Expected: FAIL because `getRepoState` performs exact lookup only.

- [ ] **Step 3: Make `getRepoState` alias-aware**

In `src/lib/db/repos.js`, update `getRepoState`:

```js
function getRepoState(dbPath, repoRoot) {
  const aliases = repoRootAliases(repoRoot);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const alias of aliases) {
      const row = db.prepare('SELECT * FROM vibedeck_repos WHERE repo_root = ?').get(alias);
      if (row) return row;
    }
    return null;
  } finally {
    db.close();
  }
}
```

- [ ] **Step 4: Run focused backend test and fix until green**

Run:

```bash
node --test test/local-api-vibedeck-repo-state.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit task 4**

```bash
git add src/lib/db/repos.js test/local-api-vibedeck-repo-state.test.js
git commit -m "fix: resolve cached repo state through aliases"
```

## Task 5: Checkpoint Path Validation Hardening

**Files:**
- Create: `src/lib/entire-checkpoint-paths.js`
- Modify: `src/lib/entire-bridge.js`
- Modify: `src/lib/local-api.js`
- Modify: `test/entire-bridge-checkpoint-read.test.js`
- Modify: `test/local-api-vibedeck-checkpoints.test.js`

- [ ] **Step 1: Add failing bridge tests for invalid paths**

Add to `test/entire-bridge-checkpoint-read.test.js`:

```js
test("readCheckpoint rejects traversal and absolute checkpoint paths before shelling out", async () => {
  const repo = makeRepo();
  try {
    const invalidPaths = [
      "../metadata.json",
      "06/e2abdc1ec6/../metadata.json",
      "06\\e2abdc1ec6\\..\\metadata.json",
      "/06/e2abdc1ec6/metadata.json",
      "C:\\repo\\metadata.json",
      "06/%2e%2e/metadata.json",
      "06/e2abdc1ec6/\0metadata.json",
    ];

    for (const invalidPath of invalidPaths) {
      await assert.rejects(
        () => readCheckpoint(repo, invalidPath),
        /invalid filePath/,
      );
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing local API test for invalid checkpoint paths**

Add to `test/local-api-vibedeck-checkpoints.test.js`:

```js
test("vibedeck checkpoint endpoint rejects encoded traversal paths", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-invalid-checkpoint-path-"));
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [] }),
    readCheckpoint: async () => ({ ok: true }),
    getEntireRepoStatus: async () => ({ state: "active" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(repoDir, "queue.jsonl") });
    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(
        `http://127.0.0.1/functions/vibedeck-checkpoint?repo=${encodeURIComponent(repoDir)}&path=${encodeURIComponent("06/%2e%2e/metadata.json")}`,
      ),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body.toString("utf8")).error, "invalid_checkpoint_path");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run focused path tests and confirm failure**

Run:

```bash
node --test test/entire-bridge-checkpoint-read.test.js test/local-api-vibedeck-checkpoints.test.js
```

Expected: FAIL because path validation does not yet normalize backslashes or encoded traversal.

- [ ] **Step 4: Create shared validation helper**

Create `src/lib/entire-checkpoint-paths.js`:

```js
'use strict';

const path = require('node:path');

function decodeCheckpointPath(value) {
  const raw = String(value || '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeCheckpointPath(value) {
  const decoded = decodeCheckpointPath(value);
  return decoded.replace(/\\/g, '/');
}

function isValidCheckpointPath(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (value.includes('\0')) return false;
  const normalized = normalizeCheckpointPath(value);
  if (!normalized || normalized.includes('\0')) return false;
  if (normalized.startsWith('/')) return false;
  if (/^[A-Za-z]:\//.test(normalized)) return false;
  const parts = normalized.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return false;
  const resolved = path.posix.normalize(normalized);
  if (resolved === '.' || resolved.startsWith('../') || resolved.includes('/../')) return false;
  return resolved === normalized;
}

module.exports = {
  normalizeCheckpointPath,
  isValidCheckpointPath,
};
```

- [ ] **Step 5: Use shared validation in bridge and API**

In `src/lib/entire-bridge.js`, import:

```js
const { isValidCheckpointPath, normalizeCheckpointPath } = require('./entire-checkpoint-paths');
```

Replace the inline `readCheckpoint` validation with:

```js
if (!isValidCheckpointPath(filePath)) {
  throw new Error(`readCheckpoint: invalid filePath: ${filePath}`);
}
const safeFilePath = normalizeCheckpointPath(filePath);
```

Use `safeFilePath` in the `git show` argument and `buildCheckpointPayload`.

In `src/lib/local-api.js`, import:

```js
const { isValidCheckpointPath } = require("./entire-checkpoint-paths");
```

Delete the local `isValidCheckpointPath` function so the endpoint uses the shared helper.

- [ ] **Step 6: Run focused path tests and fix until green**

Run:

```bash
node --test test/entire-bridge-checkpoint-read.test.js test/local-api-vibedeck-checkpoints.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit task 5**

```bash
git add src/lib/entire-checkpoint-paths.js src/lib/entire-bridge.js src/lib/local-api.js test/entire-bridge-checkpoint-read.test.js test/local-api-vibedeck-checkpoints.test.js
git commit -m "fix: harden checkpoint path validation"
```

## Task 6: Final Audit Update and Verification

**Files:**
- Modify: `docs/audit/2026-05-16.md`

- [ ] **Step 1: Update the audit report**

After tasks 1-5 are complete, update `docs/audit/2026-05-16.md`:

```markdown
## Implementation Update

Medium/low phase completed:
- Legacy checkpoint inspector now caps large raw/parsed previews, shows truncation state, surfaces parse errors, and reports clipboard copy success/failure.
- Configure command parsing now preserves quoted values and reports unmatched quote errors before calling the backend.
- Recent repo removal now uses an operation-specific fallback message.
- Cached repo-state lookup now resolves raw path and realpath aliases.
- Checkpoint path validation now rejects traversal, absolute paths, backslash traversal, encoded traversal, Windows-style absolute paths, and NUL bytes through a shared helper.

Still deferred:
- Bridge-level destructive confirm-token contract cleanup.
- Checkpoint usage hydration performance work.
```

- [ ] **Step 2: Run focused full verification**

Run:

```bash
npm --prefix dashboard run test -- CheckpointFileInspector.test.jsx AdvancedConfigurePanel.test.jsx EntirePage.test.jsx EntirePage.actions.test.jsx
node --test test/local-api-vibedeck-repo-state.test.js test/entire-bridge-checkpoint-read.test.js test/local-api-vibedeck-checkpoints.test.js
npm --prefix dashboard run build
```

Expected:
- Dashboard focused tests pass.
- Node focused tests pass.
- Dashboard build passes. Existing Vite chunk-size warnings are acceptable if unchanged.

- [ ] **Step 3: Commit final audit update**

```bash
git add docs/audit/2026-05-16.md
git commit -m "docs: update entire audit after medium low fixes"
```

## Final Review Checklist

- The new `/entire` card/timeline UI remains unchanged.
- No confirm-token bridge behavior is changed in this phase.
- No checkpoint usage hydration performance behavior is changed in this phase.
- All simple configure args still parse exactly as before.
- Valid checkpoint file paths still load.
- Invalid checkpoint traversal paths return a controlled 400 or bridge validation error.
- The audit file clearly lists completed medium/low work and deferred high-risk work.
