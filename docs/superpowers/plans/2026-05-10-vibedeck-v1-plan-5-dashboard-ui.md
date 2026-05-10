# VibeDeck v1 — Plan 5 Dashboard UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Recommended dispatcher: Codex (gpt-5.2) per `docs/superpowers/codex-workflow.md`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the VibeDeck web dashboard as a Live Workbench-first product while preserving the existing usage analytics dashboard and wiring every Plan 2-4 dashboard-relevant endpoint.

**Architecture:** Add two narrow backend read/compatibility surfaces first (`vibedeck-branch-usage` and full `vibedeck-skills` modes), then add dashboard API helpers and route the existing usage dashboard to `/usage`. Build new endpoint-driven pages using the existing `AppLayout`, collapsible `Sidebar.jsx`, OpenAI primitives, matrix components, copy registry, and current Light / Dark / System theme plumbing.

**Tech Stack:** Node.js >=22.5, `node:sqlite`, React 18, React Router 7, Vite 7, TailwindCSS 3.4, lucide-react, node:test, Vitest where existing dashboard tests use it. No new dependencies.

**Source repo:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/`. Plan 4 baseline: `plan-4-local-auth-and-migration-complete`, latest verified full suite 713/713 passing outside sandbox.

**Spec:** `docs/superpowers/specs/2026-05-10-vibedeck-plan-5-dashboard-ui-design.md`

**Working assumptions:**
- All paths are relative to `~/Downloads/Projects/VibeDeck/`.
- Each task ends with a commit.
- Do not modify `src/lib/rollout.js` parser/normalizer math.
- Do not rewrite the existing usage dashboard. Re-home it.
- Keep macOS native UI out of Plan 5; it is Phase 6.
- Use `docs/superpowers/codex-workflow.md` for implementation dispatch.

---

## Phase A — Backend Surfaces Required By Dashboard

### Task 1: `GET /functions/vibedeck-branch-usage`

**Files:**
- Create: `src/lib/branch-usage.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-branch-usage.test.js`

- [ ] **Step 1: Write failing backend tests**

Create `test/local-api-vibedeck-branch-usage.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('../src/lib/db/schema');
const { createRequest, createResponse } = require('./_local-api-test-helpers');

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @started_at, @started_at
    )
  `).run(row);
}

test('GET /functions/vibedeck-branch-usage aggregates sessions by repo and branch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-usage-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:20:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.2',
        total_tokens: 100,
        total_cost_usd: 0.25,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 's2',
        started_at: '2026-05-10T01:00:00.000Z',
        ended_at: null,
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'feature/live',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'opus',
        total_tokens: 40,
        total_cost_usd: 0.1,
      });
    } finally {
      db.close();
    }

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1'),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.totals.total_tokens, 140);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].repo_root, '/repo');
    assert.equal(body.repos[0].branches.length, 2);
    assert.equal(body.repos[0].branches[0].sessions.length, 1);
    assert.deepEqual(Object.keys(body.repos[0].branches[0].confidence).sort(), ['high', 'low', 'medium', 'unattributed']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage returns empty shape when db is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-empty-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(req, res, new URL('http://127.0.0.1/functions/vibedeck-branch-usage'));
    assert.deepEqual(JSON.parse(res.body.toString('utf8')), {
      repos: [],
      totals: { total_tokens: 0, total_cost_usd: 0, session_count: 0 },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage prefers branch windows when a session was split', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-windows-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'split',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T01:00:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.2',
        total_tokens: 100,
        total_cost_usd: 1.0,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows
          (provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd)
        VALUES
          ('codex', 'split', 'main', '2026-05-10T00:00:00.000Z', '2026-05-10T00:30:00.000Z', 60, 0.6),
          ('codex', 'split', 'feature', '2026-05-10T00:30:00.000Z', '2026-05-10T01:00:00.000Z', 40, 0.4)
      `).run();
    } finally {
      db.close();
    }
    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(req, res, new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1'));
    const body = JSON.parse(res.body.toString('utf8'));
    const branches = body.repos[0].branches;
    assert.equal(branches.find((b) => b.branch === 'main').total_tokens, 60);
    assert.equal(branches.find((b) => b.branch === 'feature').total_tokens, 40);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/local-api-vibedeck-branch-usage.test.js
```

Expected: fail because endpoint/module is missing.

- [ ] **Step 3: Implement branch usage module**

Create `src/lib/branch-usage.js`:

```js
'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function emptyResult() {
  return { repos: [], totals: { total_tokens: 0, total_cost_usd: 0, session_count: 0 } };
}

function confidenceShape() {
  return { high: 0, medium: 0, low: 0, unattributed: 0 };
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low', 'unattributed'].includes(value) ? value : 'unattributed';
}

