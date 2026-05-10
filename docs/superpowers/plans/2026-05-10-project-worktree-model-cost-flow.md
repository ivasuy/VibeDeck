# Project and Worktree Model Cost Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reliable real-time estimated cost and model/provider breakdowns to Project Usage, Live Workbench, and existing branch/worktree views without merging `/usage` and `/branches`.

**Architecture:** Treat `model + tokens` as the source of truth for estimated cost when stored `total_cost_usd` is missing or known-stale. Keep aggregate usage exact where token-type buckets exist, and clearly mark session/project/branch costs as estimated when they are derived from `total_tokens` only. Extend existing backend endpoints and existing dashboard components; do not replace the dashboard shell or major UI components.

**Tech Stack:** Node.js `node:sqlite`, local JSONL queues, Vite/React dashboard, existing `src/lib/pricing` APIs, existing OpenAI-styled dashboard component set.

---

## Current Facts and Constraints

- Pricing is available. `src/lib/pricing/index.js` resolves current models including `gpt-5.5`, `gpt-5.2`, `gpt-5.4`, `gpt-5.3-codex`, `claude-opus-4-7`, `claude-sonnet-4-6`, and suffix/fuzzy model names.
- Exact aggregate cost already works because `queue.jsonl` rows include token-type buckets: `input_tokens`, `output_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `reasoning_output_tokens`.
- `vibedeck_sessions` currently stores `provider`, `repo_root`, `branch`, `model`, `total_tokens`, and `total_cost_usd`, but not token-type buckets.
- Because sessions only have `total_tokens`, project/worktree/branch model costs from session DB are estimates unless a future migration stores token-type buckets per session or per branch window.
- `project.queue.jsonl` has project token buckets, but does not reliably include `model`, so it cannot alone produce a model breakdown.
- For this phase, do not merge `/usage` and `/branches`. `/usage` Project Usage gets project/provider/model cost breakdowns. `/branches` stays separate and keeps branch/worktree breakdowns.
- Skip Claude `/limits` for this phase. That is OAuth/rate-limit behavior, not the cost mapping flow.
- Do not touch `src/lib/rollout.js`.
- Use `rtk` for all shell commands.

## File Structure

Create:
- `src/lib/cost-estimation.js`  
  Shared cost helper for stored cost normalization, exact token-bucket cost, and total-token fallback estimates.
- `test/cost-estimation.test.js`  
  Focused unit coverage for pricing hit/miss, zero/null/stale cost handling, and estimated cost flags.
- `dashboard/src/ui/matrix-a/components/ProjectUsageBreakdown.jsx`  
  Reusable in-card provider/model breakdown for Project Usage.
- `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx`  
  UI tests for provider/model/cost/tokens rendering.

Modify:
- `src/lib/branch-usage.js`  
  Replace local approximate cost logic with shared helper. Treat old branch-window zero cost as stale when source session cost is null and tokens are positive.
- `src/lib/local-api.js`  
  Extend `/functions/vibedeck-project-usage-summary` and `/functions/vibedeck-sessions-live` response shapes with estimated costs and provider/model breakdowns.
- `dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx`  
  Show total estimated cost, top provider/model hints, and expandable provider/model breakdown inside the existing project usage panel.
- `dashboard/src/components/live/LiveSessionList.jsx`  
  Show estimated live cost when stored cost is null. Do not display `$0.00` for unknown positive-token sessions.
- `dashboard/src/components/branches/BranchUsageTable.jsx`  
  Render estimated-cost labeling when backend marks a branch/model cost as estimated.
- `dashboard/src/components/branches/BranchSessionDrawer.jsx`  
  Render estimated-cost labeling for model/session details.
- `dashboard/src/content/copy.csv` and generated copy JSON if this repo requires regenerated copy assets.
- Tests:
  - `test/local-api-project-usage-summary.test.js`
  - `test/local-api-vibedeck-branch-usage.test.js`
  - `test/local-api-vibedeck-sessions-live.test.js`
  - `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx`
  - `dashboard/src/pages/LivePage.test.jsx` or existing live component tests if more appropriate
  - `dashboard/src/pages/BranchesPage.test.jsx` only if branch display behavior changes

## API Shape Target

Project usage entry must remain backwards compatible:

```json
{
  "project_key": "VibeDeck",
  "project_ref": "/Users/vasuyadav/Downloads/Projects/VibeDeck",
  "repo_root": "/Users/vasuyadav/Downloads/Projects/VibeDeck",
  "total_tokens": "215709695",
  "billable_total_tokens": "215709695",
  "estimated_total_cost_usd": "322.123456",
  "cost_estimated": true,
  "cost_quality": "estimated_total_tokens",
  "last_seen_at": "2026-05-10T16:40:34.555Z",
  "providers": [
    {
      "provider": "codex",
      "total_tokens": "215709695",
      "estimated_total_cost_usd": "322.123456",
      "cost_estimated": true,
      "models": [
        {
          "model": "gpt-5.4",
          "total_tokens": "52806830",
          "estimated_total_cost_usd": "132.017075",
          "cost_estimated": true,
          "session_count": 26
        }
      ]
    }
  ],
  "top_models": [
    {
      "provider": "codex",
      "model": "gpt-5.4",
      "total_tokens": "52806830",
      "estimated_total_cost_usd": "132.017075",
      "cost_estimated": true
    }
  ]
}
```

Live session row additions:

```json
{
  "total_cost_usd": null,
  "estimated_total_cost_usd": 0.1572125,
  "cost_estimated": true,
  "cost_quality": "estimated_total_tokens"
}
```

Branch usage row additions:

```json
{
  "total_cost_usd": 13.5874425,
  "cost_estimated": true,
  "cost_quality": "estimated_total_tokens",
  "models": [
    {
      "model": "gpt-5.4",
      "total_tokens": 10537532,
      "total_cost_usd": 13.5874425,
      "cost_estimated": true
    }
  ]
}
```

## Cost Semantics

Use these rules consistently:

1. If stored cost is finite and positive, use it and set `cost_estimated: false`, `cost_quality: "stored"`.
2. If token count is zero, cost is `0`, `cost_estimated: false`, `cost_quality: "zero_tokens"`.
3. If stored cost is `0`, token count is positive, and the source session cost was null/unknown, treat the zero as stale and estimate from `model + total_tokens`.
4. If full token buckets are present, call existing `computeRowCost(row)` and set `cost_quality: "token_buckets"`.
5. If only `total_tokens` is present, estimate from `lookupModelPricing(model)`. Use the input price if available; otherwise use the first positive price among input/output/cache read/cache write. Set `cost_quality: "estimated_total_tokens"`.
6. If pricing lookup misses, return `null` cost and `cost_quality: "pricing_missing"`. The UI should show `—`, not `$0.00`, for positive-token unknown-cost rows.

---

## Task 1: Shared Cost Estimation Helper

**Files:**
- Create: `src/lib/cost-estimation.js`
- Create: `test/cost-estimation.test.js`

- [ ] **Step 1: Write failing unit tests**

Add `test/cost-estimation.test.js`:

```js
const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  estimateUsageCost,
  resolveUsageCost,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require("../src/lib/cost-estimation");

