# VibeDeck Dashboard Bugfixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the post-Plan-5 local dashboard issues reported during real local use: cluttered heatmap labels, stale project usage ordering, missing branch costs/models, noisy usage-limit errors, and ended sessions appearing as active.

**Architecture:** Keep the existing dashboard structure and components. Fix backend contracts where the data is wrong or incomplete, then apply narrow UI changes that preserve the current visual system. Avoid parser math changes in `src/lib/rollout.js`; derive missing presentation data outside the parser.

**Tech Stack:** Node.js >=22.5, `node:sqlite`, React 18, Vite/Vitest, node:test, existing local API/dashboard components. No new dependencies.

**Global constraints:**
- Use `rtk` prefix for every shell command.
- Do not modify `src/lib/rollout.js` parser/normalizer math.
- Do not redesign the dashboard or replace major components.
- Each task ends with a commit.
- Known local artifacts remain uncommitted: `.dual-graph-context/`, `.dual-graph/`, `.superpowers/`, `CODEX.md`.

---

## File Map

- `dashboard/src/ui/matrix-a/components/ActivityHeatmap.jsx`  
  Compact heatmap labels and spacing.
- `dashboard/src/content/copy.csv`  
  Missing copy keys and new setup/cooldown messages.
- `src/lib/local-api.js`  
  Project usage endpoint alias, freshness metadata, and live snapshot hygiene.
- `dashboard/src/lib/api.ts` or existing dashboard API helper used by usage dashboard  
  Point project usage to VibeDeck endpoint if helper exists.
- `dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx`  
  Display recency-aware project usage and last-seen metadata.
- `src/lib/branch-usage.js`  
  Add cost derivation fallback and branch model aggregation.
- `dashboard/src/components/branches/BranchUsageTable.jsx`  
  Show branch cost and top model/model mix.
- `dashboard/src/components/branches/BranchSessionDrawer.jsx`  
  Show session model/cost clearly and model aggregation if returned.
- `src/lib/usage-limits.js`  
  Normalize Claude 429 and Gemini missing OAuth into typed provider states.
- `dashboard/src/hooks/use-usage-limits.ts`  
  Respect provider cooldown metadata and avoid aggressive refresh loops.
- `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.jsx`  
  Render setup/cooldown states as actionable non-alarming UI.
- `dashboard/src/hooks/use-vibedeck-live-sessions.ts`  
  Remove ended sessions from active list or separate active/recent-ended.
- `dashboard/src/components/live/LiveSessionList.jsx`  
  Label active list accurately and show stale/sync status if available.
- Tests:
  - `dashboard/src/ui/matrix-a/components/__tests__/ActivityHeatmap.test.jsx`
  - `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx`
  - `test/local-api-project-usage-summary.test.js`
  - `test/local-api-vibedeck-branch-usage.test.js`
  - `dashboard/src/pages/BranchesPage.test.jsx`
  - `test/usage-limits.test.js`
  - `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.test.jsx`
  - `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`
  - `test/local-api-vibedeck-sessions-live.test.js`

---

## Task 1: Heatmap Copy And Density Fix

**Files:**
- Modify: `dashboard/src/ui/matrix-a/components/ActivityHeatmap.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/ui/matrix-a/components/__tests__/ActivityHeatmap.test.jsx`

- [ ] **Step 1: Write failing tests**