function queryBranchUsage(dbPath, {
  from = null,
  to = null,
  repo = null,
  branch = null,
  limit = 100,
  includeSessions = false,
} = {}) {
  if (!fs.existsSync(dbPath)) return emptyResult();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses = ["repo_root IS NOT NULL", "repo_root <> ''"];
    const params = {};
    if (from) { clauses.push('started_at >= @from'); params.from = from; }
    if (to) { clauses.push('started_at <= @to'); params.to = to; }
    if (repo) { clauses.push('repo_root = @repo'); params.repo = repo; }
    if (branch) { clauses.push('branch = @branch'); params.branch = branch; }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`
      WITH source_rows AS (
        SELECT s.provider, s.session_id, w.window_start AS started_at, w.window_end AS ended_at,
               s.repo_root, COALESCE(w.branch, 'unattributed') AS branch,
               s.branch_resolution_tier, s.confidence, s.model,
               COALESCE(w.prorated_tokens, 0) AS total_tokens,
               COALESCE(w.prorated_cost_usd, 0) AS total_cost_usd
        FROM vibedeck_session_branch_windows w
        JOIN vibedeck_sessions s
          ON s.provider = w.provider AND s.session_id = w.session_id
        UNION ALL
        SELECT s.provider, s.session_id, s.started_at, s.ended_at,
               s.repo_root, COALESCE(s.branch, 'unattributed') AS branch,
               s.branch_resolution_tier, s.confidence, s.model,
               COALESCE(s.total_tokens, 0) AS total_tokens,
               COALESCE(s.total_cost_usd, 0) AS total_cost_usd
        FROM vibedeck_sessions s
        WHERE NOT EXISTS (
          SELECT 1 FROM vibedeck_session_branch_windows w
          WHERE w.provider = s.provider AND w.session_id = s.session_id
        )
      )
      SELECT * FROM source_rows
      ${where}
      ORDER BY started_at DESC
      LIMIT @limit
    `).all({ ...params, limit: Math.max(1, Math.min(500, Number(limit) || 100)) });

    const repos = new Map();
    const totals = { total_tokens: 0, total_cost_usd: 0, session_count: 0 };
    for (const row of rows) {
      totals.total_tokens += Number(row.total_tokens || 0);
      totals.total_cost_usd += Number(row.total_cost_usd || 0);
      totals.session_count += 1;
      if (!repos.has(row.repo_root)) repos.set(row.repo_root, new Map());
      const branches = repos.get(row.repo_root);
      if (!branches.has(row.branch)) {
        branches.set(row.branch, {
          branch: row.branch,
          total_tokens: 0,
          total_cost_usd: 0,
          session_count: 0,
          last_seen_at: row.started_at,
          confidence: confidenceShape(),
          sessions: includeSessions ? [] : undefined,
        });
      }
      const entry = branches.get(row.branch);
      entry.total_tokens += Number(row.total_tokens || 0);
      entry.total_cost_usd += Number(row.total_cost_usd || 0);
      entry.session_count += 1;
      if (String(row.started_at || '') > String(entry.last_seen_at || '')) entry.last_seen_at = row.started_at;
      entry.confidence[normalizeConfidence(row.confidence)] += 1;
      if (includeSessions) {
        entry.sessions.push({
          provider: row.provider,
          session_id: row.session_id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          model: row.model,
          total_tokens: row.total_tokens,
          total_cost_usd: row.total_cost_usd,
          confidence: row.confidence,
          branch_resolution_tier: row.branch_resolution_tier,
        });
      }
    }

    return {
      repos: Array.from(repos.entries()).map(([repo_root, branches]) => ({
        repo_root,
        branches: Array.from(branches.values()).sort((a, b) => b.total_tokens - a.total_tokens),
      })),
      totals,
    };
  } finally {
    db.close();
  }
}

module.exports = { queryBranchUsage };
```

- [ ] **Step 4: Wire endpoint in `src/lib/local-api.js`**

Add a read-only block before attribution stats:

```js
    if (p === "/functions/vibedeck-branch-usage") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
      const { queryBranchUsage } = require("./branch-usage");
      json(res, queryBranchUsage(dbPath, {
        from: url.searchParams.get("from"),
        to: url.searchParams.get("to"),
        repo: url.searchParams.get("repo"),
        branch: url.searchParams.get("branch"),
        limit: url.searchParams.get("limit"),
        includeSessions: url.searchParams.get("include_sessions") === "1",
      }));
      return true;
    }
```

- [ ] **Step 5: Run focused tests**

```bash
node --test test/local-api-vibedeck-branch-usage.test.js
```

Expected: pass.

- [ ] **Step 6: Run full tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/branch-usage.js src/lib/local-api.js test/local-api-vibedeck-branch-usage.test.js
git commit -m "feat(api): vibedeck-branch-usage read endpoint"
```

---

### Task 2: Mirror Skills discovery/search/repo management under `vibedeck-skills`

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-skills-modes.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/local-api-vibedeck-skills-modes.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { startLocalApiServer, postJson } = require('./_local-api-server-helpers');