test("estimateUsageCost uses token buckets when available", () => {
  const result = estimateUsageCost({
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 1000,
    output_tokens: 100,
    cached_input_tokens: 500,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 50,
  });

  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "token_buckets");
  assert.ok(result.total_cost_usd > 0);
});

test("estimateUsageCost falls back to total-token estimate when buckets are absent", () => {
  const result = estimateUsageCost({
    source: "codex",
    model: "gpt-5.4",
    total_tokens: 1_000_000,
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
  assert.ok(result.total_cost_usd > 0);
});

test("resolveUsageCost preserves positive stored costs", () => {
  const result = resolveUsageCost({
    stored_cost_usd: 1.23,
    source: "codex",
    model: "gpt-5.4",
    total_tokens: 1_000_000,
  });

  assert.equal(result.total_cost_usd, 1.23);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "stored");
});

test("resolveUsageCost treats stale zero cost as estimate when tokens are positive", () => {
  const result = resolveUsageCost({
    stored_cost_usd: 0,
    stored_cost_is_authoritative: false,
    source: "codex",
    model: "gpt-5.4",
    total_tokens: 1_000_000,
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
  assert.ok(result.total_cost_usd > 0);
});

test("resolveUsageCost keeps zero for zero-token rows", () => {
  const result = resolveUsageCost({
    stored_cost_usd: 0,
    source: "gemini",
    model: "gemini-2.5-flash-lite",
    total_tokens: 0,
  });

  assert.equal(result.total_cost_usd, 0);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "zero_tokens");
});

test("resolveUsageCost returns pricing_missing for unknown positive-token model", () => {
  const result = resolveUsageCost({
    source: "unknown",
    model: "definitely-not-a-real-model",
    total_tokens: 1000,
  });

  assert.equal(result.total_cost_usd, null);
  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "pricing_missing");
});

test("cost accumulator tracks unknown costs without converting them to zero", () => {
  const acc = { sum: 0, unknown: false, estimated: false };
  addCostToAccumulator(acc, { total_cost_usd: 1, cost_estimated: false });
  addCostToAccumulator(acc, { total_cost_usd: null, cost_estimated: true });
  const final = finalizeCostAccumulator(acc);

  assert.equal(final.total_cost_usd, null);
  assert.equal(final.cost_estimated, true);
  assert.equal(final.cost_quality, "partial_unknown");
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
rtk node --test test/cost-estimation.test.js
```

Expected: FAIL because `src/lib/cost-estimation.js` does not exist.

- [ ] **Step 3: Implement shared helper**

Create `src/lib/cost-estimation.js`:

```js
"use strict";

const { computeRowCost, lookupModelPricing } = require("./pricing");

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function hasTokenBuckets(row) {
  return [
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
    "cache_creation_input_tokens",
    "reasoning_output_tokens",
  ].some((key) => toFiniteNumber(row?.[key]) != null);
}

function pickFallbackRate(pricing) {
  if (!pricing || typeof pricing !== "object") return null;
  const input = toFiniteNumber(pricing.input);
  if (input != null && input > 0) return input;
  for (const key of ["output", "cache_read", "cache_write"]) {
    const value = toFiniteNumber(pricing[key]);
    if (value != null && value > 0) return value;
  }
  const hasExplicitZero = ["input", "output", "cache_read", "cache_write"].some(
    (key) => toFiniteNumber(pricing[key]) === 0,
  );
  return hasExplicitZero ? 0 : null;
}

function estimateUsageCost(row = {}) {
  const totalTokens = toFiniteNumber(row.total_tokens);
  if (totalTokens === 0) {
    return { total_cost_usd: 0, cost_estimated: false, cost_quality: "zero_tokens" };
  }

  if (hasTokenBuckets(row)) {
    const cost = computeRowCost(row);
    return {
      total_cost_usd: Number.isFinite(cost) ? cost : null,
      cost_estimated: false,
      cost_quality: Number.isFinite(cost) ? "token_buckets" : "pricing_missing",
    };
  }

  if (totalTokens == null) {
    return { total_cost_usd: null, cost_estimated: true, cost_quality: "missing_tokens" };
  }

  const pricing = lookupModelPricing(row.model);
  if (!pricing.hit) {
    return { total_cost_usd: null, cost_estimated: true, cost_quality: "pricing_missing" };
  }

  const rate = pickFallbackRate(pricing.value);
  if (rate == null) {
    return { total_cost_usd: null, cost_estimated: true, cost_quality: "pricing_missing" };
  }

  return {
    total_cost_usd: (totalTokens * rate) / 1_000_000,
    cost_estimated: true,
    cost_quality: "estimated_total_tokens",
  };
}

function resolveUsageCost(row = {}) {
  const stored = toFiniteNumber(row.stored_cost_usd ?? row.total_cost_usd);
  const totalTokens = toFiniteNumber(row.total_tokens);
  const storedAuthoritative = row.stored_cost_is_authoritative !== false;

  if (stored != null && stored > 0) {
    return { total_cost_usd: stored, cost_estimated: false, cost_quality: "stored" };
  }
  if (totalTokens === 0) {
    return { total_cost_usd: 0, cost_estimated: false, cost_quality: "zero_tokens" };
  }
  if (stored === 0 && storedAuthoritative && totalTokens == null) {
    return { total_cost_usd: 0, cost_estimated: false, cost_quality: "stored" };
  }

  return estimateUsageCost(row);
}

function createCostAccumulator() {
  return { sum: 0, unknown: false, estimated: false, qualities: new Set() };
}

function addCostToAccumulator(acc, costResult) {
  if (!acc || !costResult) return;
  if (costResult.total_cost_usd == null) {
    acc.unknown = true;
  } else {
    acc.sum += Number(costResult.total_cost_usd || 0);
  }
  if (costResult.cost_estimated) acc.estimated = true;
  if (costResult.cost_quality) acc.qualities.add(costResult.cost_quality);
}

function finalizeCostAccumulator(acc) {
  if (!acc) return { total_cost_usd: null, cost_estimated: true, cost_quality: "missing" };
  if (acc.unknown) {
    return { total_cost_usd: null, cost_estimated: true, cost_quality: "partial_unknown" };
  }
  return {
    total_cost_usd: acc.sum,
    cost_estimated: acc.estimated,
    cost_quality: acc.estimated ? "estimated_total_tokens" : "stored",
  };
}

module.exports = {
  estimateUsageCost,
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
};
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk node --test test/cost-estimation.test.js
rtk git add src/lib/cost-estimation.js test/cost-estimation.test.js
rtk git commit -m "feat(api): add shared usage cost estimator"
```

Expected: tests pass.

---

## Task 2: Backend Project Usage Provider and Model Breakdown

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-project-usage-summary.test.js`

- [ ] **Step 1: Add failing backend tests for project model breakdown**

In `test/local-api-project-usage-summary.test.js`, add a test after the existing session-project tests:

```js
test("project usage returns provider and model cost breakdowns from session DB", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const dbPath = path.join(tmp, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, []);

    const db = new DatabaseSync(dbPath);
    try {
      ensureSchema(db);
      insertSession(db, {
        provider: "codex",
        session_id: "s1",
        started_at: "2026-05-10T10:00:00.000Z",
        ended_at: "2026-05-10T10:20:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "gpt-5.4",
        total_tokens: 1_000_000,
      });
      insertSession(db, {
        provider: "codex",
        session_id: "s2",
        started_at: "2026-05-10T11:00:00.000Z",
        ended_at: "2026-05-10T11:20:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "gpt-5.5",
        total_tokens: 2_000_000,
      });
      insertSession(db, {
        provider: "claude",
        session_id: "s3",
        started_at: "2026-05-10T12:00:00.000Z",
        ended_at: "2026-05-10T12:20:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "claude-sonnet-4-6",
        total_tokens: 500_000,
      });
    } finally {
      db.close();
    }

    const body = await callEndpoint(queuePath, "/functions/vibedeck-project-usage-summary?sort=recent");
    const entry = body.entries.find((row) => row.project_ref === "/repo/app");

    assert.ok(entry, "expected /repo/app project entry");
    assert.equal(entry.total_tokens, "3500000");
    assert.ok(Number(entry.estimated_total_cost_usd) > 0);
    assert.equal(entry.cost_estimated, true);
    assert.equal(entry.cost_quality, "estimated_total_tokens");
    assert.equal(entry.providers.length, 2);
    assert.deepEqual(
      entry.providers.map((provider) => provider.provider).sort(),
      ["claude", "codex"],
    );
    assert.deepEqual(
      entry.providers.find((provider) => provider.provider === "codex").models.map((model) => model.model).sort(),
      ["gpt-5.4", "gpt-5.5"],
    );
    assert.ok(entry.top_models.some((model) => model.model === "gpt-5.5"));
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Add failing tests for filters**

Add:

```js
test("project usage applies source and date filters to session DB breakdowns", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const dbPath = path.join(tmp, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, []);

    const db = new DatabaseSync(dbPath);
    try {
      ensureSchema(db);
      insertSession(db, {
        provider: "codex",
        session_id: "in-range",
        started_at: "2026-05-10T10:00:00.000Z",
        ended_at: "2026-05-10T10:10:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "gpt-5.4",
        total_tokens: 100,
      });
      insertSession(db, {
        provider: "claude",
        session_id: "wrong-source",
        started_at: "2026-05-10T11:00:00.000Z",
        ended_at: "2026-05-10T11:10:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "claude-sonnet-4-6",
        total_tokens: 900,
      });
      insertSession(db, {
        provider: "codex",
        session_id: "out-range",
        started_at: "2026-05-09T10:00:00.000Z",
        ended_at: "2026-05-09T10:10:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "gpt-5.5",
        total_tokens: 800,
      });
    } finally {
      db.close();
    }

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?from=2026-05-10&to=2026-05-10&source=codex",
    );

    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].total_tokens, "100");
    assert.equal(body.entries[0].providers.length, 1);
    assert.equal(body.entries[0].providers[0].provider, "codex");
    assert.equal(body.entries[0].providers[0].models[0].model, "gpt-5.4");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
rtk node --test test/local-api-project-usage-summary.test.js
```

Expected: FAIL because the endpoint does not return `providers`, `top_models`, or cost fields.

- [ ] **Step 4: Implement grouped session project usage**

In `src/lib/local-api.js`:

1. Import helper near pricing imports:

```js
const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require("./cost-estimation");
```

2. Replace `readSessionProjectUsage(dbPath)` with a filtered version:

```js
function readSessionProjectUsage(dbPath, { from = null, to = null, source = null } = {}) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses = ["repo_root IS NOT NULL", "repo_root <> ''"];
    const params = {};
    if (source) {
      clauses.push("provider = @source");
      params.source = source;
    }
    if (from) {
      clauses.push("substr(COALESCE(ended_at, updated_at, started_at), 1, 10) >= @from");
      params.from = from;
    }
    if (to) {
      clauses.push("substr(COALESCE(ended_at, updated_at, started_at), 1, 10) <= @to");
      params.to = to;
    }
    return db.prepare(`
      SELECT
        repo_root,
        provider,
        COALESCE(model, 'unknown') AS model,
        COUNT(*) AS session_count,
        SUM(COALESCE(total_tokens, 0)) AS total_tokens,
        SUM(CASE WHEN total_cost_usd IS NULL THEN 1 ELSE 0 END) AS null_cost_count,
        SUM(COALESCE(total_cost_usd, 0)) AS stored_cost_sum,
        MAX(COALESCE(ended_at, updated_at, started_at)) AS last_seen_at
      FROM vibedeck_sessions
      WHERE ${clauses.join(" AND ")}
      GROUP BY repo_root, provider, COALESCE(model, 'unknown')
    `).all(params);
  } finally {
    db.close();
  }
}
```

3. Add local aggregation helpers near `mergeProjectUsageEntry`:

```js
function ensureProjectBreakdown(map, { project_key, project_ref, repo_root, last_seen_at }) {
  const identity = projectUsageIdentity({ project_key, project_ref });
  if (!map.has(identity)) {
    map.set(identity, {
      project_key,
      project_ref,
      repo_root,
      total_tokens: 0,
      billable_total_tokens: 0,
      estimated_total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "stored",
      last_seen_at: normalizeIsoTimestamp(last_seen_at),
      providers: new Map(),
      top_models: [],
      _cost: createCostAccumulator(),
    });
  }
  return map.get(identity);
}

