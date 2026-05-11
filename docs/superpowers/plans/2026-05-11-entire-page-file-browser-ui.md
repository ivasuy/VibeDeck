# Entire Page File Browser UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/entire` a professional checkpoint inspector that opens metadata, JSONL, text, and hash files correctly, uses screen space well, and presents recent repos as readable repo chips.

**Architecture:** Fix the backend checkpoint read contract first so the UI receives typed file payloads instead of assuming every checkpoint file is JSON. Then split the frontend into a checkpoint navigator and file inspector inside a three-column dashboard surface. Keep action/config state persistence intact and make recent repos scan by repo name instead of raw path.

**Tech Stack:** Node local API, `execa` Git shell-outs, React, Vitest, Testing Library, Tailwind utility classes, lucide-react icons, existing OpenAI-style UI primitives.

---

## File Structure

- Modify: `src/lib/entire-bridge.js`
  - Responsibility: list Entire checkpoint files and read one checkpoint file from `entire/checkpoints/v1`.
  - Add typed file classification and safe parsing for JSON, JSONL, text, and hash files.

- Modify: `src/lib/local-api.js`
  - Responsibility: serve `/functions/vibedeck-checkpoint`.
  - Keep route shape but return the new typed checkpoint file payload.

- Modify: `test/entire-bridge-status.test.js` or create `test/entire-bridge-checkpoint-read.test.js`
  - Responsibility: prove non-JSON checkpoint files do not throw and return useful payloads.
  - Prefer a new focused test file.

- Modify: `dashboard/src/lib/vibedeck-api.ts`
  - Responsibility: document the new checkpoint payload shape in local TypeScript types.

- Modify: `dashboard/src/components/entire/RepoPathSelector.jsx`
  - Responsibility: render recent repos as compact, deduped, readable chips.

- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
  - Responsibility: become the checkpoint browser shell with grouped checkpoint navigation and a wide inspector.
  - Keep this file if the implementation remains readable.

- Create: `dashboard/src/components/entire/checkpoint-file-utils.js`
  - Responsibility: pure helpers for checkpoint grouping, file type labels, repo chip labels, and preview formatting.

- Create: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
  - Responsibility: render one typed checkpoint file payload with Preview, Raw, and Parsed views.

- Create: `dashboard/src/components/entire/CheckpointNavigator.jsx`
  - Responsibility: render grouped checkpoint files and file rows with icons.

- Modify: `dashboard/src/pages/EntirePage.jsx`
  - Responsibility: update page grid layout to better use horizontal space.

- Modify: `dashboard/src/pages/EntirePage.test.jsx`
  - Responsibility: cover recent repo chips and typed checkpoint file display.

- Modify: `dashboard/src/pages/EntirePage.actions.test.jsx`
  - Responsibility: adjust action/control queries if the layout changes labels or grouping.

---

### Task 1: Backend Typed Checkpoint File Contract

**Files:**
- Modify: `src/lib/entire-bridge.js`
- Test: `test/entire-bridge-checkpoint-read.test.js`

- [ ] **Step 1: Write the failing backend tests**

Create `test/entire-bridge-checkpoint-read.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { readCheckpoint } = require("../src/lib/entire-bridge");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-entire-read-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["checkout", "-b", "entire/checkpoints/v1"], { cwd: dir, stdio: "ignore" });
  fs.mkdirSync(path.join(dir, "06", "e2abdc1ec6", "0"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "06", "e2abdc1ec6", "metadata.json"),
    JSON.stringify({ cli_version: "0.6.1", branch: "publish-main", checkpoints_count: 0 }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "06", "e2abdc1ec6", "0", "prompt.txt"), "Quality review\nLine two\n");
  fs.writeFileSync(path.join(dir, "06", "e2abdc1ec6", "0", "content_hash.txt"), "sha256:abc123\n");
  fs.writeFileSync(
    path.join(dir, "06", "e2abdc1ec6", "0", "full.jsonl"),
    `${JSON.stringify({ type: "start", id: 1 })}\n${JSON.stringify({ type: "end", id: 2 })}\n`,
  );
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "checkpoints"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("readCheckpoint returns parsed JSON metadata", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/metadata.json");
    assert.equal(file.kind, "json");
    assert.equal(file.path, "06/e2abdc1ec6/metadata.json");
    assert.equal(file.file_name, "metadata.json");
    assert.equal(file.parsed.branch, "publish-main");
    assert.equal(file.parse_error, null);
    assert.match(file.raw, /publish-main/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns plain text prompt files without JSON parse failure", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/prompt.txt");
    assert.equal(file.kind, "text");
    assert.equal(file.parsed, null);
    assert.equal(file.line_count, 2);
    assert.match(file.raw, /Quality review/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns content hash files as hash payloads", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/content_hash.txt");
    assert.equal(file.kind, "hash");
    assert.equal(file.parsed.algorithm, "sha256");
    assert.equal(file.parsed.value, "abc123");
    assert.equal(file.parse_error, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns JSONL summary without parsing the whole file as JSON", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/full.jsonl");
    assert.equal(file.kind, "jsonl");
    assert.equal(file.line_count, 2);
    assert.equal(file.parsed.valid_lines, 2);
    assert.equal(file.parsed.invalid_lines, 0);
    assert.deepEqual(file.parsed.preview[0], { line: 1, value: { type: "start", id: 1 } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk node --test test/entire-bridge-checkpoint-read.test.js
```

