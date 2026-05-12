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

  const groups = compareGrouped(canonicalRows, queueRows);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].day, "2026-05-12");
  assert.equal(groups[0].source, "codex");
  assert.equal(groups[0].model, "gpt-5.4");
  assert.equal(groups[0].canonical_tokens, 120);
  assert.equal(groups[0].queue_tokens, 100);
  assert.equal(groups[0].token_delta, 20);
  assert.equal(groups[0].canonical_cost_usd, 0.6);
  assert.equal(groups[0].queue_cost_usd, 0.5);
  assert.ok(Math.abs(groups[0].cost_delta_usd - 0.1) < 1e-9);
});
