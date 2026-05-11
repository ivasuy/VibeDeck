# Entire Page File Browser UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `/entire` so recent repos live in a real removable side pane, repo/status/actions/configure render as expandable boxes, checkpoint files render as inline expandable rows, and checkpoint preview sizing stays fixed and accurate for each file type.

**Architecture:** Keep the existing local API and page route, but change the page composition from a 2-panel workbench into a left-side repo rail plus a main content column built from reusable expandable panels. Preserve the current checkpoint file payload contract from `src/lib/entire-bridge.js`: plain text stays `raw`-only, while JSON, JSONL, and hash files expose parsed data. For repo removal, add persistent suppression instead of deleting repo history so removed repos do not reappear from `vibedeck_sessions`.

**Tech Stack:** Node.js local API, SQLite migrations, React 18, Vite/Vitest, Testing Library, Tailwind utility classes, lucide-react, existing OpenAI card/button/input primitives.

**Explicit decisions locked in by this plan:**
- Recent repos move out of the repo input card and into a left rail on the `/entire` page.
- Clicking `X` on a recent repo hides it persistently from the side rail; it does not delete usage/session data.
- `Repo`, `Entire status`, `Actions`, `Configure`, and each checkpoint file row become expandable panels.
- The outer wrapper card around the checkpoints workbench is removed.
- Checkpoint rows no longer show the current `0`, `1`, `9` path segment indicators or per-group count badges.
- Tab availability follows actual file shape:
  - `text`: `Preview`, `Raw`
  - `json`: `Preview`, `Raw`, `Parsed`
  - `jsonl`: `Preview`, `Raw`, `Parsed`
  - `hash`: `Preview`, `Raw`, `Parsed`
- The preview shell keeps a fixed body height so switching between `Preview`, `Raw`, and `Parsed` does not change card size.

---

## File Structure

- Modify: `dashboard/src/pages/EntirePage.jsx`
  - Responsibility: own the new left-rail + main-column layout and pass repo selection/removal callbacks.

- Create: `dashboard/src/components/entire/ExpandablePanel.jsx`
  - Responsibility: shared disclosure shell for repo, status, actions, configure, and checkpoint rows.

- Create: `dashboard/src/components/entire/RecentReposPane.jsx`
  - Responsibility: dedicated recent repo side pane with load and remove controls.

- Modify: `dashboard/src/components/entire/RepoPathSelector.jsx`
  - Responsibility: shrink to repository input/load form only; remove embedded recent repo chips.

- Modify: `dashboard/src/components/entire/EntireStatusCard.jsx`
  - Responsibility: render status content inside the shared expandable shell.

- Modify: `dashboard/src/components/entire/EntireActionsPanel.jsx`
  - Responsibility: render actions content inside the shared expandable shell.

- Modify: `dashboard/src/components/entire/AdvancedConfigurePanel.jsx`
  - Responsibility: render configure content inside the shared expandable shell instead of its own disclosure button.

- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
  - Responsibility: become a bare checkpoint file list container without the outer card.

- Modify: `dashboard/src/components/entire/CheckpointNavigator.jsx`
  - Responsibility: stop rendering the current grouped navigator UI; replace it with expandable checkpoint file rows or be slimmed into helper logic only.

- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
  - Responsibility: render a fixed-size inspector body with file-type-aware tabs and stable inner scroll areas.

- Modify: `dashboard/src/components/entire/checkpoint-file-utils.js`
  - Responsibility: update grouping/labels for the new row-oriented checkpoint list and recent repo naming.

- Modify: `dashboard/src/lib/vibedeck-api.ts`
  - Responsibility: add repo hide endpoint client and document checkpoint payload behavior where helpful.

- Modify: `src/lib/db/repos.js`
  - Responsibility: support persistent hiding of recent repos and exclude hidden repos from `listKnownRepos()`.

- Create: `src/lib/db/migrations/007-known-repo-suppression.js`
  - Responsibility: add a persisted suppression field for hidden recent repos.

- Modify: `src/lib/local-api.js`
  - Responsibility: add the POST endpoint used by the recent repo `X` button.

- Modify: `dashboard/src/pages/EntirePage.test.jsx`
  - Responsibility: update page expectations for left rail, expandable panels, checkpoint row expansion, and file-tab behavior.

- Modify: `dashboard/src/pages/EntirePage.actions.test.jsx`
  - Responsibility: update action/configure queries to the new expandable shells.

- Create: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`
  - Responsibility: verify per-kind tab availability and fixed-shell rendering behavior.

---

### Task 1: Add Persistent Recent Repo Suppression

**Files:**
- Create: `src/lib/db/migrations/007-known-repo-suppression.js`
- Modify: `src/lib/db/repos.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Test: `test/repos-known-repos.test.js`