Create or extend `ActivityHeatmap.test.jsx` to render a 52-week heatmap and assert:
- no raw `heatmap.day.*` strings are visible,
- compact labels are used,
- not all 7 day names are rendered in the dense view.

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/__tests__/ActivityHeatmap.test.jsx
```

Expected: fail because day copy keys are missing or all labels render.

- [ ] **Step 2: Add missing copy keys**

Add to `dashboard/src/content/copy.csv`:

```csv
heatmap.day.sun,dashboard,ActivityHeatmap,ActivityHeatmap,day_sun,Sun,,active
heatmap.day.mon,dashboard,ActivityHeatmap,ActivityHeatmap,day_mon,Mon,,active
heatmap.day.tue,dashboard,ActivityHeatmap,ActivityHeatmap,day_tue,Tue,,active
heatmap.day.wed,dashboard,ActivityHeatmap,ActivityHeatmap,day_wed,Wed,,active
heatmap.day.thu,dashboard,ActivityHeatmap,ActivityHeatmap,day_thu,Thu,,active
heatmap.day.fri,dashboard,ActivityHeatmap,ActivityHeatmap,day_fri,Fri,,active
heatmap.day.sat,dashboard,ActivityHeatmap,ActivityHeatmap,day_sat,Sat,,active
```

- [ ] **Step 3: Compact the visible labels**

In `ActivityHeatmap.jsx`:
- keep the same cells and colors,
- show day labels only for Mon/Wed/Fri or Sun/Tue/Thu/Sat depending week start,
- reduce `LABEL_WIDTH` if needed,
- filter month markers to avoid adjacent overlap on narrow layouts.

- [ ] **Step 4: Verify**

```bash
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/__tests__/ActivityHeatmap.test.jsx
rtk npm run validate:copy
rtk npm run dashboard:build
```

- [ ] **Step 5: Commit**

```bash
rtk git add dashboard/src/ui/matrix-a/components/ActivityHeatmap.jsx dashboard/src/content/copy.csv dashboard/src/ui/matrix-a/components/__tests__/ActivityHeatmap.test.jsx
rtk git commit -m "fix(dashboard): compact activity heatmap labels"
```

---

## Task 2: Project Usage Freshness And VibeDeck Endpoint Alias

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: dashboard API helper used for usage project calls
- Modify: `dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx`
- Test: `test/local-api-project-usage-summary.test.js`
- Test: `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx`

- [ ] **Step 1: Write failing backend tests**

Add tests proving:
- `/functions/vibedeck-project-usage-summary` returns the same shape as the legacy endpoint,
- `?sort=recent` orders by newest `last_seen_at`,
- `?limit=10` limits entries,
- each entry has `last_seen_at`.

Run:

```bash
rtk node --test test/local-api-project-usage-summary.test.js
```

Expected: fail because alias, sorting, and `last_seen_at` are missing.

- [ ] **Step 2: Implement endpoint alias and freshness metadata**

In `src/lib/local-api.js`:
- accept both `/functions/tokentracker-project-usage-summary` and `/functions/vibedeck-project-usage-summary`,
- aggregate `last_seen_at` from `project.queue.jsonl` row timestamps/hour fields,
- support `sort=recent|tokens`, defaulting to existing token sort for backward compatibility,
- support `limit`.

- [ ] **Step 3: Update dashboard fetch path**

Update the usage dashboard helper/caller so project usage uses:

```text
/functions/vibedeck-project-usage-summary?sort=recent&limit=10
```

Keep legacy endpoint available for old callers.

- [ ] **Step 4: Update project usage UI**

In `ProjectUsagePanel.jsx`:
- keep existing card style,
- optionally show small “last used” text,
- do not fetch GitHub stars for non-GitHub project refs,
- preserve limit selector.

- [ ] **Step 5: Verify**

```bash
rtk node --test test/local-api-project-usage-summary.test.js
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
rtk npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/local-api.js dashboard/src dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx test/local-api-project-usage-summary.test.js
rtk git commit -m "fix(dashboard): show recent project usage"
```

---

## Task 3: Branch Cost And Model Aggregation

**Files:**
- Modify: `src/lib/branch-usage.js`
- Modify: `dashboard/src/components/branches/BranchUsageTable.jsx`
- Modify: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
- Modify: `dashboard/src/pages/BranchesPage.test.jsx`
- Test: `test/local-api-vibedeck-branch-usage.test.js`

- [ ] **Step 1: Write failing backend test**

Extend `test/local-api-vibedeck-branch-usage.test.js`:
- insert sessions with `model`, `total_tokens`, and `total_cost_usd = NULL`,
- assert branch response has non-zero derived cost when pricing is known,
- assert each branch includes `models: [{ model, total_tokens, total_cost_usd, session_count }]`.

Run:

```bash
rtk node --test test/local-api-vibedeck-branch-usage.test.js
```

Expected: fail because derived cost and model aggregation are missing.

- [ ] **Step 2: Implement branch model aggregation**

In `src/lib/branch-usage.js`:
- group rows by `repo_root + branch`,
- add `models` map per branch,
- aggregate model tokens/cost/session count,
- sort models by tokens descending.

- [ ] **Step 3: Add cost fallback**

Use existing pricing utilities outside `src/lib/rollout.js`. If no direct helper exists, create a small helper near pricing code that:
- takes `{ model, total_tokens, total_cost_usd }`,
- returns existing cost when non-null,
- derives approximate cost from known pricing when possible,
- returns `null` rather than `0` when unknown.

Update branch response so unknown cost is distinguishable from true zero.

- [ ] **Step 4: Update branch table**

In `BranchUsageTable.jsx`:
- show cost as `$0.00` only for real zero,
- show `—` or “Unknown” when cost is unknown,
- add top model/model mix column without widening the table too aggressively.

- [ ] **Step 5: Update drawer**

In `BranchSessionDrawer.jsx`:
- show per-session model,
- show per-session cost as unknown when missing,
- optionally show a compact model summary above the table.

- [ ] **Step 6: Verify**

```bash
rtk node --test test/local-api-vibedeck-branch-usage.test.js
rtk npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
rtk npm run dashboard:build
```

- [ ] **Step 7: Commit**

```bash
rtk git add src/lib/branch-usage.js dashboard/src/components/branches dashboard/src/pages/BranchesPage.test.jsx test/local-api-vibedeck-branch-usage.test.js
rtk git commit -m "fix(dashboard): add branch cost and model aggregation"
```

---

## Task 4: Usage Limits Error Resilience

**Files:**
- Modify: `src/lib/usage-limits.js`
- Modify: `dashboard/src/hooks/use-usage-limits.ts`
- Modify: `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `test/usage-limits.test.js`
- Test: `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.test.jsx`