test('GET /functions/vibedeck-skills supports installed and repos modes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-skills-modes-'));
  const queuePath = path.join(root, 'tracker', 'queue.jsonl');
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  const srv = await startLocalApiServer({ queuePath });
  try {
    const installed = await fetch(`${srv.baseUrl}/functions/vibedeck-skills?mode=installed`).then((r) => r.json());
    assert.ok(Array.isArray(installed.skills));
    assert.ok(Array.isArray(installed.targets));
    const repos = await fetch(`${srv.baseUrl}/functions/vibedeck-skills?mode=repos`).then((r) => r.json());
    assert.ok(Array.isArray(repos.repos));
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('POST /functions/vibedeck-skills/addRepo and removeRepo are auth-gated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-skills-repo-'));
  const queuePath = path.join(root, 'tracker', 'queue.jsonl');
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  const srv = await startLocalApiServer({ queuePath });
  try {
    const unauthorized = await postJson(srv.baseUrl, '/functions/vibedeck-skills/addRepo', {
      repo: { owner: 'owner', name: 'repo', branch: 'main' },
    });
    assert.equal(unauthorized.statusCode, 401);

    const token = await fetch(`${srv.baseUrl}/api/local-auth`).then((r) => r.json()).then((j) => j.token);
    const added = await postJson(
      srv.baseUrl,
      '/functions/vibedeck-skills/addRepo',
      { repo: { owner: 'owner', name: 'repo', branch: 'main' } },
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(added.statusCode, 200);
    assert.equal(added.body.repo.owner, 'owner');

    const removed = await postJson(
      srv.baseUrl,
      '/functions/vibedeck-skills/removeRepo',
      { owner: 'owner', name: 'repo' },
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.body.ok, true);
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/local-api-vibedeck-skills-modes.test.js
```

Expected: fail because `vibedeck-skills` lacks modes/addRepo/removeRepo.

- [ ] **Step 3: Extend `GET /functions/vibedeck-skills`**

In `src/lib/local-api.js`, replace the current `vibedeck-skills` GET block with mode handling:

```js
        if (method === "GET") {
          const mode = url.searchParams.get("mode") || "installed";
          if (mode === "installed") {
            json(res, { targets: skills.targetList(), skills: skills.listInstalledSkills() });
            return true;
          }
          if (mode === "repos") {
            json(res, { repos: skills.listRepos() });
            return true;
          }
          if (mode === "discover") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.discoverSkills({ force }));
            return true;
          }
          if (mode === "search") {
            const data = await skills.searchSkillsSh(
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("limit") || 20),
              Number(url.searchParams.get("offset") || 0),
            );
            json(res, data);
            return true;
          }
          json(res, { error: "Unknown skills mode" }, 400);
          return true;
        }