Expected: FAIL. The text/hash/JSONL tests fail because `readCheckpoint()` currently calls `JSON.parse(stdout)` for every file.

- [ ] **Step 3: Implement typed checkpoint parsing**

Modify `src/lib/entire-bridge.js`. Add these helpers near `readCheckpoint`:

```js
function checkpointKind(filePath) {
  const name = path.basename(filePath);
  if (name === "content_hash.txt") return "hash";
  if (name.endsWith(".jsonl")) return "jsonl";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".txt")) return "text";
  return "unknown";
}

function lineCount(raw) {
  const text = String(raw || "");
  if (!text) return 0;
  return text.replace(/\n$/, "").split(/\r?\n/).length;
}

function parseHash(raw) {
  const text = String(raw || "").trim();
  const match = text.match(/^([A-Za-z0-9_-]+):(.+)$/);
  if (!match) return { algorithm: null, value: text };
  return { algorithm: match[1], value: match[2] };
}

function parseJsonl(raw, { previewLimit = 50 } = {}) {
  const preview = [];
  let validLines = 0;
  let invalidLines = 0;
  const lines = String(raw || "").replace(/\n$/, "").split(/\r?\n/).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    try {
      const value = JSON.parse(line);
      validLines += 1;
      if (preview.length < previewLimit) preview.push({ line: index + 1, value });
    } catch (err) {
      invalidLines += 1;
      if (preview.length < previewLimit) {
        preview.push({ line: index + 1, error: err?.message || String(err), raw: line.slice(0, 500) });
      }
    }
  }
  return { valid_lines: validLines, invalid_lines: invalidLines, preview };
}

function buildCheckpointPayload(filePath, raw) {
  const kind = checkpointKind(filePath);
  const base = {
    path: filePath,
    file_name: path.basename(filePath),
    extension: path.extname(filePath).replace(/^\./, ""),
    kind,
    raw,
    parsed: null,
    parse_error: null,
    size_bytes: Buffer.byteLength(String(raw || ""), "utf8"),
    line_count: lineCount(raw),
  };

  if (kind === "json") {
    try {
      return { ...base, parsed: JSON.parse(raw) };
    } catch (err) {
      return { ...base, parse_error: err?.message || String(err) };
    }
  }
  if (kind === "jsonl") return { ...base, parsed: parseJsonl(raw) };
  if (kind === "hash") return { ...base, parsed: parseHash(raw) };
  return base;
}
```

Replace the final line of `readCheckpoint()`:

```js
return JSON.parse(stdout);
```

with:

```js
return buildCheckpointPayload(filePath, stdout);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
rtk node --test test/entire-bridge-checkpoint-read.test.js
```

Expected: PASS.

- [ ] **Step 5: Run existing Entire backend tests**

Run:

```bash
rtk node --test test/entire-bridge-status.test.js test/entire-bridge-shell-outs.test.js test/local-api-vibedeck-known-repos.test.js test/local-api-vibedeck-repo-state.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/entire-bridge.js test/entire-bridge-checkpoint-read.test.js
git commit -m "Fix Entire checkpoint file reading"
```

---

### Task 2: Checkpoint File Utilities

