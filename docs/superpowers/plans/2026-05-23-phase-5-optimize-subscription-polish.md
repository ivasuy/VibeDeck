# Phase 5 Optimize Subscription Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Phase 5 optimizer findings, plan/subscription display, currency conversion, forecast/trend/pulse analytics, and dashboard/Mac polish without changing canonical usage costs or branch attribution.

**Architecture:** Add one isolated optimizer write table and read-only analytics modules over existing canonical session events and branch facts. Optimizer estimates live only in `vibedeck_optimize_findings`; `/dashboard`, `/usage`, `/branches`, Unknown branch, Historical unknown, tokens, and `cost_usd` remain fact-driven. Dashboard and Mac app consume new local API endpoints and show explicit plan/currency labels so API-equivalent dollars are not confused with actual subscription bills.

**Tech Stack:** Node.js CommonJS, `node:sqlite` `DatabaseSync`, existing VibeDeck local HTTP API, React/Vite/Vitest dashboard, SwiftUI Mac app, SQLite migrations, local JSON config/cache files.

---

## Non-Negotiable Safety Rules

- `vibedeck_branch_usage_facts.cost_usd` and `total_cost_usd` are never updated by optimizer code.
- Optimizer estimates are displayed as inferred waste only and never included in dashboard/usage/branches cost totals.
- Currency conversion is display-only. CSV/JSON export keeps `cost_usd` and `total_cost_usd` in USD.
- Plan labels must say `API-equivalent cost` for Cursor/Copilot-style flat-rate subscriptions and `Plan usage` for Claude plans.
- Forecast/trend/pulse endpoints are read-only over `vibedeck_branch_usage_facts`.
- `/dashboard`, `/usage`, `/branches`, branch drawers, Unknown branch, and Historical unknown rows remain source-of-truth surfaces; new UI surfaces must be additive.
- Scheduled optimizer scans must run after server startup and never block `serve`.

## File Structure

- `src/lib/db/migrations/015-optimize-findings.js` — additive optimizer table migration.
- `src/lib/db/index.js` — registers migration 015.
- `src/lib/optimize-scanner.js` — reads canonical events/sessions and writes optimizer findings only.
- `src/lib/optimize-schedule.js` — non-blocking scheduled scan helper for `serve`.
- `src/commands/optimize.js` — CLI command for manual scans and JSON output.
- `src/commands/serve.js` — starts scheduled optimizer scan after HTTP server is live.
- `src/cli.js` — registers `optimize` command and help text.
- `src/lib/plan-config.js` — per-user plan config from env plus local config file.
- `src/lib/currency-rates.js` — Frankfurter-backed display-rate cache with injectable fetch for tests.
- `src/lib/forecast-read-model.js` — moving average, linear forecast, and anomaly detection over branch facts.
- `src/lib/local-api.js` — new Phase 5 read endpoints.
- `dashboard/src/lib/api.ts` and `dashboard/src/lib/vibedeck-api.ts` — client helpers for Phase 5 endpoints.
- `dashboard/src/pages/OptimizePage.jsx` and `dashboard/src/pages/OptimizePage.test.jsx` — optimizer findings dashboard.
- `dashboard/src/pages/PlanPage.jsx` and `dashboard/src/pages/PlanPage.test.jsx` — plan/subscription progress view.
- `dashboard/src/pages/DashboardPage.jsx` and `dashboard/src/pages/DashboardPage.test.jsx` — forecast banner and reading-pattern hints.
- `dashboard/src/pages/SettingsPage.jsx` and `dashboard/src/pages/SettingsPage.test.jsx` — display currency picker.
- `dashboard/src/App.jsx`, `dashboard/src/App.test.jsx`, `dashboard/src/ui/openai/components/Sidebar.jsx`, `dashboard/src/content/copy.csv` — routes/nav/copy.
- `VibeDeckMac/VibeDeckMac/Models/Phase5Models.swift` — optimizer, plan, currency, forecast decoders.
- `VibeDeckMac/VibeDeckMac/Services/APIClient.swift` — Phase 5 endpoint clients.
- `VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift` — Phase 5 state and refresh.
- `VibeDeckMac/VibeDeckMac/Views/OptimizePlanTabsView.swift` — Optimize and Plan tab UI.
- `VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift` and `VibeDeckMac/VibeDeckMac/Views/DashboardView.swift` — embed new tabs/card.
- `VibeDeckMac/VibeDeckMac/Views/LimitsSettingsView.swift` — currency picker in settings.
- `VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj` — add new Swift files.
- `test/db-migration-015-optimize-findings.test.js`, `test/optimize-scanner.test.js`, `test/cli-optimize.test.js`, `test/local-api-phase5.test.js`, `test/phase5-write-isolation.test.js` — backend coverage.
- `PROJECT.md` — phase-close user-facing progress and real smoke results.

---

### Task 1: Optimizer Table, Scanner, CLI, and Schedule

