const assert = require("node:assert/strict");
const { test } = require("node:test");

const { compareGrouped } = require("../src/lib/sessions/reconciliation");

test("compareGrouped returns per-day/source/model token and cost deltas", () => {
  const canonicalRows = [
    {
      source: "codex",
      model: "gpt-5.4",
      hour_start: "2026-05-12T09:00:00.000Z",
      total_tokens: 120,
      total_cost_usd: 0.6,
    },
  ];
  const queueRows = [
    {
      source: "codex",
      model: "gpt-5.4",
      hour_start: "2026-05-12T09:00:00.000Z",
      total_tokens: 100,
      total_cost_usd: 0.5,
    },
  ];

  const result = compareGrouped(canonicalRows, queueRows);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].day, "2026-05-12");
  assert.equal(result.groups[0].source, "codex");
  assert.equal(result.groups[0].model, "gpt-5.4");
  assert.equal(result.groups[0].canonical_tokens, 120);
  assert.equal(result.groups[0].queue_tokens, 100);
  assert.equal(result.groups[0].token_delta, 20);
  assert.equal(result.groups[0].canonical_cost_usd, 0.6);
  assert.equal(result.groups[0].queue_cost_usd, 0.5);
  assert.ok(Math.abs(result.groups[0].cost_delta_usd - 0.1) < 1e-9);
});

test("compareGrouped marks queue cost unavailable when queue costs are all zero", () => {
  const result = compareGrouped(
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "codex", model: "gpt-5.5", total_tokens: 100, total_cost_usd: 1.5 }],
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "codex", model: "gpt-5.5", total_tokens: 100, total_cost_usd: 0 }],
  );

  assert.equal(result.summary.queue_cost_available, false);
  assert.equal(result.groups[0].queue_cost_usd, null);
  assert.equal(result.groups[0].cost_delta_usd, null);
  assert.equal(result.summary.canonical_cost_usd, 1.5);
  assert.equal(result.summary.queue_cost_usd, null);
  assert.equal(result.summary.cost_delta_usd, null);
});

test("compareGrouped reports top token mismatches without treating small drift as failure", () => {
  const result = compareGrouped(
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "opencode", model: "big-pickle", total_tokens: 0, total_cost_usd: 0 }],
    [{ hour_start: "2026-05-12T01:00:00.000Z", source: "opencode", model: "big-pickle", total_tokens: 31054, total_cost_usd: 0 }],
    { tokenWarnPct: 0.0001, tokenWarnAbsolute: 100000 },
  );

  assert.equal(result.summary.token_delta, -31054);
  assert.equal(result.summary.token_drift_status, "ok");
  assert.equal(result.summary.top_token_mismatches.length, 1);
});