- [ ] **Step 1: Write failing tests**

Backend tests:
- Claude 429 returns provider state with `status: "cooldown"` and `retry_after_seconds`.
- Gemini missing OAuth returns `status: "setup_required"` or equivalent typed field.

UI tests:
- Claude 429 renders cooldown copy.
- Gemini missing OAuth renders setup-required copy.

Run:

```bash
rtk node --test test/usage-limits.test.js
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/UsageLimitsPanel.test.jsx
```

Expected: fail because current UI renders raw errors.

- [ ] **Step 2: Normalize backend states**

In `src/lib/usage-limits.js`:
- preserve raw error internally,
- map Claude 429 to a typed cooldown provider payload,
- map Gemini OAuth config missing to setup-required provider payload,
- keep existing data shape for normal providers.

- [ ] **Step 3: Respect cooldown in hook**

In `use-usage-limits.ts`:
- do not auto-refresh a provider during its cooldown window,
- keep manual refresh available but show cooldown copy,
- avoid converting typed provider states into top-level hard errors.

- [ ] **Step 4: Render typed states**

In `UsageLimitsPanel.jsx`:
- render cooldown as neutral/amber guidance, not red error,
- render Gemini setup-required with concise setup guidance,
- keep real unexpected errors red.

Add copy keys:

```csv
limits.status.cooldown,ui,LimitsPage,UsageLimitsPanel,status_cooldown,Rate limited. Try again in {{duration}}.,,active
limits.status.setup_required,ui,LimitsPage,UsageLimitsPanel,status_setup_required,Setup required,,active
limits.gemini.setup_hint,ui,LimitsPage,UsageLimitsPanel,gemini_setup_hint,Sign in with Gemini CLI OAuth, then refresh limits.,,active
```

- [ ] **Step 5: Verify**

```bash
rtk node --test test/usage-limits.test.js
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/UsageLimitsPanel.test.jsx src/pages/LimitsPage.test.jsx
rtk npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/usage-limits.js dashboard/src/hooks/use-usage-limits.ts dashboard/src/ui/matrix-a/components/UsageLimitsPanel.jsx dashboard/src/content/copy.csv test/usage-limits.test.js dashboard/src/ui/matrix-a/components/UsageLimitsPanel.test.jsx
rtk git commit -m "fix(dashboard): soften usage limit provider errors"
```

---

## Task 5: Live Workbench Active Session Hygiene

**Files:**
- Modify: `dashboard/src/hooks/use-vibedeck-live-sessions.ts`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Modify: `src/lib/local-api.js`
- Test: `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Write failing hook test**

Add tests:
- snapshot containing ended rows does not show them as active,
- `session:end` removes row from active sessions,
- active count excludes ended rows.

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/hooks/use-vibedeck-live-sessions.test.ts
```