```

- [ ] **Step 4: Extend `POST /functions/vibedeck-skills/*`**

In the existing command switch, add:

```js
        if (cmd === "addRepo") {
          json(res, { ok: true, repo: skills.addRepo(body.repo) });
          return true;
        }
        if (cmd === "removeRepo") {
          json(res, { ok: true, ...(skills.removeRepo(body.owner, body.name) || {}) });
          return true;
        }
```

- [ ] **Step 5: Run focused and existing skills tests**

```bash
node --test test/local-api-vibedeck-skills-modes.test.js test/local-api-vibedeck-skills-auth.test.js test/local-api-skills.test.js
```

Expected: pass.

- [ ] **Step 6: Run full tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/local-api.js test/local-api-vibedeck-skills-modes.test.js
git commit -m "feat(api): mirror skill discovery under vibedeck-skills"
```

---

## Phase B — Dashboard Routing, Identity, And API Helpers

### Task 3: Route shell — Live home, Usage page, new nav items

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/ui/openai/components/Sidebar.jsx`
- Create: `dashboard/src/pages/LivePage.jsx`
- Create: `dashboard/src/pages/BranchesPage.jsx`
- Create: `dashboard/src/pages/EntirePage.jsx`
- Test: `test/dashboard-plan5-routes.test.js`

- [ ] **Step 1: Write failing route/static tests**

Create `test/dashboard-plan5-routes.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('App routes Live to / and /dashboard, Usage to /usage, and includes Branches/Entire', () => {
  const app = fs.readFileSync('dashboard/src/App.jsx', 'utf8');
  assert.match(app, /LivePage/);
  assert.match(app, /isUsagePath/);
  assert.match(app, /BranchesPage/);
  assert.match(app, /EntirePage/);
});

test('Sidebar preserves collapse storage and adds Plan 5 nav items', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /tt\.sidebarCollapsed/);
  assert.match(sidebar, /nav\.live/);
  assert.match(sidebar, /nav\.usage/);
  assert.match(sidebar, /nav\.branches/);
  assert.match(sidebar, /nav\.entire/);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/dashboard-plan5-routes.test.js
```

- [ ] **Step 3: Add first-pass route pages**

Create `dashboard/src/pages/LivePage.jsx`:

```jsx
import React from "react";
import { Card } from "../ui/openai/components";

export function LivePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">Live Workbench</h1>
      </Card>
    </main>
  );
}
```

Create `dashboard/src/pages/BranchesPage.jsx`:

```jsx
import React from "react";
import { Card } from "../ui/openai/components";

export function BranchesPage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">Branches</h1>
      </Card>
    </main>
  );
}
```

Create `dashboard/src/pages/EntirePage.jsx`:

```jsx
import React from "react";
import { Card } from "../ui/openai/components";

export function EntirePage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <Card>
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">Entire</h1>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Update `dashboard/src/App.jsx` routing**

Keep `DashboardPage` as the existing usage component. Add imports and path flags:

```jsx
import { LivePage } from "./pages/LivePage.jsx";
import { BranchesPage } from "./pages/BranchesPage.jsx";
import { EntirePage } from "./pages/EntirePage.jsx";
```

Then map:

```jsx
  const isLivePath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isUsagePath = normalizedPath === "/usage";
  const isBranchesPath = normalizedPath === "/branches";
  const isEntirePath = normalizedPath === "/entire";

  let PageComponent = LivePage;
  if (isUsagePath) PageComponent = DashboardPage;
  else if (isBranchesPath) PageComponent = BranchesPage;
  else if (isEntirePath) PageComponent = EntirePage;
  else if (isLimitsPath) PageComponent = LimitsPage;
```

Include the new paths in `showSidebar`.

- [ ] **Step 5: Update sidebar nav**

Use existing `getNavGroups()` style, preserving collapse behavior. Add lucide imports:

```jsx
import { Activity, GitBranch, GitCommitGraph } from "lucide-react";
```

Use labels:

```jsx
{ id: "live", to: "/dashboard", icon: Activity, label: copy("nav.live") },
{ id: "usage", to: "/usage", icon: BarChart3, label: copy("nav.usage") },
{ id: "branches", to: "/branches", icon: GitBranch, label: copy("nav.branches") },
{ id: "entire", to: "/entire", icon: GitCommitGraph, label: copy("nav.entire") },
```

- [ ] **Step 6: Add copy keys**

Append to `dashboard/src/content/copy.csv`:

```csv
nav.live,shared,*,Sidebar,nav_live,Live,,active
nav.branches,shared,*,Sidebar,nav_branches,Branches,,active
nav.entire,shared,*,Sidebar,nav_entire,Entire,,active
```

If `nav.usage` already exists, update its text to `Usage`; do not duplicate the key.

- [ ] **Step 7: Run tests and validators**

```bash
node --test test/dashboard-plan5-routes.test.js
npm run validate:copy
npm run dashboard:build
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add dashboard/src/App.jsx dashboard/src/ui/openai/components/Sidebar.jsx dashboard/src/pages/LivePage.jsx dashboard/src/pages/BranchesPage.jsx dashboard/src/pages/EntirePage.jsx dashboard/src/content/copy.csv test/dashboard-plan5-routes.test.js
git commit -m "feat(dashboard): route live workbench as home"
```

---

### Task 4: VibeDeck identity tokens and logo mark

**Files:**
- Modify: `dashboard/src/styles.css`
- Modify: `dashboard/src/ui/openai/components/Sidebar.jsx`
- Test: `test/dashboard-vibedeck-identity.test.js`

- [ ] **Step 1: Write failing identity tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('styles define VibeDeck brand tokens for light and dark themes', () => {
  const css = fs.readFileSync('dashboard/src/styles.css', 'utf8');
  assert.match(css, /--vd-accent/);
  assert.match(css, /--vd-live/);
  assert.match(css, /:root\.dark[\s\S]*--vd-accent/);
});

test('sidebar shows VibeDeck brand and preserves theme controls', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /VibeDeck/);
  assert.match(sidebar, /ThemePill/);
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
node --test test/dashboard-vibedeck-identity.test.js
```

- [ ] **Step 3: Add tokens without removing current theme model**

In `dashboard/src/styles.css`, add light and dark variables:

```css
:root {
  --vd-accent: #0f766e;
  --vd-accent-strong: #115e59;
  --vd-live: #10b981;
  --vd-branch: #6366f1;
  --vd-warning: #d97706;
  --vd-danger: #dc2626;
}

:root.dark {
  --vd-accent: #2dd4bf;
  --vd-accent-strong: #5eead4;
  --vd-live: #34d399;
  --vd-branch: #818cf8;
  --vd-warning: #fbbf24;
  --vd-danger: #f87171;
}
```

- [ ] **Step 4: Add sidebar logo mark**

Use a text/CSS mark inside the existing sidebar brand area; do not introduce image assets yet:

```jsx
<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--vd-accent)] text-xs font-semibold text-white">
  V
</span>
<span className="truncate font-semibold">VibeDeck</span>
```

- [ ] **Step 5: Run validation**

```bash
node --test test/dashboard-vibedeck-identity.test.js
npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/styles.css dashboard/src/ui/openai/components/Sidebar.jsx test/dashboard-vibedeck-identity.test.js
git commit -m "feat(dashboard): add VibeDeck identity tokens"
```

---

### Task 5: Shared VibeDeck dashboard API helpers

**Files:**
- Create: `dashboard/src/lib/vibedeck-api.ts`
- Test: `dashboard/src/lib/__tests__/vibedeck-api.test.ts`

- [ ] **Step 1: Write failing Vitest tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  getBranchUsage,
  getAttributionStats,
  getEntireStatus,
  confirmDestructive,
  postEntireCommand,
} from "../vibedeck-api";

describe("vibedeck-api", () => {
  it("fetches branch usage with include_sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repos: [] }) });
    await getBranchUsage({ includeSessions: true }, fetchMock as any);
    expect(fetchMock.mock.calls[0][0]).toContain("/functions/vibedeck-branch-usage");
    expect(fetchMock.mock.calls[0][0]).toContain("include_sessions=1");
  });

  it("posts Entire commands with local auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "abc" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ exitCode: 0 }) });
    await postEntireCommand("status", { repo: "/repo" }, fetchMock as any);
    expect(fetchMock.mock.calls[1][0]).toBe("/functions/vibedeck-entire/status");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("issues destructive confirm tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "abc" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "confirm", op: "cleanEntire" }) });
    const out = await confirmDestructive("cleanEntire", fetchMock as any);
    expect(out.token).toBe("confirm");
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm --prefix dashboard exec vitest run src/lib/__tests__/vibedeck-api.test.ts
```

- [ ] **Step 3: Implement helpers**

Create `dashboard/src/lib/vibedeck-api.ts` with typed wrappers:

```ts
import { getLocalApiAuthHeaders } from "./local-api-auth";

type AnyRecord = Record<string, any>;

async function jsonOrThrow(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const error: any = new Error(payload?.error || payload?.message || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function query(path: string, params: AnyRecord = {}) {
  const url = new URL(`/functions/${path}`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function getAttributionStats(fetchImpl: typeof fetch = fetch) {
  return fetchImpl("/functions/vibedeck-attribution-stats", { headers: { Accept: "application/json" }, cache: "no-store" }).then(jsonOrThrow);
}

export function getBranchUsage(params: AnyRecord = {}, fetchImpl: typeof fetch = fetch) {
  return fetchImpl(query("vibedeck-branch-usage", {
    ...params,
    include_sessions: params.includeSessions ? "1" : undefined,
  }), { headers: { Accept: "application/json" }, cache: "no-store" }).then(jsonOrThrow);
}

export function getEntireStatus(repo: string, fetchImpl: typeof fetch = fetch) {
  return fetchImpl(query("vibedeck-entire-status", { repo, cached: "1" }), { headers: { Accept: "application/json" }, cache: "no-store" }).then(jsonOrThrow);
}

export function getCheckpoints(repo: string, fetchImpl: typeof fetch = fetch) {
  return fetchImpl(query("vibedeck-checkpoints", { repo }), { headers: { Accept: "application/json" }, cache: "no-store" }).then(jsonOrThrow);
}

export function getCheckpoint(repo: string, path: string, fetchImpl: typeof fetch = fetch) {
  return fetchImpl(query("vibedeck-checkpoint", { repo, path }), { headers: { Accept: "application/json" }, cache: "no-store" }).then(jsonOrThrow);
}

export async function postVibeDeckJson(path: string, body: AnyRecord, fetchImpl: typeof fetch = fetch) {
  const authHeaders = await getLocalApiAuthHeaders(fetchImpl);
  const res = await fetchImpl(`/functions/${path}`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
    cache: "no-store",
    body: JSON.stringify(body || {}),
  });
  return jsonOrThrow(res);
}

export function postAttribute(body: AnyRecord, fetchImpl: typeof fetch = fetch) {
  return postVibeDeckJson("vibedeck-attribute", body, fetchImpl);
}

export function postEntireCommand(cmd: string, body: AnyRecord, fetchImpl: typeof fetch = fetch) {
  return postVibeDeckJson(`vibedeck-entire/${cmd}`, body, fetchImpl);
}

export function confirmDestructive(op: string, fetchImpl: typeof fetch = fetch) {
  return postVibeDeckJson("vibedeck-confirm-destructive", { op }, fetchImpl);
}
```

- [ ] **Step 4: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/lib/__tests__/vibedeck-api.test.ts
npm run dashboard:build
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/vibedeck-api.ts dashboard/src/lib/__tests__/vibedeck-api.test.ts
git commit -m "feat(dashboard): add VibeDeck API helpers"
```

---

## Phase C — Live Workbench

### Task 6: SSE hook for live sessions

**Files:**
- Create: `dashboard/src/hooks/use-vibedeck-live-sessions.ts`
- Test: `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`

- [ ] **Step 1: Write failing hook reducer tests**

```ts
import { describe, expect, it } from "vitest";
import { reduceLiveSessionEvent } from "./use-vibedeck-live-sessions";

describe("reduceLiveSessionEvent", () => {
  it("loads snapshot sessions", () => {
    const state = reduceLiveSessionEvent([], { type: "snapshot", sessions: [{ provider: "codex", session_id: "s1" }] });
    expect(state).toHaveLength(1);
  });

  it("upserts updates and removes ended rows from active list", () => {
    let state = reduceLiveSessionEvent([], { type: "session:start", provider: "codex", session_id: "s1", total_tokens: 1 });
    state = reduceLiveSessionEvent(state, { type: "session:update", provider: "codex", session_id: "s1", total_tokens: 2 });
    expect(state[0].total_tokens).toBe(2);
    state = reduceLiveSessionEvent(state, { type: "session:end", provider: "codex", session_id: "s1" });
    expect(state[0].ended_at || state[0].state).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm --prefix dashboard exec vitest run src/hooks/use-vibedeck-live-sessions.test.ts
```

- [ ] **Step 3: Implement reducer and hook**

Export a pure reducer plus a hook. Keep EventSource simple; no auth header is required.

```ts
import { useEffect, useMemo, useState } from "react";

type LiveSession = Record<string, any>;
type LiveEvent = Record<string, any> & { type: string };

function keyOf(row: LiveSession) {
  return `${row.provider}:${row.session_id}`;
}

export function reduceLiveSessionEvent(prev: LiveSession[], event: LiveEvent): LiveSession[] {
  if (event.type === "snapshot") return Array.isArray(event.sessions) ? event.sessions : [];
  const next = new Map(prev.map((row) => [keyOf(row), row]));
  const incoming = { ...event };
  delete incoming.type;
  const key = keyOf(incoming);
  const current = next.get(key) || {};
  next.set(key, { ...current, ...incoming, state: event.type === "session:end" ? "ended" : "live" });
  return Array.from(next.values()).sort((a, b) => String(b.updated_at || b.observed_at || b.started_at || "").localeCompare(String(a.updated_at || a.observed_at || a.started_at || "")));
}

export function useVibeDeckLiveSessions({ enabled = true } = {}) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "degraded">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    setStatus("connecting");
    const source = new EventSource("/functions/vibedeck-sessions-live");
    source.onopen = () => { setStatus("connected"); setError(null); };
    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        setSessions((prev) => reduceLiveSessionEvent(prev, parsed));
      } catch (err: any) {
        setStatus("degraded");
        setError(err?.message || "Invalid live session event");
      }
    };
    source.onerror = () => {
      setStatus("degraded");
      setError("Live session stream disconnected");
    };
    return () => source.close();
  }, [enabled]);

  return useMemo(() => ({ sessions, status, error }), [sessions, status, error]);
}
```

- [ ] **Step 4: Run tests**

```bash
npm --prefix dashboard exec vitest run src/hooks/use-vibedeck-live-sessions.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/hooks/use-vibedeck-live-sessions.ts dashboard/src/hooks/use-vibedeck-live-sessions.test.ts
git commit -m "feat(dashboard): add live sessions SSE hook"
```

---

### Task 7: Live Workbench read-only UI

**Files:**
- Modify: `dashboard/src/pages/LivePage.jsx`
- Create: `dashboard/src/components/live/ConfidenceBadge.jsx`
- Create: `dashboard/src/components/live/LiveSessionList.jsx`
- Create: `dashboard/src/components/live/AttributionHealthCard.jsx`
- Test: `dashboard/src/pages/LivePage.test.jsx`

- [ ] **Step 1: Write failing page tests**

```jsx
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "../test/test-utils";
import { LivePage } from "./LivePage";

vi.mock("../hooks/use-vibedeck-live-sessions", () => ({
  useVibeDeckLiveSessions: () => ({
    status: "connected",
    error: null,
    sessions: [
      { provider: "codex", session_id: "s1", repo_root: "/repo/vibedeck", branch: "main", confidence: "high", branch_resolution_tier: "A", total_tokens: 1200, total_cost_usd: 0.12 },
    ],
  }),
}));

vi.mock("../lib/vibedeck-api", () => ({
  getAttributionStats: () => Promise.resolve({ high: 1, medium: 0, low: 0, unattributed: 0, total: 1 }),
}));

describe("LivePage", () => {
  it("renders active sessions and attribution confidence", async () => {
    render(<LivePage />);
    expect(await screen.findByText("Live Workbench")).toBeInTheDocument();
    expect(screen.getByText("codex")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("high")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npm --prefix dashboard exec vitest run src/pages/LivePage.test.jsx
```

- [ ] **Step 3: Implement reusable live components**

Use `Card`, `Button`, existing provider icons, and copy keys. `ConfidenceBadge` maps:

```jsx
const CONFIDENCE_CLASS = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  unattributed: "bg-red-500/10 text-red-700 dark:text-red-300",
};
```

`LiveSessionList` should show provider, repo basename, branch, tier, model, tokens, cost, timestamps, and selected row state. Keep dimensions stable and text truncation explicit.

- [ ] **Step 4: Implement `LivePage` read-only layout**

Main structure:

```jsx
<main className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_360px]">
  <section className="min-w-0">
    <LiveSessionList
      sessions={sessions}
      selectedKey={selectedKey}
      onSelectSession={setSelectedKey}
      streamStatus={status}
      streamError={error}
    />
  </section>
  <aside className="grid content-start gap-4">
    <AttributionHealthCard stats={attributionStats} loading={statsLoading} error={statsError} />
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">Repo / Entire state</h2>
      <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        Select a session with a repo to inspect Entire status.
      </p>
    </Card>
  </aside>
</main>
```

- [ ] **Step 5: Add copy keys**

Add keys such as:

```csv
live.title,dashboard,LivePage,LivePage,title,Live Workbench,,active
live.subtitle,dashboard,LivePage,LivePage,subtitle,"Active sessions, branch confidence, and correction controls.",,active
live.empty.title,dashboard,LivePage,LiveSessionList,empty_title,No live sessions,,active
live.status.connected,dashboard,LivePage,LivePage,status,Live stream connected,,active
```

- [ ] **Step 6: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/pages/LivePage.test.jsx
npm run validate:copy
npm run dashboard:build
```

- [ ] **Step 7: Commit**

```bash
git add dashboard/src/pages/LivePage.jsx dashboard/src/components/live dashboard/src/content/copy.csv
git commit -m "feat(dashboard): render live workbench sessions"
```

---

### Task 8: Live correction actions and attribution health

**Files:**
- Modify: `dashboard/src/pages/LivePage.jsx`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Create: `dashboard/src/components/live/BranchOverridePanel.jsx`
- Test: `dashboard/src/pages/LivePage.override.test.jsx`

- [ ] **Step 1: Write failing override tests**

Test that low/unattributed sessions show an override form and call `postAttribute({ provider, session_id, branch })`.

- [ ] **Step 2: Implement `BranchOverridePanel`**

Use existing `Input`, `Button`, and `ConfirmModal` if clearing. Required behavior:

```jsx
await postAttribute({ provider: session.provider, session_id: session.session_id, branch });
```

Clear:

```jsx
await postAttribute({ provider: session.provider, session_id: session.session_id, branch: null });
```

- [ ] **Step 3: Fetch attribution stats in `LivePage`**

Call `getAttributionStats()` on mount and after override success. Show loading/error/empty states.

- [ ] **Step 4: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/pages/LivePage.override.test.jsx src/pages/LivePage.test.jsx
npm run dashboard:build
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/LivePage.jsx dashboard/src/components/live dashboard/src/content/copy.csv
git commit -m "feat(dashboard): add live attribution correction"
```

---

## Phase D — Preserve Existing Usage Dashboard

### Task 9: Re-home existing analytics under `/usage`

**Files:**
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/pages/DashboardPage.jsx` only if route-specific labels require it
- Test: `test/dashboard-usage-preserved.test.js`

- [ ] **Step 1: Write preservation tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('existing DashboardPage still imports core analytics components', () => {
  const page = fs.readFileSync('dashboard/src/pages/DashboardPage.jsx', 'utf8');
  assert.match(page, /useActivityHeatmap/);
  assert.match(page, /useTrendData/);
  assert.match(page, /useUsageModelBreakdown/);
  assert.match(page, /DashboardView/);
});

test('DashboardView still renders UsageOverview, DataDetails, TrendMonitor path', () => {
  const view = fs.readFileSync('dashboard/src/ui/matrix-a/views/DashboardView.jsx', 'utf8');
  assert.match(view, /UsageOverview/);
  assert.match(view, /DataDetails/);
  assert.match(view, /TrendMonitor/);
});
```

- [ ] **Step 2: Run tests**

```bash
node --test test/dashboard-usage-preserved.test.js
npm run dashboard:build
```

- [ ] **Step 3: Adjust labels only where needed**

Visible page/nav copy may say Usage instead of Dashboard, but do not restructure existing analytics.

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.jsx dashboard/src/pages/DashboardPage.jsx dashboard/src/content/copy.csv test/dashboard-usage-preserved.test.js
git commit -m "refactor(dashboard): preserve analytics under usage route"
```

---

## Phase E — Entire Dashboard Page

### Task 10: Entire read-only repo status and checkpoint views

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Create: `dashboard/src/components/entire/RepoPathSelector.jsx`
- Create: `dashboard/src/components/entire/EntireStatusCard.jsx`
- Create: `dashboard/src/components/entire/CheckpointList.jsx`
- Test: `dashboard/src/pages/EntirePage.test.jsx`

- [ ] **Step 1: Write failing tests**

Mock `getEntireStatus` and `getCheckpoints`, then assert state labels and checkpoint file names render.

- [ ] **Step 2: Implement repo path selector**

Use typed/pasted absolute path. Suggestions can come from `getBranchUsage({ limit: 20 })` when available. Do not use browser folder picker.

- [ ] **Step 3: Implement status labels**

Map:

```js
const STATE_LABELS = {
  not_installed: "Entire not installed",
  not_enabled: "Not enabled",
  enabled_no_commits: "Enabled, waiting for checkpoints",
  active: "Active",
};
```

Move visible text to copy keys before final validation.

- [ ] **Step 4: Implement checkpoint list/detail shell**

Use `getCheckpoints(repo)` and `getCheckpoint(repo, path)`. Detail defaults to metadata view; any raw content requires explicit click.

- [ ] **Step 5: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/pages/EntirePage.test.jsx
npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/EntirePage.jsx dashboard/src/components/entire dashboard/src/content/copy.csv
git commit -m "feat(dashboard): add Entire status and checkpoints page"
```

---

### Task 11: Entire write flows, destructive confirms, advanced raw configure

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Create: `dashboard/src/components/entire/EntireActionsPanel.jsx`
- Create: `dashboard/src/components/entire/AdvancedConfigurePanel.jsx`
- Test: `dashboard/src/pages/EntirePage.actions.test.jsx`

- [ ] **Step 1: Write failing action tests**

Assert:
- Enable calls `postEntireCommand("enable", { repo, agents })`
- Disable calls `postEntireCommand("disable", { repo })`
- Doctor/status render command output
- Configure is behind advanced disclosure
- Rewind/clean first call `confirmDestructive`, then call destructive endpoint with `confirm_token`

- [ ] **Step 2: Implement action panel**

Agents should use known values from backend:

```js
["claude-code", "codex", "gemini", "opencode", "cursor", "factoryai-droid", "copilot-cli"]
```

- [ ] **Step 3: Implement destructive confirm flow**

Rewind:

```js
const { token } = await confirmDestructive("rewindCheckpoint");
await postEntireCommand("rewind", { repo, checkpointId, confirm_token: token });
```

Clean:

```js
const { token } = await confirmDestructive("cleanEntire");
await postEntireCommand("clean", { repo, all, confirm_token: token });
```

- [ ] **Step 4: Implement advanced raw configure**

Input is argv-style text split conservatively on whitespace. Show command output. Label as advanced.

- [ ] **Step 5: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/pages/EntirePage.actions.test.jsx src/pages/EntirePage.test.jsx
npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/EntirePage.jsx dashboard/src/components/entire dashboard/src/content/copy.csv
git commit -m "feat(dashboard): wire Entire write controls"
```

---

## Phase F — Skills Modernization

### Task 12: Dashboard skills API uses `vibedeck-skills`

**Files:**
- Modify: `dashboard/src/lib/skills-api.ts`
- Test: `dashboard/src/lib/__tests__/skills-api.test.ts`
- Modify: `dashboard/src/pages/SkillsPage.jsx`

- [ ] **Step 1: Write failing API tests**

Assert that installed, repos, discover, search, install, uninstall, addRepo, removeRepo use `/functions/vibedeck-skills`.

- [ ] **Step 2: Update `dashboard/src/lib/skills-api.ts`**

Set:

```ts
const SLUG = "vibedeck-skills";
```

For mutations that now use path commands, call:

```ts
fetch(`/functions/${SLUG}/install`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
  cache: "no-store",
  body: JSON.stringify({ skill, targets }),
});

fetch(`/functions/${SLUG}/addRepo`, {
  method: "POST",
  headers: { Accept: "application/json", "Content-Type": "application/json", ...authHeaders },
  cache: "no-store",
  body: JSON.stringify({ repo }),
});
```

GET modes stay query-based.

- [ ] **Step 3: Update page callers**

Keep current `SkillsPage` component structure. Adjust only helper names/body shapes where backend path commands differ.

- [ ] **Step 4: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/lib/__tests__/skills-api.test.ts src/pages/SkillsPage.test.jsx
npm run dashboard:build
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/lib/skills-api.ts dashboard/src/lib/__tests__/skills-api.test.ts dashboard/src/pages/SkillsPage.jsx
git commit -m "feat(dashboard): use vibedeck skills endpoints"
```

---

## Phase G — Branches Page

### Task 13: Branch cost intelligence page

**Files:**
- Modify: `dashboard/src/pages/BranchesPage.jsx`
- Create: `dashboard/src/components/branches/BranchUsageTable.jsx`
- Create: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
- Test: `dashboard/src/pages/BranchesPage.test.jsx`

- [ ] **Step 1: Write failing page tests**

Mock `getBranchUsage` and assert repo names, branch rows, token/cost totals, confidence mix, and session drill-down render.

- [ ] **Step 2: Implement data fetch**

Call:

```js
getBranchUsage({ includeSessions: true, limit: 100 })
```

Support repo/branch filters using query params or local state.

- [ ] **Step 3: Implement branch table**

Columns:
- Repo
- Branch
- Tokens
- Cost
- Sessions
- Last seen
- Confidence mix

Always show confidence. Do not present medium/low/unattributed as certain.

- [ ] **Step 4: Implement session drawer**

Show session rows from the endpoint: provider, session id, start/end, model, tokens, cost, confidence, tier.

- [ ] **Step 5: Run tests/build**

```bash
npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
git add dashboard/src/pages/BranchesPage.jsx dashboard/src/components/branches dashboard/src/content/copy.csv
git commit -m "feat(dashboard): add branch usage page"
```

---

## Phase H — Final Integration And Validation

### Task 14: Copy, labels, hardcode cleanup, theme QA

**Files:**
- Modify: `dashboard/src/content/copy.csv`
- Modify: files touched by Tasks 3-13 that still contain hardcoded visible Plan 5 strings
- Test: relevant dashboard/static tests

- [ ] **Step 1: Add/verify copy keys for all new endpoint states**

Must cover:

```txt
db_unavailable
too_many_clients
not_installed
not_enabled
enabled_no_commits
active
branch_not_fetched
git_error
invalid_repo
invalid_path
missing_repo
missing_confirm_token
invalid_confirm_token
unknown_command
session_not_found
branch aggregate empty range / no repo rows
```

- [ ] **Step 2: Run validators**

```bash
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
```

- [ ] **Step 3: Theme smoke**

Run/build with existing theme tests and add static assertions for the new VibeDeck token names:

```bash
node --test test/dashboard-vibedeck-identity.test.js
npm run dashboard:build
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/content/copy.csv dashboard/src test
git commit -m "chore(dashboard): finalize Plan 5 copy and theme coverage"
```

---

### Task 15: Final validation, smoke, and tag

**Files:**
- Modify: `docs/superpowers/specs/2026-05-10-vibedeck-plan-5-dashboard-ui-design.md` only if final status note is desired

- [ ] **Step 1: Clean artifact check**

```bash
git status --short
```

Expected: clean except intentionally ignored local artifacts.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Dashboard build**

```bash
npm run dashboard:build
```

Expected: pass.

- [ ] **Step 4: Validators**

```bash
npm run validate:copy
npm run validate:ui-hardcode
npm run validate:guardrails
```

Expected: pass.

- [ ] **Step 5: Local smoke**

Start server:

```bash
node bin/vibedeck.js serve --no-sync
```

Smoke URLs:

```bash
curl -s http://127.0.0.1:7690/functions/vibedeck-branch-usage | head
curl -s http://127.0.0.1:7690/functions/vibedeck-attribution-stats | head
curl -s "http://127.0.0.1:7690/functions/vibedeck-skills?mode=installed" | head
```

Browser smoke:

- `http://127.0.0.1:7690/` renders Live Workbench.
- `/usage` renders existing usage analytics.
- `/branches` renders branch page with empty or real data.
- `/entire` accepts a repo path and shows state.
- `/skills` loads without `tokentracker-skills` calls from dashboard code.
- Theme control still supports Light / Dark / System.

- [ ] **Step 6: Tag**

```bash
git tag plan-5-dashboard-ui-complete
git log --oneline plan-4-local-auth-and-migration-complete..HEAD
```

- [ ] **Step 7: Final commit if docs changed**

```bash
git add docs/superpowers/specs/2026-05-10-vibedeck-plan-5-dashboard-ui-design.md
git commit -m "docs(plan5): mark dashboard UI complete"
```

If no docs changed, skip the commit and leave only the tag.

---

## Spec Coverage Self-Review

- Live Workbench home route: Tasks 3, 6, 7, 8.
- Existing usage analytics preserved: Task 9.
- Branches backed by exposed data: Tasks 1, 5, 13.
- Entire workflow from dashboard, including enable repo and advanced raw configure: Tasks 5, 10, 11.
- VibeDeck Skills naming and endpoint migration: Tasks 2, 12.
- Existing collapsible sidebar/theme behavior preserved: Tasks 3, 4, 14.
- Light / Dark / System retained: Tasks 4, 14, 15.
- Endpoint-to-component coverage: Tasks 1, 2, 5, 7, 8, 10, 11, 12, 13.
- Validation gates: Tasks 14, 15.

## Recommended Codex Batches

- Batch A: Tasks 1-2 (backend gaps)
- Batch B: Tasks 3-5 (route, identity, helpers)
- Batch C: Tasks 6-8 (Live Workbench)
- Batch D: Tasks 9-11 (Usage + Entire)
- Batch E: Tasks 12-13 (Skills + Branches)
- Moderator final: Tasks 14-15

Plan is ready for Codex dispatch via `docs/superpowers/codex-workflow.md`.
