const assert = require("node:assert/strict");
const { test } = require("node:test");

const { summarizeCanonicalUsageRows } = require("../src/lib/canonical-cost-summary");

test("summarizeCanonicalUsageRows aggregates known stored and token bucket costs", () => {
  const rows = [
    {
      provider: "codex",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 1.25,
      cost_quality: "stored",
    },
    {
      provider: "claude",
      model: "claude-sonnet-4-6",
      total_tokens: 50,
      total_cost_usd: 0.75,
      cost_quality: "token_buckets",
    },
  ];

  const summary = summarizeCanonicalUsageRows(rows);
  assert.equal(summary.total_tokens, 150);
  assert.equal(summary.total_cost_usd, 2);
  assert.equal(summary.known_cost_usd, 2);
  assert.equal(summary.cost_unknown_count, 0);
  assert.equal(summary.cost_quality, "mixed_known");
  assert.deepEqual(
    summary.providers.map((entry) => entry.provider),
    ["claude", "codex"],
  );
  assert.deepEqual(
    summary.models.map((entry) => entry.model),
    ["claude-sonnet-4-6", "gpt-5.5"],
  );
});

test("summarizeCanonicalUsageRows keeps unknown positive-token cost as unknown", () => {
  const rows = [
    {
      provider: "codex",
      model: "unknown-model",
      total_tokens: 100,
      total_cost_usd: null,
      cost_quality: "pricing_missing",
    },
  ];

  const summary = summarizeCanonicalUsageRows(rows);
  assert.equal(summary.total_tokens, 100);
  assert.equal(summary.total_cost_usd, null);
  assert.equal(summary.known_cost_usd, 0);
  assert.equal(summary.cost_unknown_count, 1);
  assert.equal(summary.cost_quality, "unknown");
});