Expected: fail because ended rows remain in list.

- [ ] **Step 2: Harden backend snapshot**

In `src/lib/local-api.js`:
- keep `WHERE ended_at IS NULL`,
- before snapshot call `reapOrphanedSessions(dbPath)` so stale open rows are closed,
- optionally include `generated_at` and `last_sync_at` metadata.

- [ ] **Step 3: Update reducer semantics**

In `use-vibedeck-live-sessions.ts`:
- filter ended rows from snapshots,
- on `session:end`, remove that session from active list,
- on update/start, add or merge only when not ended.

- [ ] **Step 4: Update UI copy**

In `LiveSessionList.jsx`:
- keep title “Active sessions” only for active rows,
- add empty state guidance: run sync/active agent if none,
- optionally show stream connected but no active sessions distinctly.

- [ ] **Step 5: Verify**

```bash
rtk npm --prefix dashboard exec vitest run src/hooks/use-vibedeck-live-sessions.test.ts src/pages/LivePage.test.jsx src/pages/LivePage.override.test.jsx
rtk node --test test/local-api-vibedeck-sessions-live.test.js test/sessions-reaper.test.js
rtk npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
rtk git add dashboard/src/hooks/use-vibedeck-live-sessions.ts dashboard/src/components/live/LiveSessionList.jsx src/lib/local-api.js dashboard/src/content/copy.csv test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "fix(dashboard): keep live workbench active-only"
```

---

## Task 6: Sync Freshness Diagnostics

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `src/commands/status.js`
- Modify: dashboard page/component that shows sync freshness, preferably Live page header or usage shell
- Test: add or extend local API/status tests

- [ ] **Step 1: Write failing freshness tests**

Test local API returns:
- `last_parse_at`,
- `queue_updated_at`,
- `project_queue_updated_at`,
- `session_count`,
- `open_session_count`.

Run:

```bash
rtk node --test test/local-api-vibedeck-freshness.test.js
```

Expected: fail because endpoint does not exist.

- [ ] **Step 2: Add freshness endpoint**

In `src/lib/local-api.js`, add:

```text
GET /functions/vibedeck-sync-status
```

It should read `cursors.json`, `queue.jsonl`, `project.queue.jsonl`, and `vibedeck.sqlite3` safely.

- [ ] **Step 3: Surface stale data**

In dashboard:
- fetch sync status on Live/Usage load,
- if last parse is old or server was started with sync disabled, show a small warning,
- do not block normal dashboard rendering.

- [ ] **Step 4: Improve CLI status**

In `src/commands/status.js`:
- show session DB counts,
- show stale `sync.lock` if present,
- show last parse relative age.

- [ ] **Step 5: Verify**

```bash
rtk node --test test/local-api-vibedeck-freshness.test.js
rtk node bin/vibedeck.js status
rtk npm run dashboard:build
```

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/local-api.js src/commands/status.js dashboard/src test/local-api-vibedeck-freshness.test.js
rtk git commit -m "fix(dashboard): expose sync freshness"
```

---

## Final Validation

- [ ] **Step 1: Run focused suites**

```bash
rtk node --test test/local-api-project-usage-summary.test.js test/local-api-vibedeck-branch-usage.test.js test/usage-limits.test.js test/local-api-vibedeck-sessions-live.test.js
rtk npm --prefix dashboard exec vitest run src/hooks/use-vibedeck-live-sessions.test.ts src/pages/BranchesPage.test.jsx src/ui/matrix-a/components/UsageLimitsPanel.test.jsx src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
```

- [ ] **Step 2: Full verification**

```bash
rtk npm test
rtk npm run dashboard:build
rtk npm run validate:copy
rtk npm run validate:ui-hardcode
rtk npm run validate:guardrails
```

- [ ] **Step 3: Manual smoke**

```bash
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js serve
```

Check:
- `/usage`: heatmap has compact labels and no raw copy keys.
- `/usage`: project usage includes recent projects.
- `/branches`: cost is non-zero where pricing is known, unknown where pricing is unavailable, and models are visible.
- `/`: ended old Gemini rows are not listed as active sessions.
- `/usage` limits: Claude 429 shows cooldown; Gemini missing OAuth shows setup-required.

- [ ] **Step 4: Final commit or tag if requested**

Only tag after user confirms the fixes are acceptable locally.