**Files:**
- Create: `dashboard/src/components/entire/checkpoint-file-utils.js`
- Test: `dashboard/src/components/entire/checkpoint-file-utils.test.js`

- [ ] **Step 1: Write utility tests**

Create `dashboard/src/components/entire/checkpoint-file-utils.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  checkpointFileIconName,
  checkpointFileLabel,
  groupCheckpointFiles,
  repoChipParts,
} from "./checkpoint-file-utils";

describe("checkpoint-file-utils", () => {
  it("groups checkpoint files by checkpoint id prefix", () => {
    const groups = groupCheckpointFiles([
      "06/e2abdc1ec6/metadata.json",
      "06/e2abdc1ec6/0/full.jsonl",
      "06/e2abdc1ec6/0/prompt.txt",
      "23/183a892518/1/content_hash.txt",
    ]);

    expect(groups).toEqual([
      {
        id: "06/e2abdc1ec6",
        label: "06/e2abdc1ec6",
        files: [
          "06/e2abdc1ec6/metadata.json",
          "06/e2abdc1ec6/0/full.jsonl",
          "06/e2abdc1ec6/0/prompt.txt",
        ],
      },
      {
        id: "23/183a892518",
        label: "23/183a892518",
        files: ["23/183a892518/1/content_hash.txt"],
      },
    ]);
  });

  it("labels checkpoint file types", () => {
    expect(checkpointFileLabel("06/e2abdc1ec6/metadata.json")).toBe("Metadata");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/full.jsonl")).toBe("JSONL");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/prompt.txt")).toBe("Prompt");
    expect(checkpointFileLabel("06/e2abdc1ec6/0/content_hash.txt")).toBe("Hash");
  });

  it("maps file types to stable icon names", () => {
    expect(checkpointFileIconName("metadata.json")).toBe("json");
    expect(checkpointFileIconName("full.jsonl")).toBe("jsonl");
    expect(checkpointFileIconName("prompt.txt")).toBe("text");
    expect(checkpointFileIconName("content_hash.txt")).toBe("hash");
  });

  it("builds readable repo chip labels from absolute paths", () => {
    expect(repoChipParts("/Users/vasuyadav/Downloads/Projects/switchyard")).toEqual({
      name: "switchyard",
      context: "Projects",
      fullPath: "/Users/vasuyadav/Downloads/Projects/switchyard",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix dashboard run test -- checkpoint-file-utils.test.js
```

Expected: FAIL because `checkpoint-file-utils.js` does not exist.

- [ ] **Step 3: Implement utility module**

Create `dashboard/src/components/entire/checkpoint-file-utils.js`:

```js
function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function basename(value) {
  const parts = normalizePath(value).split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function parentName(value) {
  const parts = normalizePath(value).split("/").filter(Boolean);
  return parts.length > 1 ? parts.at(-2) : "";
}

export function checkpointGroupId(filePath) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length >= 2 && /^[a-f0-9]{2}$/i.test(parts[0])) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 1) return parts[0];
  return "unknown";
}

export function checkpointFileLabel(filePath) {
  const name = basename(filePath);
  if (name === "metadata.json") return "Metadata";
  if (name === "full.jsonl") return "JSONL";
  if (name === "prompt.txt") return "Prompt";
  if (name === "content_hash.txt") return "Hash";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".jsonl")) return "JSONL";
  if (name.endsWith(".txt")) return "Text";
  return "File";
}

export function checkpointFileIconName(filePath) {
  const name = basename(filePath);
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".jsonl")) return "jsonl";
  if (name === "content_hash.txt") return "hash";
  if (name.endsWith(".txt")) return "text";
  return "file";
}

export function groupCheckpointFiles(files) {
  const byId = new Map();
  for (const filePath of Array.isArray(files) ? files : []) {
    const clean = normalizePath(filePath);
    if (!clean) continue;
    const id = checkpointGroupId(clean);
    if (!byId.has(id)) byId.set(id, { id, label: id, files: [] });
    byId.get(id).files.push(clean);
  }
  return Array.from(byId.values()).map((group) => ({
    ...group,
    files: group.files.sort((a, b) => {
      const order = { "metadata.json": 0, "prompt.txt": 1, "full.jsonl": 2, "content_hash.txt": 3 };
      const aOrder = order[basename(a)] ?? 10;
      const bOrder = order[basename(b)] ?? 10;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    }),
  }));
}

export function repoChipParts(repoPath) {
  const fullPath = String(repoPath || "").trim();
  return {
    name: basename(fullPath) || fullPath,
    context: parentName(fullPath),
    fullPath,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix dashboard run test -- checkpoint-file-utils.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add dashboard/src/components/entire/checkpoint-file-utils.js dashboard/src/components/entire/checkpoint-file-utils.test.js
git commit -m "Add Entire checkpoint file utilities"
```