**Files:**
- Create: `src/lib/db/migrations/015-optimize-findings.js`
- Modify: `src/lib/db/index.js`
- Create: `src/lib/optimize-scanner.js`
- Create: `src/lib/optimize-schedule.js`
- Create: `src/commands/optimize.js`
- Modify: `src/commands/serve.js`
- Modify: `src/cli.js`
- Test: `test/db-migration-015-optimize-findings.test.js`
- Test: `test/optimize-scanner.test.js`
- Test: `test/cli-optimize.test.js`
- Test: `test/phase5-write-isolation.test.js`

**Integration Contracts:**

```js
// src/lib/optimize-scanner.js
function runOptimizeScan({ dbPath, now = new Date(), cwd = process.cwd(), env = process.env } = {}) {
  return {
    ok: true,
    run_id: 'opt-2026-05-23T00:00:00.000Z',
    observed_at: '2026-05-23T00:00:00.000Z',
    inserted: 3,
    resolved: 0,
    health_grade: 'B',
    score: 82,
    counts_by_severity: { high: 0, medium: 2, low: 1 },
    counts_by_kind: { file_reread: 1, low_read_edit_ratio: 1, bloated_claude_md: 1 },
  };
}

function readOptimizeFindings({ dbPath, status = 'open', limit = 100 } = {}) {
  return { ok: true, findings: [], latest_run: null, health: null };
}
```

```js
// src/lib/optimize-schedule.js
function startOptimizeSchedule({ dbPath, logger = console, intervalMs = 6 * 60 * 60 * 1000 } = {}) {
  return { stop() {}, trigger: async () => ({ ok: true, skipped: false }) };
}
```

```js
// src/commands/optimize.js
async function cmdOptimize(argv = []) {
  return 0;
}
```

- [ ] **Step 1: Write migration test**

Create `test/db-migration-015-optimize-findings.test.js` with this behavior:

```js
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('../src/lib/db');

test('migration 015 creates isolated optimize tables and leaves branch facts intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-opt-migration-'));
  const dbPath = path.join(dir, 'usage.db');
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'vibedeck_optimize_%' ORDER BY name").all().map((r) => r.name);
    assert.deepEqual(tables, ['vibedeck_optimize_findings', 'vibedeck_optimize_runs']);
    const factCols = db.prepare('PRAGMA table_info(vibedeck_branch_usage_facts)').all().map((r) => r.name);
    assert.ok(factCols.includes('total_cost_usd'));
    assert.ok(!factCols.includes('estimated_cost_waste_usd'));
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Implement migration 015 and register it**

Create `src/lib/db/migrations/015-optimize-findings.js`:

```js
'use strict';

