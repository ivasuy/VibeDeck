const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const pricing = require("../src/lib/pricing");
const { costDiffForRow, summarizeCostDiffs } = require("../src/lib/cost-shadow");

function tmpCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-cost-shadow-"));
  return path.join(dir, "pricing.json");
}

const FIXTURE_LITELLM = {
  "claude-opus-4-7": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
};

async function loadFixturePricing() {
  pricing.resetPricingForTests();
  await pricing.ensurePricingLoaded({
    cachePath: tmpCachePath(),
    fetchImpl: async () => FIXTURE_LITELLM,
  });
}

test("costDiffForRow returns current and enhanced row costs", async () => {
  await loadFixturePricing();
  const diff = costDiffForRow({
    provider: "claude",
    source: "claude",
    session_id: "session-1",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
  });

  assert.equal(diff.provider, "claude");
  assert.equal(diff.session_id, "session-1");
  assert.equal(diff.model, "claude-opus-4-7");
  assert.ok(Math.abs(diff.current_cost_usd - 0.11175) < 1e-9);
  assert.ok(Math.abs(diff.enhanced_cost_usd - 0.13425) < 1e-9);
  assert.ok(Math.abs(diff.delta_usd - 0.0225) < 1e-9);
  assert.ok(Math.abs(diff.delta_ratio - 0.0225 / 0.11175) < 1e-9);
});

test("summarizeCostDiffs totals current and enhanced costs", async () => {
  await loadFixturePricing();
  const summary = summarizeCostDiffs([
    {
      source: "claude",
      model: "claude-opus-4-7",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      web_search_requests: 1,
    },
    {
      source: "claude",
      model: "claude-opus-4-7",
      input_tokens: 1_000,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      web_search_requests: 0,
    },
  ]);

  assert.equal(summary.row_count, 2);
  assert.equal(summary.unknown_count, 0);
  assert.equal(summary.current_total_cost_usd, 0.015);
  assert.equal(summary.enhanced_total_cost_usd, 0.025);
  assert.ok(Math.abs(summary.delta_usd - 0.01) < 1e-9);
  assert.ok(Math.abs(summary.delta_ratio - 0.01 / 0.015) < 1e-9);
  assert.equal(summary.rows.length, 2);
});
