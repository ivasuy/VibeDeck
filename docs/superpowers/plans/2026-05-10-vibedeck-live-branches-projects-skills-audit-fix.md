# VibeDeck Dashboard Data Integrity Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix VibeDeck dashboard data correctness for live workbench sessions, branch costs/project-scoped branch browsing, skill deletion, and latest local project usage.

**Architecture:** Keep the TokenTracker parser math in `src/lib/rollout.js` intact except for narrow session-event/project-attribution metadata handling if unavoidable. Prefer fixes in VibeDeck-owned session, local API, and dashboard layers. Use SQLite session rows as the source of truth for live/branch/project local data, and keep `~/.tokentracker` ignored except for explicit migration tools.

**Tech Stack:** Node.js CommonJS local API, `node:sqlite`, React/Vite dashboard, Vitest, Node test runner, VibeDeck copy registry.

---

## Audit Summary

- VibeDeck is using `~/.vibedeck`, not `~/.tokentracker`: `src/lib/tracker-paths.js` resolves `rootDir = ~/.vibedeck`.
- Current VibeDeck DB has 131 `vibedeck_sessions` rows and 0 active rows (`ended_at IS NULL`), so the live workbench empty state is caused by data state, not only UI rendering.
- Recent Codex sessions are present in `vibedeck_sessions` with current timestamps and repo roots, but every recent row is already ended. The pipeline emits `end` events from incremental log batches using `end_reason: "log_complete"`, so a growing session is treated as finished immediately after sync.
- Branch cost is broken for split-window rows because `vibedeck_sessions.total_cost_usd` is null, and `splitSessionByBranchTransitions()` converts null cost to `0`; `queryBranchUsage()` then treats that persisted `0` as authoritative and never falls back to pricing.
- Project usage is stale because `project.queue.jsonl` only contains public-remote project attribution up to May 8. Current local repos such as `/Users/vasuyadav/Downloads/Projects/VibeDeck` have no git remote, so `resolveProjectContextForPath()` blocks them from project queue attribution even though SQLite has repo roots and fresh usage.
- Skills delete is an auth-contract mismatch. Dashboard mutations send `x-tokentracker-local-auth` from `/api/local-auth`, but `/functions/vibedeck-skills/*` requires `Authorization: Bearer <~/.vibedeck/auth.token>` via `requireWriteAuth()`.
- Dual graph MCP was attempted but timed out on both `graph_scan` and `graph_retrieve`; implementation should use focused `rtk` reads/tests until graph service is responsive.

## File Map

- Modify `src/lib/sessions/branch-windows.js`: preserve unknown/null cost as null instead of converting to `0`.
- Modify `src/lib/sessions/pipeline.js`: compute branch windows with nullable cost, and keep live sessions open for recent/growing logs while letting stale historical imports close.
- Modify `src/lib/branch-usage.js`: when a branch-window cost is null, estimate cost from model/tokens instead of returning unknown/zero.
- Modify `src/lib/local-api.js`: add DB-backed project usage merge and unify VibeDeck write auth for skills/attribute/entire endpoints.
- Modify `dashboard/src/pages/BranchesPage.jsx`: replace free-text repo-first workflow with a repo selector/segmented project selection, then show branches for the selected repo.
- Modify `dashboard/src/components/branches/BranchUsageTable.jsx`: support streamlined selected-project branch table labels without changing styling system.
- Modify `dashboard/src/lib/skills-api.ts` or `dashboard/src/lib/local-api-auth.ts`: ensure skill mutations use the auth contract accepted by VibeDeck local API.
- Modify `dashboard/src/hooks/use-project-usage-summary.ts` or `dashboard/src/pages/DashboardPage.jsx`: request recent project usage ordering where appropriate.
- Add/update tests:
  - `test/local-api-vibedeck-branch-usage.test.js`
  - `test/session-branch-windows.test.js`
  - `test/local-api-project-usage-summary.test.js`
  - `test/local-api-vibedeck-skills-auth.test.js`
  - `test/session-live-current-log.test.js`
  - `dashboard/src/pages/BranchesPage.test.jsx`
  - `dashboard/src/lib/__tests__/skills-api.test.ts`

---

### Task 1: Branch Cost Correctness

**Files:**
- Modify: `src/lib/sessions/branch-windows.js`
- Modify: `src/lib/branch-usage.js`
- Test: `test/session-branch-windows.test.js`
- Test: `test/local-api-vibedeck-branch-usage.test.js`

- [ ] **Step 1: Add a failing null-cost branch-window unit test**

Add this case to `test/session-branch-windows.test.js`:

```js
test('splitSessionByBranchTransitions preserves unknown cost as null', () => {
  const windows = splitSessionByBranchTransitions({
    session: {
      started_at: '2026-05-10T00:00:00.000Z',
      ended_at: '2026-05-10T00:30:00.000Z',
      total_tokens: 1_000_000,
      total_cost_usd: null,
      branch: 'main',
    },
    transitions: [],
  });

  assert.equal(windows.length, 1);
  assert.equal(windows[0].prorated_tokens, 1_000_000);
  assert.equal(windows[0].prorated_cost_usd, null);
});
```

Run:

```bash
rtk node --test test/session-branch-windows.test.js
```

Expected: FAIL because current code returns `0`.

- [ ] **Step 2: Preserve nullable costs in branch windows**

Change `splitSessionByBranchTransitions()` so `totalCost` is:

```js
const hasKnownCost = Number.isFinite(session.total_cost_usd);
const totalCost = hasKnownCost ? session.total_cost_usd : null;
```

When returning a single window, set:

```js
prorated_cost_usd: hasKnownCost ? totalCost : null,
```

When splitting multiple windows, keep existing proration only when `hasKnownCost` is true. Otherwise set each `cost` to `null`, do not add it to `costAssigned`, and skip the final cost conservation block.

- [ ] **Step 3: Add a failing branch-usage fallback test for window rows**

In `test/local-api-vibedeck-branch-usage.test.js`, add a case where `vibedeck_session_branch_windows.prorated_cost_usd` is `NULL`, the joined session model is `gpt-5.4`, and `total_tokens` is positive.

Assert:

```js
assert.ok(branch.total_cost_usd > 0);
assert.ok(branch.models[0].total_cost_usd > 0);
assert.ok(branch.sessions[0].total_cost_usd > 0);
```

Run:

```bash
rtk node --test test/local-api-vibedeck-branch-usage.test.js
```

Expected: FAIL until `queryBranchUsage()` estimates cost for window rows.

- [ ] **Step 4: Estimate null window costs in branch usage**

In `src/lib/branch-usage.js`, keep `resolveRowCostUsd(row)` as the single cost resolver. It already estimates from model pricing when `row.total_cost_usd` is null. After Task 1 Step 2, window rows will pass null instead of zero, so this fallback should work. If needed, add a guard that treats window `0` as unknown only when the parent session cost is null and model pricing is available.

- [ ] **Step 5: Verify and commit**

Run:

```bash
rtk node --test test/session-branch-windows.test.js test/local-api-vibedeck-branch-usage.test.js
rtk npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
```

Commit:

```bash
rtk git add src/lib/sessions/branch-windows.js src/lib/branch-usage.js test/session-branch-windows.test.js test/local-api-vibedeck-branch-usage.test.js
rtk git commit -m "fix(api): estimate branch costs for session windows"
```

---

### Task 2: Live Workbench Current Sessions

**Files:**
- Modify: `src/lib/sessions/pipeline.js`
- Modify: `src/lib/sessions/writer.js` only if needed for reopening behavior
- Test: `test/session-live-current-log.test.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Add failing test for recent growing log sessions**

Create `test/session-live-current-log.test.js` with a temp DB, `ensureSchema()`, and `processSessionEvent()` calls that simulate a recent log batch:

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');

test('recent log_complete sessions remain open for live workbench', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-current-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const observed = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'current-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'current-session',
      observed_at: observed,
      delta_tokens: 1000,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'current-session',
      ended_at: observed,
      total_tokens: 1000,
      end_reason: 'log_complete',
      cwd: root,
      model: 'gpt-5.4',
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT ended_at FROM vibedeck_sessions WHERE session_id = ?').get('current-session');
    db.close();
    assert.equal(row.ended_at, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
```

Run:

```bash
rtk node --test test/session-live-current-log.test.js
```

Expected: FAIL because `log_complete` currently ends the session immediately.

- [ ] **Step 2: Define current-log close policy**

In `src/lib/sessions/pipeline.js`, treat `end_reason === "log_complete"` as a parser checkpoint, not a real session end, when `ended_at` is within `VIBEDECK_IDLE_TIMEOUT_MIN` of now. For these events, pass only start/update data into `upsertSessionFromEvents()` or clear `ended_at` after upsert.

Historical imports older than idle timeout must still close, so old backfilled sessions do not flood the workbench.

- [ ] **Step 3: Ensure reaper remains the close mechanism**

Keep `reapOrphanedSessions()` as the owner of idle closure. Verify that `/functions/vibedeck-sessions-live` snapshot calls it and then reads `ended_at IS NULL`.