module.exports = {
  component: 'vibedeck-optimize',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_optimize_runs (
        run_id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        health_grade TEXT NOT NULL,
        score INTEGER NOT NULL,
        finding_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE vibedeck_optimize_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES vibedeck_optimize_runs(run_id),
        fingerprint TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_ref TEXT,
        provider TEXT,
        session_id TEXT,
        finding_kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        estimated_token_waste INTEGER NOT NULL DEFAULT 0,
        estimated_cost_waste_usd REAL NOT NULL DEFAULT 0,
        paste_fix TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        trend TEXT NOT NULL DEFAULT 'new',
        observed_at TEXT NOT NULL,
        resolved_at TEXT,
        previous_finding_id INTEGER REFERENCES vibedeck_optimize_findings(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (scope IN ('session', 'project', 'config')),
        CHECK (finding_kind IN ('file_reread', 'low_read_edit_ratio', 'bloated_claude_md')),
        CHECK (severity IN ('high', 'medium', 'low')),
        CHECK (status IN ('open', 'resolved')),
        CHECK (trend IN ('new', 'improving', 'unchanged', 'resolved')),
        CHECK (estimated_token_waste >= 0),
        CHECK (estimated_cost_waste_usd >= 0)
      );

      CREATE INDEX idx_optimize_findings_run ON vibedeck_optimize_findings(run_id);
      CREATE INDEX idx_optimize_findings_status ON vibedeck_optimize_findings(status, observed_at);
      CREATE INDEX idx_optimize_findings_kind ON vibedeck_optimize_findings(finding_kind, severity);
      CREATE INDEX idx_optimize_findings_session ON vibedeck_optimize_findings(provider, session_id);
      CREATE INDEX idx_optimize_findings_fingerprint ON vibedeck_optimize_findings(fingerprint, observed_at);
    `);
  },
};
```

Modify `src/lib/db/index.js` to require and register `m015` after `m014`.

Run:

```bash
node --test test/db-migration-015-optimize-findings.test.js
```

Expected: the migration test passes.

- [ ] **Step 3: Write scanner tests for the three finding kinds and idempotent health grade**

Create `test/optimize-scanner.test.js` with rows inserted into `vibedeck_session_events`, `vibedeck_sessions`, and `vibedeck_branch_usage_facts`. Use exact assertions:

```js
assert.equal(first.inserted, 3);
assert.equal(second.health_grade, first.health_grade);
assert.deepEqual(second.counts_by_kind, first.counts_by_kind);
assert.ok(findings.find((f) => f.finding_kind === 'file_reread'));
assert.ok(findings.find((f) => f.finding_kind === 'low_read_edit_ratio'));
assert.ok(findings.find((f) => f.finding_kind === 'bloated_claude_md'));
```

Use synthetic events:

- `file_reread`: same `tools_json` includes `Read` and same `activity_json` includes `reading` across one session with repeated event detail paths in `metadata_json` when available; if no path metadata exists, repeated `Read` counts above 4 in a single session is enough for this first scanner.
- `low_read_edit_ratio`: `tools_json` has `Read >= 10` and `Edit + MultiEdit + Write <= 1`.
- `bloated_claude_md`: create a temporary `CLAUDE.md` larger than 80 KB and pass its path via `cwd`.

- [ ] **Step 4: Implement `src/lib/optimize-scanner.js`**

Implement these exported functions:

```js
module.exports = {
  runOptimizeScan,
  readOptimizeFindings,
  computeHealthGrade,
  buildFindingFingerprint,
};
```

Scanner rules:

- Read from `vibedeck_session_events` and `vibedeck_sessions` only.
- Use `tools_json`, `activity_json`, `input_tokens`, `output_tokens`, `cached_input_tokens`, `provider`, `session_id`, `source_path`, and timestamps.
- Write one `vibedeck_optimize_runs` row per scan.
- Write one `vibedeck_optimize_findings` row per observed finding per scan.
- Resolve previous open findings by inserting a `resolved` row with `trend = 'resolved'` when a previous fingerprint is absent from the current scan.
- Estimate token waste conservatively:
  - `file_reread`: `Math.max(0, readCount - 1) * 1000`.
  - `low_read_edit_ratio`: `Math.max(0, readCount - editCount - 4) * 700`.
  - `bloated_claude_md`: `Math.ceil(fileSize / 4)`.
- Estimate cost waste as `estimated_token_waste * 0.000003`, rounded to 6 decimals.
- Health score: start at 100, subtract high `20`, medium `8`, low `3`, floor at 0.
- Grade: `A >= 90`, `B >= 80`, `C >= 70`, `D >= 60`, `E >= 50`, else `F`.
- Paste fixes:
  - `file_reread`: `Cache repeated file reads or summarize the file once before asking follow-up questions.`
  - `low_read_edit_ratio`: `Batch reads into a short plan, then edit only the files that need changes.`
  - `bloated_claude_md`: `Split CLAUDE.md into focused docs and keep the root file under 80 KB.`

- [ ] **Step 5: Write write-isolation test**

Create `test/phase5-write-isolation.test.js` that seeds one `vibedeck_branch_usage_facts` row with `total_cost_usd = 12.3456`, runs `runOptimizeScan`, then asserts:

```js
const after = db.prepare('SELECT total_cost_usd FROM vibedeck_branch_usage_facts WHERE session_id = ?').get('s1');
assert.equal(after.total_cost_usd, 12.3456);
```

Also scan source files in the test to assert `src/lib/optimize-scanner.js` does not contain `UPDATE vibedeck_branch_usage_facts`, `INSERT INTO vibedeck_branch_usage_facts`, or `DELETE FROM vibedeck_branch_usage_facts`.

- [ ] **Step 6: Implement CLI command and tests**

Create `src/commands/optimize.js`:

```js
async function cmdOptimize(argv = []) {
  const json = argv.includes('--json');
  const scan = argv.includes('--scan') || argv.length === 0;
  if (!scan) throw new Error('Usage: vibedeck optimize [--scan] [--json]');
  const dbPath = process.env.VIBEDECK_DB_PATH || require('../lib/paths').getUsageDbPath?.() || '';
  const result = runOptimizeScan({ dbPath });
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`);
  else process.stdout.write(`Optimize scan ${result.run_id}: ${result.inserted} findings, health ${result.health_grade}\n`);
  return 0;
}
```

Adapt the database path helper to the repository's actual path helper while preserving the command contract. Add `optimize` to `src/cli.js` and help text:

```text
npx vibedeck-cli [--debug] optimize [--scan] [--json]
```

Test `test/cli-optimize.test.js` should import `cmdOptimize`, run it against a temp DB via `VIBEDECK_DB_PATH`, and assert JSON contains `ok: true`, `run_id`, and `health_grade`.

- [ ] **Step 7: Implement scheduled non-blocking scan**

Create `src/lib/optimize-schedule.js` so `startOptimizeSchedule`:

- No-ops unless `VIBEDECK_OPTIMIZE_SCHEDULE_V1` is `on` or `1`.
- Uses `setTimeout(..., 10_000).unref()` for the first scan so `serve` starts first.
- Runs at most once per `intervalMs` based on latest `vibedeck_optimize_runs.observed_at`.
- Logs failures as warnings and never throws into `serve`.

Modify `src/commands/serve.js` after server listen/startup to call `startOptimizeSchedule({ dbPath })` and retain no blocking await. The test for this can import `startOptimizeSchedule` with a temp DB and fake interval; it must assert `{ skipped: true }` when the flag is off.

- [ ] **Step 8: Run Task 1 checks and commit**

Run:

```bash
node --test test/db-migration-015-optimize-findings.test.js test/optimize-scanner.test.js test/cli-optimize.test.js test/phase5-write-isolation.test.js
node --test test/local-api-codeburn-parity.test.js test/session-event-codeburn-parity.test.js
```

Expected: all tests pass. Then commit:

```bash
git add src/lib/db/migrations/015-optimize-findings.js src/lib/db/index.js src/lib/optimize-scanner.js src/lib/optimize-schedule.js src/commands/optimize.js src/commands/serve.js src/cli.js test/db-migration-015-optimize-findings.test.js test/optimize-scanner.test.js test/cli-optimize.test.js test/phase5-write-isolation.test.js
git commit -m "feat: add optimize scanner"
```

---

### Task 2: Plan, Currency, Forecast, Trend, and Pulse Backend

**Files:**
- Create: `src/lib/plan-config.js`
- Create: `src/lib/currency-rates.js`
- Create: `src/lib/forecast-read-model.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-phase5.test.js`
- Test: `test/currency-rates.test.js`
- Test: `test/forecast-read-model.test.js`

**Integration Contracts:**

```js
function readPlanConfig({ env = process.env, home = require('node:os').homedir() } = {}) {
  return {
    plan: 'cursor-pro',
    monthly_usd: 20,
    label: 'API-equivalent cost',
    label_detail: 'API-equivalent cost — this is what these tokens would have cost via direct API, not what you owe Cursor.',
    display_currency: 'USD',
  };
}