function addSessionProjectBreakdown(map, row, localProjectKeys) {
  const repoRoot = typeof row?.repo_root === "string" ? row.repo_root.trim() : "";
  if (!repoRoot) return;
  const projectKey = localProjectKeys.get(repoRoot) || repoRoot;
  const project = ensureProjectBreakdown(map, {
    project_key: projectKey,
    project_ref: repoRoot,
    repo_root: repoRoot,
    last_seen_at: row.last_seen_at,
  });

  const providerName = String(row.provider || "unknown");
  const modelName = String(row.model || "unknown");
  const totalTokens = Number(row.total_tokens || 0);
  const cost = resolveUsageCost({
    stored_cost_usd: Number(row.stored_cost_sum || 0),
    stored_cost_is_authoritative: Number(row.null_cost_count || 0) === 0,
    source: providerName,
    model: modelName,
    total_tokens: totalTokens,
  });

  project.total_tokens += totalTokens;
  project.billable_total_tokens += totalTokens;
  addCostToAccumulator(project._cost, cost);
  if (row.last_seen_at && (!project.last_seen_at || row.last_seen_at > project.last_seen_at)) {
    project.last_seen_at = normalizeIsoTimestamp(row.last_seen_at);
  }

  if (!project.providers.has(providerName)) {
    project.providers.set(providerName, {
      provider: providerName,
      total_tokens: 0,
      estimated_total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "stored",
      session_count: 0,
      models: new Map(),
      _cost: createCostAccumulator(),
    });
  }
  const provider = project.providers.get(providerName);
  provider.total_tokens += totalTokens;
  provider.session_count += Number(row.session_count || 0);
  addCostToAccumulator(provider._cost, cost);

  if (!provider.models.has(modelName)) {
    provider.models.set(modelName, {
      provider: providerName,
      model: modelName,
      total_tokens: 0,
      estimated_total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "stored",
      session_count: 0,
      _cost: createCostAccumulator(),
    });
  }
  const model = provider.models.get(modelName);
  model.total_tokens += totalTokens;
  model.session_count += Number(row.session_count || 0);
  addCostToAccumulator(model._cost, cost);
}