- [ ] **Step 4: Verify SSE snapshot behavior**

Run:

```bash
rtk node --test test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/sessions/pipeline.js test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "fix(api): keep recent parser sessions live until idle"
```

---

### Task 3: Latest Local Project Usage

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-project-usage-summary.test.js`

- [ ] **Step 1: Add failing DB-backed local project usage test**

Extend `test/local-api-project-usage-summary.test.js` with a temp `vibedeck.sqlite3` next to `queue.jsonl`, insert sessions with `repo_root` values and recent `started_at`, and leave `project.queue.jsonl` stale.

Assert that `/functions/vibedeck-project-usage-summary?sort=recent&limit=2` returns the SQLite repo-root projects first, for example:

```js
assert.deepEqual(
  body.entries.map((entry) => entry.project_key),
  ['VibeDeck', 'SWE-AF'],
);
assert.equal(body.entries[0].project_ref, '/Users/vasuyadav/Downloads/Projects/VibeDeck');
```

Run:

```bash
rtk node --test test/local-api-project-usage-summary.test.js
```

Expected: FAIL because current endpoint only uses `project.queue.jsonl` when non-empty.

- [ ] **Step 2: Add SQLite project aggregation helper**

In `src/lib/local-api.js`, add a helper near project usage:

```js
function readSessionProjectUsage(dbPath) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT
        repo_root,
        SUM(COALESCE(total_tokens, 0)) AS total_tokens,
        MAX(started_at) AS last_seen_at
      FROM vibedeck_sessions
      WHERE repo_root IS NOT NULL AND repo_root <> ''
      GROUP BY repo_root
    `).all();
  } finally {
    db.close();
  }
}
```

Derive display keys from `path.basename(repo_root)`, with collision handling by appending parent folder if needed.

- [ ] **Step 3: Merge DB projects before queue projects**

For `/functions/vibedeck-project-usage-summary`, merge DB-backed local projects with `project.queue.jsonl` entries. If both represent the same repo path/ref, combine tokens and keep the newest `last_seen_at`.

Return string token fields as before:

```js
total_tokens: String(e.total_tokens)
billable_total_tokens: String(e.billable_total_tokens)
```

- [ ] **Step 4: Use recent sorting from dashboard**

In `dashboard/src/hooks/use-project-usage-summary.ts` or the `DashboardPage` call site, ensure the dashboard asks for `sort=recent` for the project usage panel when the intent is “latest projects”.

- [ ] **Step 5: Verify and commit**

```bash
rtk node --test test/local-api-project-usage-summary.test.js
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
rtk git add src/lib/local-api.js dashboard/src/hooks/use-project-usage-summary.ts test/local-api-project-usage-summary.test.js
rtk git commit -m "fix(api): include local repos in project usage"
```

---