async function readCurrencyRates({ base = 'USD', symbols = ['EUR'], cachePath, fetchImpl } = {}) {
  return { base: 'USD', rates: { EUR: 0.92 }, cached: false, as_of: '2026-05-23T00:00:00.000Z' };
}

function buildForecastPayload(rows, options = {}) {
  return { ok: true, moving_average_7d: '12.3400', forecast_30d_usd: '370.2000', anomalies: [] };
}
```

- [ ] **Step 1: Write backend endpoint tests**

Create `test/local-api-phase5.test.js` using the existing local API test style. Cover:

- `GET /functions/vibedeck-optimize/findings` returns latest health and findings from the optimizer table.
- `GET /functions/vibedeck-plan` with `VIBEDECK_PLAN=cursor-pro` returns label text containing `API-equivalent cost` and `not what you owe Cursor`.
- `GET /functions/vibedeck-plan` with `VIBEDECK_PLAN=claude-pro` returns label `Plan usage`.
- `GET /functions/vibedeck-forecast` returns in under 200ms on 90 daily fact rows.
- `GET /functions/vibedeck-export?format=json&currency=EUR` still returns USD fields named `total_cost_usd` or `cost_usd` with unchanged numeric values.

- [ ] **Step 2: Implement plan config**

Create `src/lib/plan-config.js`:

- Read env first: `VIBEDECK_PLAN`, `VIBEDECK_PLAN_MONTHLY_USD`, `VIBEDECK_DISPLAY_CURRENCY`.
- Read per-user JSON file second: `~/.vibedeck/plan-config.json` when env values are absent.
- Supported plans:
  - `claude-pro`: monthly USD default `20`, label `Plan usage`.
  - `claude-max`: monthly USD default `100`, label `Plan usage`.
  - `cursor-pro`: monthly USD default `20`, label `API-equivalent cost` and detail from audit Section 28.5.
  - `copilot-pro`: monthly USD default `10`, label `API-equivalent cost` and detail from audit Section 28.5.
  - `custom`: monthly USD from config/env or `0`, label `API-equivalent cost`.
- Currency normalization accepts uppercase 3-letter codes and defaults to `USD`.

- [ ] **Step 3: Implement currency rates with 24h cache**

Create `src/lib/currency-rates.js`:

- Cache path default: `~/.vibedeck/currency-rates.json`.
- Cache is valid for 24h.
- Use Frankfurter endpoint `https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,JPY`.
- Tests inject `fetchImpl`; implementation must not require network in tests.
- On fetch failure with stale cache, return stale cache plus `stale: true`.
- On fetch failure without cache, return `{ base: 'USD', rates: { USD: 1 }, error: 'currency_rates_unavailable' }` without throwing into local API.

- [ ] **Step 4: Implement forecast/trend/pulse read model**

Create `src/lib/forecast-read-model.js`:

- Input rows are branch fact rows from `vibedeck_branch_usage_facts`.
- Group by `substr(last_observed_at, 1, 10)` and sum `total_cost_usd`.
- Return daily series sorted ascending.
- `moving_average_7d` = average of last up to 7 days.
- `forecast_30d_usd` = non-negative linear regression projection for next 30 days. Clamp negative projection to zero.
- `anomalies` = days where cost is at least `2x` prior 7-day average and at least `$1.00` higher.
- `pulse` includes `{ state: 'quiet' | 'rising' | 'spike', reason }`.

- [ ] **Step 5: Wire local API routes**

Modify `src/lib/local-api.js`:

- Add routes:
  - `/functions/vibedeck-optimize/findings`
  - `/functions/vibedeck-plan`
  - `/functions/vibedeck-currency-rates`
  - `/functions/vibedeck-forecast`
- Use existing `codeburnDbPath(qp)` and `readCodeburnFactRows` patterns.
- `vibedeck-plan` computes month-to-date API-equivalent spend from branch facts and compares it to monthly plan USD.
- `vibedeck-currency-rates` does not convert canonical rows; it only returns display metadata.
- `vibedeck-forecast` accepts `from`, `to`, `source`, `model`, and `branch` filters.

- [ ] **Step 6: Run Task 2 checks and commit**

Run:

```bash
node --test test/local-api-phase5.test.js test/currency-rates.test.js test/forecast-read-model.test.js test/local-api-codeburn-parity.test.js
```

Expected: all tests pass. Then run a source scan:

```bash
rg -n "UPDATE vibedeck_branch_usage_facts|INSERT INTO vibedeck_branch_usage_facts|DELETE FROM vibedeck_branch_usage_facts" src/lib/plan-config.js src/lib/currency-rates.js src/lib/forecast-read-model.js src/lib/local-api.js
```

Expected: no matches introduced by Phase 5 backend modules except existing non-Phase5 code paths in `local-api.js`. Commit:

```bash
git add src/lib/plan-config.js src/lib/currency-rates.js src/lib/forecast-read-model.js src/lib/local-api.js test/local-api-phase5.test.js test/currency-rates.test.js test/forecast-read-model.test.js
git commit -m "feat: add plan currency forecast endpoints"
```

---

### Task 3: Dashboard Optimize, Plan, Currency, Forecast Banner, and Reading Hints

**Files:**
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Create: `dashboard/src/pages/OptimizePage.jsx`
- Create: `dashboard/src/pages/OptimizePage.test.jsx`
- Create: `dashboard/src/pages/PlanPage.jsx`
- Create: `dashboard/src/pages/PlanPage.test.jsx`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/pages/DashboardPage.test.jsx`
- Modify: `dashboard/src/pages/SettingsPage.jsx`
- Modify: `dashboard/src/pages/SettingsPage.test.jsx`
- Modify: `dashboard/src/App.jsx`
- Modify: `dashboard/src/App.test.jsx`
- Modify: `dashboard/src/ui/openai/components/Sidebar.jsx`
- Modify: `dashboard/src/content/copy.csv`