---

### Task 3: Professional Recent Repos Chips

**Files:**
- Modify: `dashboard/src/components/entire/RepoPathSelector.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Uses: `dashboard/src/components/entire/checkpoint-file-utils.js`

- [ ] **Step 1: Write failing recent repo chip test**

Add this test to `dashboard/src/pages/EntirePage.test.jsx`:

```jsx
it("renders recent repos as readable deduped chips", async () => {
  getKnownRepos.mockResolvedValue({
    repos: [
      { repo_root: "/Users/dev/Projects/switchyard" },
      { repo_root: "/Users/dev/Projects/VibeDeck" },
      { repo_root: "/Users/dev/Projects/switchyard" },
    ],
  });
  getBranchUsage.mockResolvedValue({ repos: [] });
  getEntireStatus.mockResolvedValue({ state: "active" });
  getCheckpoints.mockResolvedValue({ available: true, files: [] });

  render(<EntirePage />);

  expect(await screen.findByRole("button", { name: /Load recent repo switchyard/i })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Load recent repo VibeDeck/i })).toBeTruthy();
  expect(screen.getAllByText("switchyard")).toHaveLength(1);
  expect(screen.getAllByText("Projects").length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: FAIL because recent repos are raw path buttons without accessible repo-name labels.

- [ ] **Step 3: Implement repo chips**

Modify `dashboard/src/components/entire/RepoPathSelector.jsx`:

Add import:

```js
import { repoChipParts } from "./checkpoint-file-utils";
```

Replace the recent repo button markup inside `uniqueSuggestions.map((repo) => (` with:

```jsx
{uniqueSuggestions.slice(0, 8).map((repo) => {
  const parts = repoChipParts(repo);
  return (
    <button
      key={repo}
      type="button"
      className={cn(
        "grid h-10 w-[180px] shrink-0 rounded-md border border-oai-gray-200 bg-oai-black/[0.03] px-2.5 py-1 text-left transition-colors hover:border-oai-gray-300 hover:bg-oai-black/[0.06]",
        "dark:border-oai-gray-800 dark:bg-white/[0.06] dark:hover:border-oai-gray-700 dark:hover:bg-white/[0.1]",
      )}
      title={parts.fullPath}
      aria-label={`Load recent repo ${parts.name}`}
      onClick={() => {
        onChange?.(repo);
        submitPath(repo);
      }}
    >
      <span className="truncate text-xs font-medium text-oai-black dark:text-white">{parts.name}</span>
      <span className="truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">{parts.context}</span>
    </button>
  );
})}
```

Add a compact overflow count after the mapped chips:

```jsx
{uniqueSuggestions.length > 8 ? (
  <span className="inline-flex h-10 shrink-0 items-center rounded-md border border-oai-gray-200 px-2.5 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
    +{uniqueSuggestions.length - 8} more
  </span>
) : null}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add dashboard/src/components/entire/RepoPathSelector.jsx dashboard/src/pages/EntirePage.test.jsx
git commit -m "Refine Entire recent repo chips"
```

---

### Task 4: Checkpoint File Inspector

**Files:**
- Create: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`

- [ ] **Step 1: Write failing UI tests for typed file previews**

Add this test to `dashboard/src/pages/EntirePage.test.jsx`:

```jsx
it("opens text, hash, jsonl, and metadata checkpoint files without parse errors", async () => {
  getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
  getBranchUsage.mockResolvedValue({ repos: [] });
  getEntireStatus.mockResolvedValue({ state: "active" });
  getCheckpoints.mockResolvedValue({
    available: true,
    files: [
      "06/e2abdc1ec6/metadata.json",
      "06/e2abdc1ec6/0/prompt.txt",
      "06/e2abdc1ec6/0/full.jsonl",
      "06/e2abdc1ec6/0/content_hash.txt",
    ],
  });
  getCheckpoint.mockImplementation((_repo, filePath) => {
    if (filePath.endsWith("metadata.json")) {
      return Promise.resolve({
        path: filePath,
        file_name: "metadata.json",
        kind: "json",
        raw: "{\"branch\":\"publish-main\"}",
        parsed: { branch: "publish-main", cli_version: "0.6.1" },
        parse_error: null,
        size_bytes: 25,
        line_count: 1,
      });
    }
    if (filePath.endsWith("prompt.txt")) {
      return Promise.resolve({
        path: filePath,
        file_name: "prompt.txt",
        kind: "text",
        raw: "Quality review\nLine two",
        parsed: null,
        parse_error: null,
        size_bytes: 23,
        line_count: 2,
      });
    }
    if (filePath.endsWith("full.jsonl")) {
      return Promise.resolve({
        path: filePath,
        file_name: "full.jsonl",
        kind: "jsonl",
        raw: "{\"type\":\"start\"}\n{\"type\":\"end\"}",
        parsed: { valid_lines: 2, invalid_lines: 0, preview: [{ line: 1, value: { type: "start" } }] },
        parse_error: null,
        size_bytes: 33,
        line_count: 2,
      });
    }
    return Promise.resolve({
      path: filePath,
      file_name: "content_hash.txt",
      kind: "hash",
      raw: "sha256:abc123",
      parsed: { algorithm: "sha256", value: "abc123" },
      parse_error: null,
      size_bytes: 13,
      line_count: 1,
    });
  });

  render(<EntirePage />);
  const input = await screen.findByPlaceholderText("/Users/you/project");
  fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
  fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

  expect(await screen.findByText("publish-main")).toBeTruthy();

  fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file Prompt/i }));
  expect(await screen.findByText("Quality review")).toBeTruthy();

  fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file JSONL/i }));
  expect(await screen.findByText("2 valid lines")).toBeTruthy();

  fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file Hash/i }));
  expect(await screen.findByText("sha256")).toBeTruthy();
  expect(screen.queryByText(/Unable to load checkpoint/)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: FAIL because the current UI has no typed inspector and file buttons do not use these accessible labels.

- [ ] **Step 3: Create `CheckpointFileInspector.jsx`**

Create `dashboard/src/components/entire/CheckpointFileInspector.jsx`:

```jsx
import React, { useMemo, useState } from "react";
import { Braces, Clipboard, FileJson, Hash, ScrollText } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { cn } from "../../lib/cn";

function iconForKind(kind) {
  if (kind === "json") return FileJson;
  if (kind === "jsonl") return Braces;
  if (kind === "hash") return Hash;
  return ScrollText;
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

function primitiveEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => item == null || ["string", "number", "boolean"].includes(typeof item));
}

export function CheckpointFileInspector({ file = null, loading = false, error = "", selectedPath = "" }) {
  const [tab, setTab] = useState("preview");
  const Icon = iconForKind(file?.kind);
  const fields = useMemo(() => primitiveEntries(file?.parsed), [file?.parsed]);

  if (loading) {
    return <div className="p-5 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading checkpoint file...</div>;
  }
  if (error) {
    return <div className="p-5 text-sm text-red-700 dark:text-red-300">Unable to load checkpoint: {error}</div>;
  }
  if (!file) {
    return <div className="p-5 text-sm text-oai-gray-500 dark:text-oai-gray-400">Select a checkpoint file.</div>;
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
            <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">{file.file_name || selectedPath}</h3>
            <span className="rounded-md bg-oai-black/[0.05] px-1.5 py-0.5 text-[11px] uppercase text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
              {file.kind}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400" title={file.path || selectedPath}>
            {file.path || selectedPath}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-oai-gray-500 dark:text-oai-gray-400">
          <div>{formatBytes(file.size_bytes)}</div>
          <div>{Number(file.line_count || 0)} lines</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-oai-gray-200 px-4 py-2 dark:border-oai-gray-800">
        <div className="inline-flex rounded-md bg-oai-black/[0.04] p-0.5 dark:bg-white/[0.08]">
          {["preview", "raw", "parsed"].map((item) => (
            <button
              key={item}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs capitalize",
                tab === item
                  ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                  : "text-oai-gray-600 dark:text-oai-gray-300",
              )}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(file.raw || "")}>
          <Clipboard className="mr-1 h-3.5 w-3.5" aria-hidden />
          Copy
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "raw" ? (
          <pre className="min-h-full whitespace-pre-wrap rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {file.raw || ""}
          </pre>
        ) : tab === "parsed" ? (
          <pre className="min-h-full overflow-auto rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {JSON.stringify(file.parsed, null, 2)}
          </pre>
        ) : file.kind === "json" ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {fields.map(([key, value]) => (
              <div key={key} className="rounded-md bg-oai-black/[0.035] px-3 py-2 text-xs dark:bg-white/[0.07]">
                <div className="uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{key}</div>
                <div className="mt-1 break-all font-medium text-oai-black dark:text-white">{String(value)}</div>
              </div>
            ))}
          </div>
        ) : file.kind === "jsonl" ? (
          <div className="space-y-3">
            <div className="text-sm font-medium text-oai-black dark:text-white">
              {file.parsed?.valid_lines || 0} valid lines
              {file.parsed?.invalid_lines ? ` · ${file.parsed.invalid_lines} invalid lines` : ""}
            </div>
            <pre className="overflow-auto rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
              {JSON.stringify(file.parsed?.preview || [], null, 2)}
            </pre>
          </div>
        ) : file.kind === "hash" ? (
          <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
            <div className="text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{file.parsed?.algorithm || "hash"}</div>
            <div className="mt-2 break-all font-mono text-sm text-oai-black dark:text-white">{file.parsed?.value || file.raw}</div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap rounded-md bg-oai-black/[0.03] p-3 text-sm leading-6 text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {file.raw || ""}
          </pre>
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run test to confirm it still fails for integration**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: FAIL until `CheckpointList.jsx` uses `CheckpointFileInspector`.

- [ ] **Step 5: Commit inspector component only if tests compile**

Run:

```bash
git add dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/pages/EntirePage.test.jsx
git commit -m "Add Entire checkpoint file inspector"
```

If the test suite cannot compile because the component is unused but imports are clean, do not commit yet; continue to Task 5 and commit the integrated browser.

---

### Task 5: Grouped Checkpoint Navigator and Integrated Browser

**Files:**
- Create: `dashboard/src/components/entire/CheckpointNavigator.jsx`
- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
- Uses: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Uses: `dashboard/src/components/entire/checkpoint-file-utils.js`

- [ ] **Step 1: Create grouped navigator**

Create `dashboard/src/components/entire/CheckpointNavigator.jsx`:

```jsx
import React from "react";
import { Braces, File, FileJson, FolderGit2, Hash, ScrollText } from "lucide-react";
import { cn } from "../../lib/cn";
import { checkpointFileIconName, checkpointFileLabel, groupCheckpointFiles } from "./checkpoint-file-utils";

function IconForFile({ filePath }) {
  const name = checkpointFileIconName(filePath);
  const Icon = name === "json" ? FileJson : name === "jsonl" ? Braces : name === "hash" ? Hash : name === "text" ? ScrollText : File;
  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

export function CheckpointNavigator({ files = [], selectedPath = "", onSelect }) {
  const groups = groupCheckpointFiles(files);
  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="shrink-0 border-b border-oai-gray-200 px-3 py-3 dark:border-oai-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-oai-black dark:text-white">Checkpoint files</h3>
          <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{files.length} files</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map((group) => (
          <div key={group.id} className="border-b border-oai-gray-200 last:border-b-0 dark:border-oai-gray-800">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{group.label}</span>
              <span className="ml-auto text-oai-gray-400 dark:text-oai-gray-500">{group.files.length}</span>
            </div>
            <div className="pb-1">
              {group.files.map((filePath) => {
                const label = checkpointFileLabel(filePath);
                return (
                  <button
                    key={filePath}
                    type="button"
                    aria-label={`Open checkpoint file ${label} ${filePath}`}
                    title={filePath}
                    onClick={() => onSelect?.(filePath)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 px-5 py-1.5 text-left text-xs transition-colors",
                      selectedPath === filePath
                        ? "bg-oai-black/[0.06] text-oai-black dark:bg-white/[0.12] dark:text-white"
                        : "text-oai-gray-600 hover:bg-oai-gray-50 dark:text-oai-gray-300 dark:hover:bg-oai-gray-900",
                    )}
                  >
                    <IconForFile filePath={filePath} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="max-w-[120px] truncate text-oai-gray-400 dark:text-oai-gray-500">{filePath.split("/").slice(2, -1).join("/")}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Replace `CheckpointList.jsx` internals**

Modify `dashboard/src/components/entire/CheckpointList.jsx`:

Use these imports:

```js
import React, { useEffect, useState } from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { CheckpointFileInspector } from "./CheckpointFileInspector";
import { CheckpointNavigator } from "./CheckpointNavigator";
```

Keep `unavailableReasonText`. Replace the loaded-state JSX with:

```jsx
<div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
  <CheckpointNavigator files={files} selectedPath={selectedPath} onSelect={setSelectedPath} />
  <CheckpointFileInspector
    file={detail}
    selectedPath={selectedPath}
    loading={detailLoading}
    error={detailError}
  />
</div>
```

Remove the old `viewMode`, `detailType`, `primitiveEntries`, and `MetaItem` code from `CheckpointList.jsx`.

- [ ] **Step 3: Run UI tests**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: PASS, including the typed file preview test from Task 4.

- [ ] **Step 4: Run action tests**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.actions.test.jsx
```

Expected: PASS. If a query fails only because a label moved, update the test query to the new accessible label while preserving behavior assertions.

- [ ] **Step 5: Commit**

Run:

```bash
git add dashboard/src/components/entire/CheckpointList.jsx dashboard/src/components/entire/CheckpointNavigator.jsx dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/pages/EntirePage.test.jsx dashboard/src/pages/EntirePage.actions.test.jsx
git commit -m "Add grouped Entire checkpoint browser"
```

---

### Task 6: Entire Page Layout and Action Panel Density

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Modify: `dashboard/src/components/entire/EntireActionsPanel.jsx`
- Modify: `dashboard/src/components/entire/EntireStatusCard.jsx`
- Test: `dashboard/src/pages/EntirePage.test.jsx`

- [ ] **Step 1: Add layout behavior assertions**

Add this test to `dashboard/src/pages/EntirePage.test.jsx`:

```jsx
it("uses a three panel checkpoint workbench after repo load", async () => {
  getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
  getBranchUsage.mockResolvedValue({ repos: [] });
  getEntireStatus.mockResolvedValue({ state: "active", version: "0.6.1" });
  getCheckpoints.mockResolvedValue({
    available: true,
    files: ["06/e2abdc1ec6/metadata.json", "06/e2abdc1ec6/0/prompt.txt"],
  });
  getCheckpoint.mockResolvedValue({
    path: "06/e2abdc1ec6/metadata.json",
    file_name: "metadata.json",
    kind: "json",
    raw: "{\"branch\":\"publish-main\"}",
    parsed: { branch: "publish-main" },
    parse_error: null,
    size_bytes: 25,
    line_count: 1,
  });

  render(<EntirePage />);
  const input = await screen.findByPlaceholderText("/Users/you/project");
  fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
  fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

  expect(await screen.findByText("Checkpoint files")).toBeTruthy();
  expect(screen.getByText("Entire status")).toBeTruthy();
  expect(screen.getByText("Actions")).toBeTruthy();
  expect(screen.getByText("metadata.json")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify current layout still passes or exposes gaps**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx
```

Expected: PASS after Task 5; if it fails, it should fail because the new panel headings are not wired.

- [ ] **Step 3: Update `EntirePage.jsx` layout**

Replace the second-level grid in `EntirePage.jsx` with:

```jsx
<div
  className={cn(
    "grid min-h-0 flex-1 gap-3 overflow-hidden",
    selectedRepo
      ? "xl:grid-cols-[320px_minmax(0,1fr)]"
      : "lg:grid-cols-[360px_minmax(0,1fr)]",
  )}
>
  <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
    <EntireStatusCard status={statusData} loading={statusLoading} error={statusError} />
    {selectedRepo ? (
      <>
        <EntireActionsPanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
        <AdvancedConfigurePanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
      </>
    ) : null}
  </div>
  <CheckpointList
    className="min-h-[360px]"
    repo={selectedRepo}
    checkpoints={checkpointsData}
    loading={checkpointsLoading}
    error={checkpointsError}
  />
</div>
```

Inside `CheckpointList`, the new `lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]` provides the middle navigator and right inspector, so the overall page becomes left controls + checkpoint workbench.

- [ ] **Step 4: Compact agent selection in `EntireActionsPanel.jsx`**

Replace the agent checkbox label class with:

```jsx
className="flex h-8 items-center gap-2 rounded-md border border-oai-gray-200 px-2.5 text-xs text-oai-gray-700 transition-colors has-[:checked]:border-oai-brand-500/40 has-[:checked]:bg-oai-brand-500/10 dark:border-oai-gray-800 dark:text-oai-gray-200"
```

Change the agent grid class from:

```jsx
<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
```

to:

```jsx
<div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-1">
```

Keep all labels and inputs intact so saved preferences and tests continue to work.

- [ ] **Step 5: Run layout/action tests**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add dashboard/src/pages/EntirePage.jsx dashboard/src/components/entire/EntireActionsPanel.jsx dashboard/src/components/entire/EntireStatusCard.jsx dashboard/src/pages/EntirePage.test.jsx
git commit -m "Refine Entire page workbench layout"
```

---

### Task 7: Final Verification and Build

**Files:**
- No source changes expected unless tests expose a real issue.

- [ ] **Step 1: Run all Entire backend tests**

Run:

```bash
rtk node --test test/entire-bridge-checkpoint-read.test.js test/entire-bridge-status.test.js test/entire-bridge-shell-outs.test.js test/local-api-vibedeck-known-repos.test.js test/local-api-vibedeck-repo-state.test.js
```

Expected: PASS.

- [ ] **Step 2: Run Entire frontend tests**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx checkpoint-file-utils.test.js
```

Expected: PASS.

- [ ] **Step 3: Run dashboard build**

Run:

```bash
npm --prefix dashboard run build
```

Expected: PASS. Existing copy registry warnings and chunk-size warning may appear; no new build error should appear.

- [ ] **Step 4: Manual smoke test**

Start or restart the local server:

```bash
rtk node bin/vibedeck.js serve
```

Open:

```text
http://127.0.0.1:7690/entire
```

Manual checks:
- Load `/Users/vasuyadav/Downloads/Projects/switchyard`.
- Recent repo chips show `switchyard`, `VibeDeck`, and other repos as readable names, not one huge raw path strip.
- Select `metadata.json`; metadata fields render.
- Select `prompt.txt`; plain text renders.
- Select `full.jsonl`; JSONL summary and raw tab render without a JSON parse error.
- Select `content_hash.txt`; hash preview renders without a JSON parse error.
- Resize the browser to a narrower width; panels should stack or remain scrollable without text overlapping.

- [ ] **Step 5: Final commit if any verification fixes were needed**

If Task 7 required source/test changes, run:

```bash
git add dashboard/src src/lib test
git commit -m "Polish Entire checkpoint browser"
```

If no changes were needed, do not create an empty commit.

---

## Edge Cases Covered

- `metadata.json` is valid JSON and shows parsed fields.
- Invalid `.json` files return `parse_error` and raw text instead of crashing the API.
- `.jsonl` files parse line-by-line and tolerate invalid lines.
- `.txt` files display as plain text.
- `content_hash.txt` displays as a hash payload.
- Empty checkpoint list still shows the existing empty state.
- Entire branch missing still shows the existing unavailable reason.
- Recent repos are deduped by exact normalized path and capped visually.
- Manually loaded repo appears immediately in recent repo chips.
- Existing saved Entire action preferences still hydrate per repo.
- Destructive actions still require confirm tokens.

## Self-Review

**Spec coverage:**  
The non-JSON file opening bug is covered by Task 1 and Task 4. The cluttered checkpoint area is covered by Task 5 and Task 6. Misaligned decks/poor use of space is covered by the checkpoint workbench layout. Recent repos mapping is covered by Task 3.

**Placeholder scan:**  
No task uses “TBD,” “TODO,” “similar to,” or generic “handle edge cases” steps. Each code-changing task has concrete code or exact replacement snippets.

**Type consistency:**  
The backend payload fields are consistently named `path`, `file_name`, `extension`, `kind`, `raw`, `parsed`, `parse_error`, `size_bytes`, and `line_count`. Frontend components consume the same names. The navigator uses `selectedPath`, `files`, and `onSelect` consistently.