### Task 4: Skills Delete and VibeDeck Write Auth

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/lib/local-api-auth.ts` only if needed
- Test: `test/local-api-vibedeck-skills-auth.test.js`
- Test: `dashboard/src/lib/__tests__/skills-api.test.ts`

- [ ] **Step 1: Add failing local-auth skills mutation test**

Create `test/local-api-vibedeck-skills-auth.test.js` that:

1. Creates temp `tracker/queue.jsonl`.
2. Creates `auth.token` if needed.
3. Calls `/api/local-auth` and captures returned token.
4. Calls `/functions/vibedeck-skills/uninstall` with `x-tokentracker-local-auth`.
5. Expects the request to pass auth and reach the command handler.

Current expected failure: 401 because `vibedeck-skills/*` ignores `x-tokentracker-local-auth`.

- [ ] **Step 2: Unify VibeDeck local write auth**

In `src/lib/local-api.js`, for local-only VibeDeck mutation routes (`/functions/vibedeck-skills/*`, `/functions/vibedeck-attribute`, `/functions/vibedeck-entire/*`, `/functions/vibedeck-confirm-destructive`), accept `isAuthorizedLocalMutation(req)` before falling back to persistent `requireWriteAuth()`.

Use this shape:

```js
function requireVibeDeckMutationAuth(req, res, tokenPath) {
  if (isAuthorizedLocalMutation(req)) return true;
  return requireWriteAuth(req, res, { tokenPath });
}
```

Then replace direct `requireWriteAuth()` calls in VibeDeck local dashboard mutation endpoints.

- [ ] **Step 3: Keep loopback origin protection**

Do not remove `hasAllowedLoopbackOrigin()`. Tests must include loopback host/origin/referer where needed so browser mutation behavior matches production local serving.

- [ ] **Step 4: Verify dashboard API headers remain correct**

In `dashboard/src/lib/__tests__/skills-api.test.ts`, assert mutation calls include the mocked `x-tokentracker-local-auth` header.

- [ ] **Step 5: Verify and commit**

```bash
rtk node --test test/local-api-vibedeck-skills-auth.test.js
rtk npm --prefix dashboard exec vitest run src/lib/__tests__/skills-api.test.ts
rtk git add src/lib/local-api.js dashboard/src/lib/__tests__/skills-api.test.ts test/local-api-vibedeck-skills-auth.test.js
rtk git commit -m "fix(api): accept local dashboard auth for skills mutations"
```

---

### Task 5: Branches Page Project-First UI

**Files:**
- Modify: `dashboard/src/pages/BranchesPage.jsx`
- Modify: `dashboard/src/components/branches/BranchUsageTable.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/pages/BranchesPage.test.jsx`

- [ ] **Step 1: Add failing repo-selector UI test**

In `dashboard/src/pages/BranchesPage.test.jsx`, mock two repos in the branch usage payload. Assert that:

```js
expect(screen.getByRole('combobox', { name: copy('branches.project.select_label') })).toBeTruthy();
expect(screen.getByText('/repo-a')).toBeTruthy();
```

After selecting `/repo-b`, assert only `/repo-b` branch rows are visible.

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
```

Expected: FAIL until UI is project-first.

- [ ] **Step 2: Replace repo text filter with project selector**

In `BranchesPage.jsx`, derive:

```js
const repoOptions = payload?.repos || [];
const [selectedRepo, setSelectedRepo] = useState('');
```

Default to the first repo sorted by latest branch `last_seen_at`. Keep the branch text filter as a secondary filter.

- [ ] **Step 3: Render only selected project branches**

Flatten only the selected repo’s branches. Totals should reflect selected project plus branch filter, not all repos.

- [ ] **Step 4: Add copy keys**

Append to `dashboard/src/content/copy.csv`:

```csv
branches.project.select_label,dashboard,BranchesPage,BranchesPage,project_select_label,Project,,active
branches.project.all,dashboard,BranchesPage,BranchesPage,project_all,All projects,,active
branches.project.empty,dashboard,BranchesPage,BranchesPage,project_empty,No project branches yet.,,active
```

- [ ] **Step 5: Verify and commit**

```bash
rtk npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
rtk npm run validate:copy
rtk npm run validate:ui-hardcode
rtk git add dashboard/src/pages/BranchesPage.jsx dashboard/src/components/branches/BranchUsageTable.jsx dashboard/src/content/copy.csv dashboard/src/pages/BranchesPage.test.jsx
rtk git commit -m "feat(dashboard): browse branches by project"
```

---

### Task 6: Final Integration Verification

**Files:**
- No implementation files unless previous tasks uncover integration failures.

- [ ] **Step 1: Run focused backend tests**

```bash
rtk node --test \
  test/session-branch-windows.test.js \
  test/session-live-current-log.test.js \
  test/local-api-vibedeck-branch-usage.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-sessions-live.test.js \
  test/local-api-vibedeck-skills-auth.test.js
```

Expected: all pass.

- [ ] **Step 2: Run focused dashboard tests**

```bash
rtk npm --prefix dashboard exec vitest run \
  src/pages/BranchesPage.test.jsx \
  src/lib/__tests__/skills-api.test.ts \
  src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
```

Expected: all pass.

- [ ] **Step 3: Run full local verification**

```bash
rtk npm test
rtk npm run dashboard:build
rtk npm run validate:copy
rtk npm run validate:ui-hardcode
rtk npm run validate:guardrails
```

Expected: all pass. If `rtk npm test` fails with `listen EPERM 127.0.0.1` in sandbox, rerun outside sandbox because SSE/server tests bind loopback.

- [ ] **Step 4: Manual smoke commands**

```bash
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js serve
```

Open:

```text
http://127.0.0.1:7690
```

Expected:

- Live Workbench shows a currently active/recent Codex session while work is ongoing, then it drops after idle timeout.
- Branches page shows a project selector and branch costs greater than `$0.00` for priced models such as `gpt-5.4`.
- Dashboard project usage shows recent local repos such as `VibeDeck`.
- Skills delete opens confirmation, confirms, and removes/updates the skill list.

---

## Self-Review

- Spec coverage: all reported issues are covered: live sessions, branch cost, project-first branches UI, skills delete, latest project usage, and TokenTracker/VibeDeck path separation.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: plan uses existing endpoint names, existing `copy()` system, existing local auth helper names, and existing Node/Vitest test runners.