**Integration Contracts:**

```ts
// dashboard/src/lib/vibedeck-api.ts
export function getOptimizeFindings(params?: Record<string, any>, fetchImpl?: typeof fetch): Promise<any>;
export function getPlanView(params?: Record<string, any>, fetchImpl?: typeof fetch): Promise<any>;
export function getCurrencyRates(params?: Record<string, any>, fetchImpl?: typeof fetch): Promise<any>;
export function getForecastView(params?: Record<string, any>, fetchImpl?: typeof fetch): Promise<any>;
```

- [ ] **Step 1: Write API client tests**

Extend `dashboard/src/lib/__tests__/vibedeck-api.test.ts`:

```ts
it('fetches Phase 5 optimize plan currency and forecast endpoints', async () => {
  const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });
  await getOptimizeFindings({}, fetchImpl as any);
  await getPlanView({}, fetchImpl as any);
  await getCurrencyRates({ currency: 'EUR' }, fetchImpl as any);
  await getForecastView({}, fetchImpl as any);
  expect(fetchImpl.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
    expect.stringContaining('/functions/vibedeck-optimize/findings'),
    expect.stringContaining('/functions/vibedeck-plan'),
    expect.stringContaining('/functions/vibedeck-currency-rates'),
    expect.stringContaining('/functions/vibedeck-forecast'),
  ]));
});
```

- [ ] **Step 2: Add API helpers**

Modify `dashboard/src/lib/api.ts` and `dashboard/src/lib/vibedeck-api.ts` to expose Phase 5 endpoint helpers following existing compare/models/yield patterns.

- [ ] **Step 3: Create Optimize page**

Create `dashboard/src/pages/OptimizePage.jsx`:

- Fetch `getOptimizeFindings` on mount.
- Render health grade, score, latest run timestamp, total estimated waste, and findings grouped by `high`, `medium`, `low`.
- Each finding shows title, detail, `estimated_token_waste`, `estimated_cost_waste_usd`, and a `Paste fix` button that copies `paste_fix` to clipboard when available.
- Empty state text: `No optimize findings yet. Run vibedeck optimize --scan to generate the first scan.`
- Do not display optimizer estimated waste in the same typography as actual spend totals; label it `Estimated avoidable cost`.

Create `dashboard/src/pages/OptimizePage.test.jsx` to assert health grade and grouped severities render, plus empty state.

- [ ] **Step 4: Create Plan page**

Create `dashboard/src/pages/PlanPage.jsx`:

- Fetch `getPlanView` on mount.
- Render plan name, monthly USD, month-to-date API-equivalent spend, progress bar, and label detail.
- For Cursor/Copilot, test-visible text must include:

```text
API-equivalent cost — this is what these tokens would have cost via direct API, not what you owe Cursor.
```

- For Claude, render `Plan usage` and no Cursor-specific debt wording.

Create `dashboard/src/pages/PlanPage.test.jsx` with both label cases.

- [ ] **Step 5: Add routes and sidebar nav**