- [ ] **Step 1: Write the failing backend tests**

Create `test/repos-known-repos.test.js`:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const migration = require("../src/lib/migration");
const {
  upsertEntireState,
  listKnownRepos,
  hideKnownRepo,
} = require("../src/lib/db/repos");

function makeDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-known-repos-")), "vibedeck.sqlite3");
}

function seedSessionRepo(dbPath, repoRoot, updatedAt) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, repo_root, branch, started_at, ended_at, updated_at, cwd, agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("codex", `${repoRoot}-session`, repoRoot, "main", updatedAt, null, updatedAt, repoRoot, "codex");
  } finally {
    db.close();
  }
}

test("listKnownRepos excludes repos hidden from recent repo pane", () => {
  const dbPath = makeDbPath();
  migration.migrate(dbPath);
  const visibleRepo = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-visible-"));
  const hiddenRepo = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-hidden-"));

  upsertEntireState(dbPath, { repoRoot: visibleRepo, entire_state: "active", entire_version: "0.6.1" });
  upsertEntireState(dbPath, { repoRoot: hiddenRepo, entire_state: "active", entire_version: "0.6.1" });
  seedSessionRepo(dbPath, hiddenRepo, "2026-05-11T12:00:00.000Z");

  hideKnownRepo(dbPath, hiddenRepo);

  const payload = listKnownRepos(dbPath, { limit: 20 });
  assert.deepEqual(payload.repos.map((item) => item.repo_root), [visibleRepo]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
rtk node --test test/repos-known-repos.test.js
```

Expected: FAIL because there is no suppression migration or `hideKnownRepo()` helper yet.

- [ ] **Step 3: Add the suppression migration**

Create `src/lib/db/migrations/007-known-repo-suppression.js`:

```js
"use strict";

module.exports = {
  component: "vibedeck-known-repo-suppression",
  version: 1,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_repos ADD COLUMN hidden_at TEXT;
    `);
  },
};
```

If the migration runner requires idempotence for repeated local runs, wrap the `ALTER TABLE` in the same guard style used elsewhere in the repo.

- [ ] **Step 4: Add repo suppression helpers**

Modify `src/lib/db/repos.js`:

```js
function hideKnownRepo(dbPath, repoRoot) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(`
      INSERT INTO vibedeck_repos (repo_root, hidden_at)
      VALUES (?, ?)
      ON CONFLICT(repo_root) DO UPDATE SET
        hidden_at = excluded.hidden_at
    `).run(repoRoot, new Date().toISOString());
  } finally {
    db.close();
  }
}
```

Update `listKnownRepos()` so both the `entireRows` seed path and final returned list exclude rows where `hidden_at` is set:

```js
if (row.hidden_at) continue;
```

and in the merge path:

```js
if (existing.hidden_at) continue;
```

Also export `hideKnownRepo`.

- [ ] **Step 5: Add the local API endpoint and dashboard client**

In `src/lib/local-api.js`, add:

```js
if (p === "/functions/vibedeck-known-repos/hide") {
  if (String(req.method || "GET").toUpperCase() !== "POST") {
    json(res, { error: "Method Not Allowed" }, 405);
    return true;
  }
  const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
  if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    json(res, { error: "invalid_json" }, 400);
    return true;
  }
  const repoRaw = typeof body?.repo === "string" ? body.repo.trim() : "";
  if (!repoRaw) {
    json(res, { error: "missing_repo" }, 400);
    return true;
  }
  let repoRoot = null;
  try {
    repoRoot = fs.realpathSync(repoRaw);
  } catch {
    json(res, { error: "missing_repo" }, 400);
    return true;
  }
  const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
  const { hideKnownRepo } = require("./db/repos");
  hideKnownRepo(dbPath, repoRoot);
  json(res, { ok: true, repo_root: repoRoot });
  return true;
}
```

In `dashboard/src/lib/vibedeck-api.ts`, add:

```ts
export function hideKnownRepo(repo: string, fetchImpl: FetchImpl = fetch) {
  return postVibeDeckJson("vibedeck-known-repos/hide", { repo }, fetchImpl);
}
```

- [ ] **Step 6: Re-run backend verification**

Run:

```bash
rtk node --test test/repos-known-repos.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/db/migrations/007-known-repo-suppression.js src/lib/db/repos.js src/lib/local-api.js dashboard/src/lib/vibedeck-api.ts test/repos-known-repos.test.js
rtk git commit -m "feat(entire): support hiding recent repos"
```

---

### Task 2: Restructure `/entire` Into Left Rail Plus Expandable Main Panels

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Create: `dashboard/src/components/entire/ExpandablePanel.jsx`
- Create: `dashboard/src/components/entire/RecentReposPane.jsx`
- Modify: `dashboard/src/components/entire/RepoPathSelector.jsx`
- Modify: `dashboard/src/components/entire/EntireStatusCard.jsx`
- Modify: `dashboard/src/components/entire/EntireActionsPanel.jsx`
- Modify: `dashboard/src/components/entire/AdvancedConfigurePanel.jsx`
- Test: `dashboard/src/pages/EntirePage.test.jsx`
- Test: `dashboard/src/pages/EntirePage.actions.test.jsx`

- [ ] **Step 1: Write the failing page tests**

Add or replace tests in `dashboard/src/pages/EntirePage.test.jsx` to assert:
- recent repos render in a side pane, not inside the repo input card,
- the side pane exposes a remove button for each repo,
- `Repo`, `Entire status`, `Actions`, and `Configure` render as buttons with `aria-expanded`,
- the configure section is closed by default but opens inside the shared panel shell.

Add or update tests in `dashboard/src/pages/EntirePage.actions.test.jsx` to open the `Actions` and `Configure` panels before querying their controls.

Example expectation shape:

```js
expect(await screen.findByRole("complementary", { name: /recent repos/i })).toBeTruthy();
expect(screen.getByRole("button", { name: /entire status/i })).toHaveAttribute("aria-expanded", "false");
expect(screen.getByRole("button", { name: /actions/i })).toHaveAttribute("aria-expanded", "false");
```

- [ ] **Step 2: Run the failing dashboard tests**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx src/pages/EntirePage.actions.test.jsx
```

Expected: FAIL because the page still uses embedded chips and standalone cards.

- [ ] **Step 3: Create the shared expandable shell**

Create `dashboard/src/components/entire/ExpandablePanel.jsx`:

```jsx
import React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

export function ExpandablePanel({
  title,
  subtitle = "",
  open = false,
  onToggle,
  children,
  className = "",
  contentClassName = "",
  headerRight = null,
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900", className)}>
      <button
        type="button"
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="mt-0.5 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-oai-black dark:text-white">{title}</span>
          {subtitle ? (
            <span className="mt-1 block text-sm text-oai-gray-500 dark:text-oai-gray-400">{subtitle}</span>
          ) : null}
        </span>
        {headerRight}
      </button>
      {open ? <div className={cn("border-t border-oai-gray-200 px-4 py-4 dark:border-oai-gray-800", contentClassName)}>{children}</div> : null}
    </section>
  );
}
```

- [ ] **Step 4: Create the recent repo side pane and simplify the repo selector**

Create `dashboard/src/components/entire/RecentReposPane.jsx`:

```jsx
import React from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/cn";
import { repoChipParts } from "./checkpoint-file-utils";

export function RecentReposPane({ repos = [], selectedRepo = "", onSelect, onRemove, className = "" }) {
  return (
    <aside aria-label="Recent repos" className={cn("flex min-h-0 flex-col overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900", className)}>
      <div className="border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">Recent repos</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {repos.map((repo) => {
          const { name, context, fullPath } = repoChipParts(repo);
          const active = selectedRepo === repo;
          return (
            <div key={repo} className={cn("mb-2 flex items-start gap-2 rounded-lg border px-3 py-2", active ? "border-oai-brand-500/40 bg-oai-brand-500/10" : "border-oai-gray-200 dark:border-oai-gray-800")}>
              <button type="button" className="min-w-0 flex-1 text-left" title={fullPath} onClick={() => onSelect?.(repo)}>
                <span className="block truncate text-sm font-medium text-oai-black dark:text-white">{name}</span>
                {context ? <span className="block truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">{context}</span> : null}
              </button>
              <button type="button" aria-label={`Remove recent repo ${name}`} className="rounded p-1 text-oai-gray-400 hover:bg-oai-black/[0.04] hover:text-oai-black dark:hover:bg-white/[0.08] dark:hover:text-white" onClick={() => onRemove?.(repo)}>
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
```

In `RepoPathSelector.jsx`, remove the entire recent-repo chip block and leave only title/subtitle + input + load button.

- [ ] **Step 5: Recompose the page layout**

In `dashboard/src/pages/EntirePage.jsx`:
- add `recentRepos` and `panelOpenState` state,
- render a 2-column layout like:

```jsx
<div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[280px_minmax(0,1fr)]">
  <RecentReposPane ... />
  <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
    <RepoPathSelector ... />
    <EntireStatusCard ... />
    <EntireActionsPanel ... />
    <AdvancedConfigurePanel ... />
    <CheckpointList ... />
  </div>
</div>
```

- [ ] **Step 6: Move status/actions/configure into the shared expandable shell**

Update:
- `EntireStatusCard.jsx`
- `EntireActionsPanel.jsx`
- `AdvancedConfigurePanel.jsx`

so each uses `ExpandablePanel` and receives `open` / `onToggle` props from the page.

For `AdvancedConfigurePanel.jsx`, remove the current internal `Advanced raw configure` button and replace it with the shared panel header. Keep persisted args text, but do not persist the old nested disclosure state anymore.

- [ ] **Step 7: Re-run dashboard verification**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx src/pages/EntirePage.actions.test.jsx
rtk npm run dashboard:build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
rtk git add dashboard/src/pages/EntirePage.jsx dashboard/src/components/entire/ExpandablePanel.jsx dashboard/src/components/entire/RecentReposPane.jsx dashboard/src/components/entire/RepoPathSelector.jsx dashboard/src/components/entire/EntireStatusCard.jsx dashboard/src/components/entire/EntireActionsPanel.jsx dashboard/src/components/entire/AdvancedConfigurePanel.jsx dashboard/src/pages/EntirePage.test.jsx dashboard/src/pages/EntirePage.actions.test.jsx
rtk git commit -m "refactor(entire): move page to expandable rail layout"
```

---

### Task 3: Replace Checkpoint Navigator With Inline Expandable File Rows

**Files:**
- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
- Modify: `dashboard/src/components/entire/CheckpointNavigator.jsx`
- Modify: `dashboard/src/components/entire/checkpoint-file-utils.js`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`

- [ ] **Step 1: Write the failing checkpoint row tests**

Extend `dashboard/src/pages/EntirePage.test.jsx` to assert:
- the old outer `Checkpoints` wrapper title is gone,
- `Checkpoint files` is the only checkpoint section header,
- file rows expand inline,
- the old `0` / `1` path segment labels are not visible,
- the old group-count badges are not visible.

Example assertions:

```js
expect(screen.queryByText("Checkpoints")).toBeNull();
expect(await screen.findByRole("button", { name: /metadata\.json/i })).toHaveAttribute("aria-expanded", "true");
expect(screen.queryByText(/^0$/)).toBeNull();
expect(screen.queryByText(/^1$/)).toBeNull();
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx
```

Expected: FAIL because the page still uses the grouped navigator + separate inspector workbench.

- [ ] **Step 3: Refactor checkpoint list into expandable rows**

In `dashboard/src/components/entire/CheckpointList.jsx`:
- remove the outer `Card`,
- keep the heading row `Checkpoint files`,
- fetch the selected file payload per expanded row,
- render rows with `ExpandablePanel`.

Use a structure like:

```jsx
<section className="min-h-0 rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
  <div className="border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">Checkpoint files</h2>
      <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{files.length} files</span>
    </div>
  </div>
  <div className="min-h-0 overflow-auto">
    {groupedFiles.map((filePath) => (
      <ExpandablePanel key={filePath} ...>
        <CheckpointFileInspector ... />
      </ExpandablePanel>
    ))}
  </div>
</section>
```

- [ ] **Step 4: Remove navigator numbering and count badges**

In `checkpoint-file-utils.js`:
- stop exposing path labels that surface `0`, `1`, or similar intermediate directory segments,
- return a cleaner row subtitle such as checkpoint id + logical file role.

If `CheckpointNavigator.jsx` remains, remove:

```jsx
<span className="ml-auto ...">{group.files.length}</span>
<span className="max-w-[120px] ...">{subPath(filePath)}</span>
```

If it becomes dead code, delete the file and inline the required helpers into `CheckpointList.jsx`.

- [ ] **Step 5: Re-run verification**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx
rtk npm run dashboard:build
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
rtk git add dashboard/src/components/entire/CheckpointList.jsx dashboard/src/components/entire/CheckpointNavigator.jsx dashboard/src/components/entire/checkpoint-file-utils.js dashboard/src/pages/EntirePage.test.jsx
rtk git commit -m "refactor(entire): render checkpoint files as expandable rows"
```

---

### Task 4: Stabilize Checkpoint Preview Sizing And Make Tabs Match File Types

**Files:**
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Create: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Reference only: `src/lib/entire-bridge.js`

- [ ] **Step 1: Write the failing inspector tests**

Create `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "../../test/test-utils";
import { CheckpointFileInspector } from "./CheckpointFileInspector";

describe("CheckpointFileInspector", () => {
  it("shows only preview and raw tabs for text files", () => {
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

    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raw" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Parsed" })).toBeNull();
  });

  it("shows parsed for hash, json, and jsonl files", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/0/content_hash.txt",
          file_name: "content_hash.txt",
          kind: "hash",
          raw: "sha256:abc123",
          parsed: { algorithm: "sha256", value: "abc123" },
          size_bytes: 13,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Parsed" })).toBeTruthy();
  });
});
```

Extend `dashboard/src/pages/EntirePage.test.jsx` to assert text-file rows do not show a parsed tab and that preview content remains available after switching rows.

- [ ] **Step 2: Run the failing tests**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/components/entire/CheckpointFileInspector.test.jsx src/pages/EntirePage.test.jsx
```

Expected: FAIL because `Parsed` always renders today.

- [ ] **Step 3: Make tab availability file-type aware**

In `CheckpointFileInspector.jsx`, replace the hard-coded tab list:

```jsx
[
  { id: "preview", label: "Preview" },
  { id: "raw", label: "Raw" },
  { id: "parsed", label: "Parsed" },
]
```

with:

```jsx
const tabs = file?.kind === "text"
  ? [
      { id: "preview", label: "Preview" },
      { id: "raw", label: "Raw" },
    ]
  : [
      { id: "preview", label: "Preview" },
      { id: "raw", label: "Raw" },
      { id: "parsed", label: "Parsed" },
    ];
```

Also guard tab reset so if the current tab disappears, it falls back to `preview`.

- [ ] **Step 4: Fix the preview shell height**

Still in `CheckpointFileInspector.jsx`, make the body shell stable:

```jsx
<section className="flex min-h-[420px] flex-col overflow-hidden rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
```

and use one consistent scrollable content wrapper:

```jsx
<div className="min-h-0 flex-1 overflow-hidden p-4">
  <div className="h-full overflow-auto rounded-md bg-oai-black/[0.03] p-3 dark:bg-white/[0.08]">
    ...
  </div>
</div>
```

Render `Preview`, `Raw`, and `Parsed` inside that same inner shell so content changes do not resize the card.

- [ ] **Step 5: Keep preview semantics aligned with the backend contract**

Do not change `src/lib/entire-bridge.js` for this task. Keep these assumptions:
- text preview uses `raw`,
- json preview uses selected primitive fields from `parsed`,
- jsonl preview uses `parsed.preview`,
- hash preview uses parsed algorithm/value.

If any tests were previously asserting `parsed: null` for text, keep them; the UI should adapt to the contract rather than rewriting the contract.

- [ ] **Step 6: Re-run verification**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/components/entire/CheckpointFileInspector.test.jsx src/pages/EntirePage.test.jsx
rtk npm run dashboard:build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
rtk git add dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/components/entire/CheckpointFileInspector.test.jsx dashboard/src/pages/EntirePage.test.jsx
rtk git commit -m "fix(entire): stabilize checkpoint preview tabs and sizing"
```

---

### Task 5: Full Integration Verification

**Files:**
- Verify only: modified files from Tasks 1-4

- [ ] **Step 1: Run backend tests**

```bash
rtk node --test test/repos-known-repos.test.js
```

Expected: PASS.

- [ ] **Step 2: Run dashboard `/entire` tests**

```bash
rtk npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx src/pages/EntirePage.actions.test.jsx src/components/entire/CheckpointFileInspector.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run the dashboard build**

```bash
rtk npm run dashboard:build
```

Expected: PASS with no new build errors.

- [ ] **Step 4: Optional manual smoke test**

Run:

```bash
rtk npm run dashboard:dev
```

Manual checks:
- `/entire` shows recent repos in the left rail,
- clicking `X` removes a repo and it stays gone after reload,
- each top-level section expands/collapses cleanly,
- checkpoint file rows expand inline,
- text files have no `Parsed` tab,
- switching tabs does not resize the preview shell.

- [ ] **Step 5: Final commit**

```bash
rtk git status --short
```

Expected: only planned files remain modified. Create the final integration commit once the implementation work is complete.

---

## Self-Review

- Spec coverage: the plan covers every requested change from the audit: side pane repos, expandable repo/status/actions/configure, expandable checkpoint files, removing number-like path labels, fixed preview shell size, file-type-specific tab behavior, and repo `X` removal.
- Placeholder scan: no `TBD`, `TODO`, or “implement later” placeholders remain.
- Consistency check: the plan consistently uses persistent suppression for repo removal and consistently treats plain text files as `raw`-only.