function serializeCostNumber(value) {
  return value == null ? null : Number(value).toFixed(6);
}

function serializeProjectBreakdown(entry) {
  const projectCost = finalizeCostAccumulator(entry._cost);
  const providers = Array.from(entry.providers.values()).map((provider) => {
    const providerCost = finalizeCostAccumulator(provider._cost);
    const models = Array.from(provider.models.values()).map((model) => {
      const modelCost = finalizeCostAccumulator(model._cost);
      return {
        provider: model.provider,
        model: model.model,
        total_tokens: String(model.total_tokens),
        estimated_total_cost_usd: serializeCostNumber(modelCost.total_cost_usd),
        cost_estimated: modelCost.cost_estimated,
        cost_quality: modelCost.cost_quality,
        session_count: model.session_count,
      };
    }).sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens));
    return {
      provider: provider.provider,
      total_tokens: String(provider.total_tokens),
      estimated_total_cost_usd: serializeCostNumber(providerCost.total_cost_usd),
      cost_estimated: providerCost.cost_estimated,
      cost_quality: providerCost.cost_quality,
      session_count: provider.session_count,
      models,
    };
  }).sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens));
  const topModels = providers.flatMap((provider) => provider.models)
    .sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens))
    .slice(0, 5);

  return {
    project_key: entry.project_key,
    project_ref: entry.project_ref,
    repo_root: entry.repo_root,
    total_tokens: String(entry.total_tokens),
    billable_total_tokens: String(entry.billable_total_tokens),
    estimated_total_cost_usd: serializeCostNumber(projectCost.total_cost_usd),
    cost_estimated: projectCost.cost_estimated,
    cost_quality: projectCost.cost_quality,
    last_seen_at: entry.last_seen_at,
    providers,
    top_models: topModels,
  };
}
```

4. In the project usage endpoint, call:

```js
sessionProjectRows = readSessionProjectUsage(dbPath, {
  from: url.searchParams.get("from"),
  to: url.searchParams.get("to"),
  source: url.searchParams.get("source"),
});
```

5. Replace the session row merge loop with:

```js
for (const row of sessionProjectRows) {
  addSessionProjectBreakdown(byProject, row, localProjectKeys);
}
```

6. When serializing non-empty `byProject`, branch on whether an entry has `providers`:

```js
.map((e) => e.providers instanceof Map ? serializeProjectBreakdown(e) : {
  ...e,
  total_tokens: String(e.total_tokens),
  billable_total_tokens: String(e.billable_total_tokens),
})
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk node --test test/cost-estimation.test.js test/local-api-project-usage-summary.test.js
rtk git add src/lib/local-api.js test/local-api-project-usage-summary.test.js
rtk git commit -m "feat(api): add project model cost breakdowns"
```

Expected: tests pass and legacy shape test still passes because old fields remain.

---

## Task 3: Live Workbench Estimated Costs

**Files:**
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Test: `test/local-api-vibedeck-sessions-live.test.js`
- Test: `dashboard/src/pages/LivePage.test.jsx` or nearest existing live component test

- [ ] **Step 1: Add failing SSE test**

In `test/local-api-vibedeck-sessions-live.test.js`, add:

```js
test("vibedeck-sessions-live estimates cost for open sessions with null stored cost", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-live-cost-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const dbPath = path.join(tmp, "vibedeck.sqlite3");
    await fs.promises.writeFile(queuePath, "", "utf8");

    const db = new DatabaseSync(dbPath);
    try {
      ensureSchema(db);
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, created_at, updated_at
        ) VALUES (
          'codex', 'live-cost', '2026-05-10T10:00:00.000Z', NULL, NULL,
          '/repo/app', '/repo/app', NULL, NULL,
          'main', 'C', 'low', NULL,
          'gpt-5.4', 1000000, NULL, '2026-05-10T10:00:00.000Z', '2026-05-10T10:01:00.000Z'
        )
      `).run();
    } finally {
      db.close();
    }

    const handler = createLocalApiHandler({ queuePath });
    const exchange = createSseExchange("/functions/vibedeck-sessions-live");
    await handler(exchange.req, exchange.res, new URL("http://localhost/functions/vibedeck-sessions-live"));
    const snapshot = parseFirstSseEvent(exchange);
    const row = snapshot.sessions.find((session) => session.session_id === "live-cost");

    assert.ok(row);
    assert.equal(row.total_cost_usd, null);
    assert.ok(row.estimated_total_cost_usd > 0);
    assert.equal(row.cost_estimated, true);
    assert.equal(row.cost_quality, "estimated_total_tokens");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

Use the local SSE helpers already present in that test file. If the helper names differ, adapt only the names, not the assertion semantics.

- [ ] **Step 2: Implement live row enrichment**

In `src/lib/local-api.js`, after reading sessions for `/functions/vibedeck-sessions-live`, map them:

```js
sessions = sessions.map((session) => {
  const cost = resolveUsageCost({
    stored_cost_usd: session.total_cost_usd,
    source: session.provider,
    model: session.model,
    total_tokens: session.total_tokens,
  });
  return {
    ...session,
    estimated_total_cost_usd: cost.total_cost_usd,
    cost_estimated: cost.cost_estimated,
    cost_quality: cost.cost_quality,
  };
});
```

Also apply the same enrichment before enqueueing live `session:start`, `session:update`, and `session:end` payload rows if those events pass session rows through the SSE bus.

- [ ] **Step 3: Update live UI cost rendering**

In `dashboard/src/components/live/LiveSessionList.jsx`, add:

```js
function formatLiveCost(row) {
  const value = row?.estimated_total_cost_usd ?? row?.total_cost_usd;
  if (value == null || value === "") return "—";
  const label = formatUsdCurrency(String(value));
  return row?.cost_estimated ? `${label} est.` : label;
}
```

Replace:

```jsx
<MetaItem label={copy("live.meta.cost")} value={formatUsdCurrency(String(row?.total_cost_usd ?? 0))} />
```

with:

```jsx
<MetaItem label={copy("live.meta.cost")} value={formatLiveCost(row)} />
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk node --test test/local-api-vibedeck-sessions-live.test.js
rtk npm --prefix dashboard exec vitest run src/pages/LivePage.test.jsx
rtk git add src/lib/local-api.js dashboard/src/components/live/LiveSessionList.jsx test/local-api-vibedeck-sessions-live.test.js dashboard/src/pages/LivePage.test.jsx
rtk git commit -m "fix(api): estimate live session costs"
```

Expected: live SSE test passes; dashboard live test passes or is updated to assert `est.` rendering.

---

## Task 4: Branch Usage Cost Normalization

**Files:**
- Modify: `src/lib/branch-usage.js`
- Modify: `dashboard/src/components/branches/BranchUsageTable.jsx`
- Modify: `dashboard/src/components/branches/BranchSessionDrawer.jsx`
- Test: `test/local-api-vibedeck-branch-usage.test.js`
- Test: `dashboard/src/pages/BranchesPage.test.jsx`

- [ ] **Step 1: Add failing backend branch regression**

In `test/local-api-vibedeck-branch-usage.test.js`, add:

```js
test("GET /functions/vibedeck-branch-usage treats stale zero branch-window cost as estimated when session cost is null", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-branch-cost-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const dbPath = path.join(tmp, "vibedeck.sqlite3");
    await fs.promises.writeFile(queuePath, "", "utf8");
    const db = new DatabaseSync(dbPath);
    try {
      ensureSchema(db);
      insertSession(db, {
        provider: "codex",
        session_id: "stale-zero",
        started_at: "2026-05-10T10:00:00.000Z",
        ended_at: "2026-05-10T10:30:00.000Z",
        cwd: "/repo/app",
        repo_root: "/repo/app",
        branch: "main",
        branch_resolution_tier: "C",
        confidence: "low",
        model: "gpt-5.4",
        total_tokens: 1000000,
        total_cost_usd: null,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows (
          provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd
        ) VALUES (
          'codex', 'stale-zero', 'main', '2026-05-10T10:00:00.000Z', '2026-05-10T10:30:00.000Z', 1000000, 0
        )
      `).run();
    } finally {
      db.close();
    }

    const body = await callEndpoint(queuePath, "/functions/vibedeck-branch-usage?repo=/repo/app&include_sessions=1");
    const branch = body.repos[0].branches[0];

    assert.ok(branch.total_cost_usd > 0);
    assert.equal(branch.cost_estimated, true);
    assert.equal(branch.models[0].cost_estimated, true);
    assert.ok(branch.sessions[0].total_cost_usd > 0);
    assert.equal(branch.sessions[0].cost_estimated, true);
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Replace branch-local cost logic with shared helper**

In `src/lib/branch-usage.js`:

1. Replace:

```js
const { lookupModelPricing } = require('./pricing');
```

with:

```js
const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');
```

2. Remove local `pickApproximateTokenRate`, `resolveRowCostUsd`, `createCostAccumulator`, `addCost`, and `finalizeCost`.

3. In the SQL `source_rows`, include session stored cost:

```sql
s.total_cost_usd AS session_total_cost_usd
```

4. In row loop, replace resolved cost:

```js
const resolvedCost = resolveUsageCost({
  stored_cost_usd: row.total_cost_usd,
  stored_cost_is_authoritative: !(Number(row.total_cost_usd || 0) === 0 && row.session_total_cost_usd == null),
  source: row.provider,
  model: row.model,
  total_tokens: row.total_tokens,
});
```

5. Replace all `addCost(acc, resolvedCostUsd)` with `addCostToAccumulator(acc, resolvedCost)`.

6. Replace all `finalizeCost(acc)` calls with:

```js
const finalized = finalizeCostAccumulator(acc);
```

and copy `total_cost_usd`, `cost_estimated`, and `cost_quality` onto totals, branch entries, model entries, and session rows.

- [ ] **Step 3: Update branch UI estimated label**

In `BranchUsageTable.jsx` and `BranchSessionDrawer.jsx`, replace `formatCostLabel(value)` with:

```js
function formatCostLabel(value, estimated = false) {
  if (value == null || value === "") return copy("branches.value.unknown_cost");
  const n = Number(value);
  if (!Number.isFinite(n)) return copy("branches.value.unknown_cost");
  const label = formatUsdCurrency(String(n));
  return estimated ? `${label} est.` : label;
}
```

Then pass `row?.cost_estimated`, `modelEntry?.cost_estimated`, and `session?.cost_estimated` where costs render.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
rtk node --test test/local-api-vibedeck-branch-usage.test.js test/cost-estimation.test.js
rtk npm --prefix dashboard exec vitest run src/pages/BranchesPage.test.jsx
rtk git add src/lib/branch-usage.js dashboard/src/components/branches/BranchUsageTable.jsx dashboard/src/components/branches/BranchSessionDrawer.jsx test/local-api-vibedeck-branch-usage.test.js dashboard/src/pages/BranchesPage.test.jsx
rtk git commit -m "fix(api): normalize estimated branch costs"
```

Expected: branch rows that previously showed `$0.00` for positive-token null-cost sessions now show estimated cost.

---

## Task 5: Project Usage UI Breakdown

**Files:**
- Create: `dashboard/src/ui/matrix-a/components/ProjectUsageBreakdown.jsx`
- Create: `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx`
- Modify: `dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx`
- Test: `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx`

- [ ] **Step 1: Add component test for breakdown rendering**

Create `dashboard/src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx`:

```jsx
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectUsageBreakdown } from "../ProjectUsageBreakdown.jsx";

describe("ProjectUsageBreakdown", () => {
  it("renders provider and model token/cost rows", () => {
    render(
      <ProjectUsageBreakdown
        providers={[
          {
            provider: "codex",
            total_tokens: "3000000",
            estimated_total_cost_usd: "12.500000",
            cost_estimated: true,
            models: [
              {
                model: "gpt-5.4",
                total_tokens: "1000000",
                estimated_total_cost_usd: "2.500000",
                cost_estimated: true,
              },
              {
                model: "gpt-5.5",
                total_tokens: "2000000",
                estimated_total_cost_usd: "10.000000",
                cost_estimated: true,
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("codex")).toBeTruthy();
    expect(screen.getByText("gpt-5.4")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getAllByText(/est\\./).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Create breakdown component**

Create `dashboard/src/ui/matrix-a/components/ProjectUsageBreakdown.jsx`:

```jsx
import React from "react";
import { ProviderIcon } from "./ProviderIcon.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../../../lib/format";

function costLabel(value, estimated) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const label = formatUsdCurrency(String(n));
  return estimated ? `${label} est.` : label;
}

export function ProjectUsageBreakdown({ providers = [] }) {
  const list = Array.isArray(providers) ? providers : [];
  if (list.length === 0) return null;

  return (
    <div className="mt-3 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] p-3 dark:border-oai-gray-800 dark:bg-white/[0.03]">
      <div className="space-y-3">
        {list.map((provider) => (
          <div key={String(provider?.provider || "unknown")} className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <ProviderIcon provider={provider?.provider} size={14} className="shrink-0" />
                <span className="truncate text-xs font-medium text-oai-black dark:text-white">
                  {String(provider?.provider || "unknown")}
                </span>
              </div>
              <div className="shrink-0 text-right text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                {toDisplayNumber(provider?.total_tokens ?? 0)} · {costLabel(provider?.estimated_total_cost_usd, provider?.cost_estimated)}
              </div>
            </div>
            <div className="space-y-1">
              {(Array.isArray(provider?.models) ? provider.models : []).map((model) => (
                <div
                  key={`${String(provider?.provider || "unknown")}:${String(model?.model || "unknown")}`}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded border border-oai-gray-200/70 bg-white px-2 py-1.5 text-[11px] dark:border-oai-gray-700 dark:bg-oai-gray-900"
                >
                  <span className="truncate text-oai-gray-700 dark:text-oai-gray-200">
                    {String(model?.model || "unknown")}
                  </span>
                  <span className="text-oai-gray-500 dark:text-oai-gray-400">
                    {toDisplayNumber(model?.total_tokens ?? 0)} · {costLabel(model?.estimated_total_cost_usd, model?.cost_estimated)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update Project Usage cards**

In `ProjectUsagePanel.jsx`:

1. Import:

```js
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { ProjectUsageBreakdown } from "./ProjectUsageBreakdown.jsx";
import { formatUsdCurrency } from "../../../lib/format";
```

2. Add local state:

```js
const [expandedProject, setExpandedProject] = React.useState(null);
```

3. Pass expansion props into `ProjectUsageCard`:

```jsx
<ProjectUsageCard
  key={`${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
  entry={entry}
  expanded={expandedProject === `${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
  onToggle={() => {
    const key = `${entry?.project_key || "repo"}-${entry?.project_ref || ""}`;
    setExpandedProject((current) => (current === key ? null : key));
  }}
  placeholder={placeholder}
  tokensLabel={tokensLabel}
  starsLabel={starsLabel}
  tokenFormatOptions={tokenFormatOptions}
/>
```

4. Change `ProjectUsageCard` root from `<a>` to `<div>` so clicking expands in-app instead of navigating away. Keep an external GitHub link only when `href` is a real URL:

```jsx
<div className="rounded-lg border border-oai-gray-200 p-3 transition-colors hover:border-oai-gray-300 dark:border-oai-gray-700 dark:hover:border-oai-gray-600">
  <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 text-left">
    {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-oai-gray-400" /> : <ChevronRight className="h-4 w-4 shrink-0 text-oai-gray-400" />}
    ...
  </button>
  {expanded ? <ProjectUsageBreakdown providers={entry?.providers} /> : null}
</div>
```

5. Add cost and top model labels in the card summary:

```jsx
const costRaw = entry?.estimated_total_cost_usd;
const costCompact = costRaw == null ? placeholder : `${formatUsdCurrency(String(costRaw))}${entry?.cost_estimated ? " est." : ""}`;
const topModel = Array.isArray(entry?.top_models) && entry.top_models.length > 0
  ? String(entry.top_models[0]?.model || "")
  : "";
```

Render alongside tokens:

```jsx
<span title={`${tokensLabel}: ${tokensFull}`}>{tokensCompact}</span>
<span title={`Cost: ${costCompact}`}>{costCompact}</span>
{topModel ? <span title={`Top model: ${topModel}`}>{topModel}</span> : null}
```

- [ ] **Step 4: Update tests**

In `ProjectUsagePanel.test.jsx`, add:

```jsx
it("expands a project to show provider and model cost breakdown", async () => {
  const user = userEvent.setup();
  const entry = {
    project_key: "VibeDeck",
    project_ref: "/repo/vibedeck",
    total_tokens: "3000000",
    billable_total_tokens: "3000000",
    estimated_total_cost_usd: "12.500000",
    cost_estimated: true,
    providers: [
      {
        provider: "codex",
        total_tokens: "3000000",
        estimated_total_cost_usd: "12.500000",
        cost_estimated: true,
        models: [
          { model: "gpt-5.4", total_tokens: "3000000", estimated_total_cost_usd: "12.500000", cost_estimated: true },
        ],
      },
    ],
    top_models: [{ provider: "codex", model: "gpt-5.4", total_tokens: "3000000" }],
  };

  render(<ProjectUsagePanel entries={[entry]} />);
  await user.click(screen.getByRole("button", { name: /VibeDeck/i }));

  expect(screen.getByText("codex")).toBeTruthy();
  expect(screen.getByText("gpt-5.4")).toBeTruthy();
  expect(screen.getAllByText(/est\\./).length).toBeGreaterThan(0);
});
```

If the current test setup does not import `userEvent`, add:

```js
import userEvent from "@testing-library/user-event";
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
rtk npm --prefix dashboard exec vitest run src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
rtk git add dashboard/src/ui/matrix-a/components/ProjectUsageBreakdown.jsx dashboard/src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx dashboard/src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx
rtk git commit -m "feat(dashboard): show project model cost breakdowns"
```

Expected: Project Usage remains visually in the same panel but each project can expand to show provider/model token and estimated cost details.

---

## Task 6: Copy, Formatting, and Accessibility Polish

**Files:**
- Modify: `dashboard/src/content/copy.csv`
- Modify generated copy JSON files only if existing project workflow requires it
- Test: copy and hardcode validators

- [ ] **Step 1: Add copy keys**

Add these keys to `dashboard/src/content/copy.csv` if hardcoded strings were introduced:

```csv
dashboard.projects.cost_label,ui,DashboardPage,ProjectUsagePanel,projects_cost_label,Cost,,active
dashboard.projects.top_model_label,ui,DashboardPage,ProjectUsagePanel,projects_top_model_label,Top model,,active
dashboard.projects.expand_project,ui,DashboardPage,ProjectUsagePanel,projects_expand_project,Expand {{project}},,active
dashboard.projects.collapse_project,ui,DashboardPage,ProjectUsagePanel,projects_collapse_project,Collapse {{project}},,active
dashboard.projects.estimated_suffix,ui,DashboardPage,ProjectUsagePanel,projects_estimated_suffix,est.,,active
```

Replace hardcoded `Cost`, `Top model`, and `est.` in `ProjectUsagePanel.jsx` and `ProjectUsageBreakdown.jsx` with `copy(...)` calls.

- [ ] **Step 2: Validate copy and UI hardcode**

Run:

```bash
rtk node scripts/validate-copy-registry.cjs
rtk node scripts/ops/validate-ui-hardcode.cjs
```

Expected: both exit `0`. Existing unused copy warnings are acceptable if the command exits `0`.

- [ ] **Step 3: Commit copy polish**

Run:

```bash
rtk git add dashboard/src/content/copy.csv dashboard/src/ui/matrix-a/components/ProjectUsagePanel.jsx dashboard/src/ui/matrix-a/components/ProjectUsageBreakdown.jsx
rtk git commit -m "chore(dashboard): add project cost breakdown copy"
```

---

## Task 7: Integration Verification

**Files:**
- No source changes unless tests reveal a defect in the task files above.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
rtk node --test \
  test/cost-estimation.test.js \
  test/local-api-project-usage-summary.test.js \
  test/local-api-vibedeck-branch-usage.test.js \
  test/local-api-vibedeck-sessions-live.test.js
```

Expected: all pass.

- [ ] **Step 2: Run focused dashboard tests**

Run:

```bash
rtk npm --prefix dashboard exec vitest run \
  src/ui/matrix-a/components/__tests__/ProjectUsageBreakdown.test.jsx \
  src/ui/matrix-a/components/__tests__/ProjectUsagePanel.test.jsx \
  src/pages/BranchesPage.test.jsx \
  src/pages/LivePage.test.jsx
```

Expected: all pass.

- [ ] **Step 3: Run validators**

Run:

```bash
rtk node scripts/validate-copy-registry.cjs
rtk node scripts/ops/validate-ui-hardcode.cjs
rtk node scripts/validate-architecture-guardrails.cjs
```

Expected: all exit `0`.

- [ ] **Step 4: Build dashboard**

Run:

```bash
rtk npm --prefix dashboard run build
```

Expected: build exits `0`. Existing chunk-size warning is acceptable. Existing copy warnings are acceptable only if build exits `0`.

- [ ] **Step 5: Manual local smoke check**

Run:

```bash
rtk node bin/vibedeck.js serve
```

Open:

```text
http://127.0.0.1:7690/usage
http://127.0.0.1:7690/branches
http://127.0.0.1:7690/
```

Check:
- `/usage`: Project Usage cards show tokens, estimated cost, top model, and expand to provider/model breakdown.
- `/branches`: Branch costs for positive-token `gpt-5.5`, `gpt-5.2`, `gpt-5.4`, and Claude rows do not show false `$0.00`.
- `/`: Live Workbench open sessions show estimated cost for active sessions with model and tokens.

Stop the server with `Ctrl+C`.

---

## Edge Cases Agents Must Not Miss

- Positive tokens + `total_cost_usd: null` must not render as `$0.00`.
- Positive tokens + old branch-window `prorated_cost_usd: 0` must not be treated as authoritative if the source session cost is null.
- Zero tokens should render as `$0.00`, not unknown.
- Unknown model with positive tokens should render unknown cost, not zero.
- Duplicate repo basenames must keep disambiguated project labels.
- Local repos with no git remote must remain visible in Project Usage.
- Worktrees under `.worktrees/...` must remain distinct if their `repo_root` values differ.
- Date/source filters must apply to DB-backed project breakdown rows, not only JSONL project queue rows.
- Legacy `tokentracker-project-usage-summary` alias must keep old fields so existing callers do not break.
- Dashboard must preserve light/dark/system theme behavior and existing sidebar shell.
- Claude `/limits` is intentionally out of scope for this plan.

## Caveats To Communicate In UI/Docs If Asked

- Project/worktree/branch costs are estimates when they come from `vibedeck_sessions.total_tokens`.
- Exact cost requires token-type buckets. That is already available in aggregate `queue.jsonl`, but not yet stored per session/branch window.
- The estimate is still useful and stable because pricing lookup is reliable and models are present in session rows.
- A future data-quality phase can add token-type columns to `vibedeck_sessions` or create per-session token buckets to make project/worktree/branch cost exact.

## Self-Review

- Spec coverage: project usage gets model/provider/token/cost breakdowns; live workbench gets estimated costs; branch/worktree costs stop relying on stale zero values; `/usage` and `/branches` stay separate.
- Placeholder scan: no task asks agents to “handle later” or “add tests” without explicit assertions.
- Type consistency: backend uses `estimated_total_cost_usd`, `cost_estimated`, and `cost_quality`; branch rows keep existing `total_cost_usd` and add flags; UI reads those exact fields.