Modify `dashboard/src/App.jsx`:

- Import `OptimizePage` and `PlanPage`.
- Route `/optimize` to `OptimizePage`.
- Route `/plan` to `PlanPage`.
- Include both in `showSidebar`.

Modify `dashboard/src/ui/openai/components/Sidebar.jsx` and `dashboard/src/content/copy.csv` to add nav labels `Optimize` and `Plan`. Extend `dashboard/src/App.test.jsx` to assert both routes mount.

- [ ] **Step 6: Add forecast banner to DashboardPage**

Modify `dashboard/src/pages/DashboardPage.jsx`:

- Fetch `getForecastView` and `getPlanView` for the active date range.
- If `forecast_30d_usd > monthly_usd` and `monthly_usd > 0`, render a non-blocking banner:

```text
Projected month spend is above your configured plan. Showing API-equivalent cost, not provider billing.
```

- When forecast data is missing, render no banner and avoid page-level errors.

Extend `DashboardPage.test.jsx` with a mocked forecast response showing the banner and a no-data response hiding it.

- [ ] **Step 7: Add Settings currency picker**

Modify `dashboard/src/pages/SettingsPage.jsx`:

- Add display currency select with `USD`, `EUR`, `GBP`, `JPY`, `INR`.
- Store selected display currency in `localStorage` key `vibedeck.displayCurrency`.
- Fetch `getCurrencyRates({ currency })` after change and show `Display currency only. Exports keep USD cost columns.`

Extend `SettingsPage.test.jsx` to assert the warning text and persistence.

- [ ] **Step 8: Add reading-pattern hints to session detail**

Modify session detail rendering in `DashboardPage.jsx` or existing drawer component:

- Compute cache hit percent from enriched session counters when available.
- If cache hit percent is below `80` and total input tokens are positive, show hint:

```text
Reading pattern hint: cache hit below 80%. Repeated reads may be costing extra tokens.
```

- Null counters must not render hints.

- [ ] **Step 9: Run Task 3 checks and commit**

Run:

```bash
npm --prefix dashboard test -- --run dashboard/src/lib/__tests__/vibedeck-api.test.ts dashboard/src/pages/OptimizePage.test.jsx dashboard/src/pages/PlanPage.test.jsx dashboard/src/pages/DashboardPage.test.jsx dashboard/src/pages/SettingsPage.test.jsx dashboard/src/App.test.jsx
npm --prefix dashboard run build
```

Expected: tests and build pass. Commit:

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/vibedeck-api.ts dashboard/src/lib/__tests__/vibedeck-api.test.ts dashboard/src/pages/OptimizePage.jsx dashboard/src/pages/OptimizePage.test.jsx dashboard/src/pages/PlanPage.jsx dashboard/src/pages/PlanPage.test.jsx dashboard/src/pages/DashboardPage.jsx dashboard/src/pages/DashboardPage.test.jsx dashboard/src/pages/SettingsPage.jsx dashboard/src/pages/SettingsPage.test.jsx dashboard/src/App.jsx dashboard/src/App.test.jsx dashboard/src/ui/openai/components/Sidebar.jsx dashboard/src/content/copy.csv
git commit -m "feat: add optimize and plan dashboard surfaces"
```

---

### Task 4: Mac Optimize, Plan, Currency, and Forecast Polish

**Files:**
- Create: `VibeDeckMac/VibeDeckMac/Models/Phase5Models.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Services/APIClient.swift`
- Modify: `VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift`
- Create: `VibeDeckMac/VibeDeckMac/Views/OptimizePlanTabsView.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Views/DashboardView.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Views/LimitsSettingsView.swift`
- Modify: `VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj`

**Integration Contracts:**

```swift
struct OptimizeFindingsResponse: Decodable, Equatable {
    let ok: Bool
    let health: OptimizeHealth?
    let findings: [OptimizeFinding]
}

struct PlanViewResponse: Decodable, Equatable {
    let ok: Bool
    let plan: String
    let label: String
    let labelDetail: String
    let monthlyUsd: Double
    let monthToDateUsd: Double
}

struct ForecastResponse: Decodable, Equatable {
    let ok: Bool
    let movingAverage7d: String
    let forecast30dUsd: String
    let anomalies: [ForecastAnomaly]
}
```

- [ ] **Step 1: Add Phase 5 Swift models**

Create `VibeDeckMac/VibeDeckMac/Models/Phase5Models.swift` with `CodingKeys` mapping snake_case endpoint fields to Swift properties. All nested arrays default to empty when omitted; all optional detail strings decode safely.

- [ ] **Step 2: Add APIClient methods**

Modify `APIClient.swift`:

```swift
func fetchOptimizeFindings() async throws -> OptimizeFindingsResponse {
    try await fetch("/functions/vibedeck-optimize/findings")
}

func fetchPlanView() async throws -> PlanViewResponse {
    try await fetch("/functions/vibedeck-plan")
}

func fetchForecast() async throws -> ForecastResponse {
    try await fetch("/functions/vibedeck-forecast")
}

func fetchCurrencyRates(currency: String) async throws -> CurrencyRatesResponse {
    try await fetch("/functions/vibedeck-currency-rates", queryItems: [URLQueryItem(name: "currency", value: currency)])
}
```

- [ ] **Step 3: Extend DashboardViewModel**

Add published properties:

```swift
@Published var optimizeFindings: OptimizeFindingsResponse?
@Published var planView: PlanViewResponse?
@Published var forecastView: ForecastResponse?
@Published var displayCurrency: String = UserDefaults.standard.string(forKey: "vibedeck.displayCurrency") ?? "USD"
```

Fetch these alongside existing parity calls. Failures are non-fatal and appended to the parity warning text, not the main summary error count.

- [ ] **Step 4: Add Optimize/Plan SwiftUI tabs**

Create `OptimizePlanTabsView.swift`:

- `OptimizeTab` groups findings by severity and shows a paste-fix button using `NSPasteboard.general`.
- `PlanTab` shows progress bar and label detail; Cursor/Copilot API-equivalent label must be visible when returned by the endpoint.
- `ForecastCard` shows 7-day average, 30-day forecast, and anomalies count.
- All text has accessibility labels for grade, plan progress, and paste fix.

- [ ] **Step 5: Embed Phase 5 UI**

Modify `CodeburnParityTabsView.swift` to add `Optimize` and `Plan` tabs after `Yield`.

Modify `DashboardView.swift` to include `ForecastCard` in the Stats area when forecast data exists.

Modify `LimitsSettingsView.swift` to add a display currency picker backed by `UserDefaults` key `vibedeck.displayCurrency` and call `fetchCurrencyRates` when changed. Show helper text: `Display currency only. Exports keep USD cost columns.`

- [ ] **Step 6: Register files in Xcode project**

Add `Phase5Models.swift` and `OptimizePlanTabsView.swift` to `VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj` in the same target group style as `CodeburnParityModels.swift` and `CodeburnParityTabsView.swift`.

- [ ] **Step 7: Run Task 4 checks and commit**

Run:

```bash
xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -destination 'platform=macOS' build
```

Expected: build succeeds. Existing non-fatal EmbeddedServer script warnings may remain. Commit:

```bash
git add VibeDeckMac/VibeDeckMac/Models/Phase5Models.swift VibeDeckMac/VibeDeckMac/Services/APIClient.swift VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift VibeDeckMac/VibeDeckMac/Views/OptimizePlanTabsView.swift VibeDeckMac/VibeDeckMac/Views/CodeburnParityTabsView.swift VibeDeckMac/VibeDeckMac/Views/DashboardView.swift VibeDeckMac/VibeDeckMac/Views/LimitsSettingsView.swift VibeDeckMac/VibeDeckMac.xcodeproj/project.pbxproj
git commit -m "feat: add optimize and plan mac surfaces"
```

---

### Task 5: Phase 5 Machine Smoke, Reconciliation, and PROJECT.md

**Files:**
- Modify: `PROJECT.md`
- Optional test helper: `scripts/smoke/phase5-optimize-polish.cjs` only if repeated smoke commands are too long to keep reliable.

- [ ] **Step 1: Run full targeted backend checks**

Run:

```bash
node --test test/db-migration-015-optimize-findings.test.js test/optimize-scanner.test.js test/cli-optimize.test.js test/phase5-write-isolation.test.js test/local-api-phase5.test.js test/currency-rates.test.js test/forecast-read-model.test.js test/local-api-codeburn-parity.test.js test/session-event-codeburn-parity.test.js test/rollout-parser.test.js test/sessions-extractors.test.js
```

Record total pass count and failures.

- [ ] **Step 2: Run direct write isolation scan**

Run:

```bash
rg -n "UPDATE vibedeck_branch_usage_facts|INSERT INTO vibedeck_branch_usage_facts|DELETE FROM vibedeck_branch_usage_facts" src/lib/optimize-scanner.js src/lib/plan-config.js src/lib/currency-rates.js src/lib/forecast-read-model.js src/commands/optimize.js
```

Expected: no matches.

- [ ] **Step 3: Run dashboard checks**

Run:

```bash
npm --prefix dashboard test -- --run dashboard/src/lib/__tests__/vibedeck-api.test.ts dashboard/src/pages/OptimizePage.test.jsx dashboard/src/pages/PlanPage.test.jsx dashboard/src/pages/DashboardPage.test.jsx dashboard/src/pages/SettingsPage.test.jsx dashboard/src/App.test.jsx dashboard/src/pages/ComparePage.test.jsx dashboard/src/pages/ModelsPage.test.jsx dashboard/src/pages/YieldPage.test.jsx dashboard/src/pages/ExportPage.test.jsx
npm --prefix dashboard run build
```

Record pass count and existing chunk warnings.

- [ ] **Step 4: Run Mac build**

Run:

```bash
xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -destination 'platform=macOS' build
```

Record result and any existing warnings separately from new errors.

- [ ] **Step 5: Run copied-live smoke**

Copy the live DB to a temp location and call endpoints without mutating the live DB:

```bash
TMPDIR=$(mktemp -d)
cp "$HOME/.vibedeck/usage.db" "$TMPDIR/usage.db"
VIBEDECK_DB_PATH="$TMPDIR/usage.db" VIBEDECK_PLAN=cursor-pro VIBEDECK_PLAN_MONTHLY_USD=20 node - <<'NODE'
const { ensureSchema } = require('./src/lib/db');
const { runOptimizeScan, readOptimizeFindings } = require('./src/lib/optimize-scanner');
const { readPlanConfig } = require('./src/lib/plan-config');
const { buildForecastPayload } = require('./src/lib/forecast-read-model');
const { readCodeburnFactRows } = require('./src/lib/codeburn-parity');
const dbPath = process.env.VIBEDECK_DB_PATH;
ensureSchema(dbPath);
const scan = runOptimizeScan({ dbPath });
const findings = readOptimizeFindings({ dbPath, limit: 20 });
const plan = readPlanConfig({ env: process.env });
const rows = readCodeburnFactRows(dbPath, {});
const forecast = buildForecastPayload(rows);
console.log(JSON.stringify({ scan, findingCount: findings.findings.length, plan, forecast, rowCount: rows.length }, null, 2));
NODE
```

Record:

- scan duration
- findings inserted
- health grade
- branch fact count before/after
- Unknown and Historical unknown counts before/after, if available from branch facts
- plan label text
- forecast response fields

- [ ] **Step 6: Run isolated rebuild smoke**

Run the same isolated rebuild smoke command used in Phases 3 and 4. Record:

- sync/rebuild duration
- sessions/events/branch facts counts
- Unknown branch count
- Historical unknown count
- providers represented
- doctor summary

- [ ] **Step 7: Browser smoke for new pages**

Start local dashboard against the copied DB or existing dev server. Use Browser/Playwright to open:

- `/optimize`
- `/plan`
- `/settings`
- `/dashboard`

Assert headings render and console has zero new errors. Record screenshots only if already part of the project smoke convention; do not add throwaway screenshots to git.

- [ ] **Step 8: Update PROJECT.md**

Append a Phase 5 block under Release 0.1.4 with:

- Spec path: `docs/superpowers/specs/2026-05-19-provider-umbrella-expansion-phases.md`
- Plan path: `docs/superpowers/plans/2026-05-23-phase-5-optimize-subscription-polish.md`
- Branch: `agent/phase-5-optimize-subscription-polish`
- What changed in plain English.
- Real smoke numbers from Steps 1-7.
- Explicit safety statement: optimizer estimates are isolated; `cost_usd`, `/dashboard`, `/usage`, `/branches`, Unknown, and Historical unknown were preserved in smoke.
- Deferred concerns for any warnings, such as existing dashboard chunk size or Mac script warning.

- [ ] **Step 9: Commit smoke/docs**

Run:

```bash
git status --short
git add PROJECT.md
git commit -m "docs: record phase 5 optimize polish smoke"
```

Expected: worktree clean after commit.

---

## Final Orchestrator Audit Checklist

Run this after Task 5 reviewer returns GREEN:

```bash
git status --short
node --test test/db-migration-015-optimize-findings.test.js test/optimize-scanner.test.js test/cli-optimize.test.js test/phase5-write-isolation.test.js test/local-api-phase5.test.js test/currency-rates.test.js test/forecast-read-model.test.js test/local-api-codeburn-parity.test.js test/session-event-codeburn-parity.test.js
npm --prefix dashboard run build
xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -destination 'platform=macOS' build
rg -n "UPDATE vibedeck_branch_usage_facts|INSERT INTO vibedeck_branch_usage_facts|DELETE FROM vibedeck_branch_usage_facts" src/lib/optimize-scanner.js src/lib/plan-config.js src/lib/currency-rates.js src/lib/forecast-read-model.js src/commands/optimize.js
```

Expected:

- Worktree clean.
- All targeted backend tests pass.
- Dashboard build passes.
- Mac build passes or only known non-fatal EmbeddedServer warning remains.
- Direct write scan has no matches in Phase 5 write/read modules.
- `PROJECT.md` contains copied-live and isolated rebuild smoke numbers.
- No new source writes optimizer estimates into `vibedeck_branch_usage_facts`.
- `/dashboard`, `/usage`, `/branches`, branch drawers, Unknown branch, and Historical unknown are unchanged except for additive hints/banners.

## Self-Review

**Spec coverage:** Phase 5 backend migration/scanner/schedule/health grade are Task 1. Plan config, currency, forecast/trend/pulse endpoints are Task 2. Dashboard Optimize/Plan/currency/banner/reading hints are Task 3. Mac Optimize/Plan/currency/forecast polish is Task 4. Reconciliation, live-machine smoke, and PROJECT.md are Task 5.

**Placeholder scan:** The plan avoids open-ended placeholder terms. Each task names exact files, commands, visible text, and acceptance assertions.

**Type consistency:** Backend endpoints and dashboard/Mac clients use the same route names: `vibedeck-optimize/findings`, `vibedeck-plan`, `vibedeck-currency-rates`, and `vibedeck-forecast`. Plan label fields use `label` and `label_detail` in JSON, decoded as `label` and `labelDetail` in Swift.
