const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const pricing = require("../src/lib/pricing");
const {
  estimateUsageCost,
  resolveUsageCost,
} = require("../src/lib/cost-estimation");

function tmpCachePath() {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "vd-cost-estimation-enriched-"),
  );
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

test("estimateUsageCost uses enhanced exact cost for Claude split cache and web search", async () => {
  await loadFixturePricing();
  const result = estimateUsageCost({
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    web_search_requests: 2,
    total_tokens: 4_500,
  });
  const expected =
    (1_000 * 15 + 2_000 * 1.5 + 1_000 * 18.75 + 2_000 * 18.75 * 1.6 + 500 * 75) /
      1_000_000 +
    0.02;

  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "token_buckets");
  assert.ok(Math.abs(result.total_cost_usd - expected) < 1e-9);
});

test("estimateUsageCost keeps legacy cache creation exact pricing when split fields are absent", async () => {
  await loadFixturePricing();
  const row = {
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 6_500,
  };
  const result = estimateUsageCost(row);

  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "token_buckets");
  assert.equal(result.total_cost_usd, pricing.computeEnhancedRowCost(row));
});

test("estimateUsageCost falls back to legacy cache creation when split fields are zero", async () => {
  await loadFixturePricing();
  const row = {
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 3_000,
  };
  const result = estimateUsageCost(row);

  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "token_buckets");
  assert.equal(result.total_cost_usd, pricing.computeEnhancedRowCost(row));
});

test("estimateUsageCost does not double count legacy cache aggregate when split fields are present", async () => {
  await loadFixturePricing();
  const result = estimateUsageCost({
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 6_000,
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
  assert.equal(result.total_cost_usd, 0.09);
});

test("resolveUsageCost preserves positive stored costs over enhanced recomputation", async () => {
  await loadFixturePricing();
  const result = resolveUsageCost({
    stored_cost_usd: 1.23,
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 500,
    web_search_requests: 2,
    total_tokens: 3_500,
  });

  assert.equal(result.total_cost_usd, 1.23);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "stored");
});

test("resolveUsageCost preserves authoritative stored zero over enhanced recomputation", async () => {
  await loadFixturePricing();
  const result = resolveUsageCost({
    stored_cost_usd: 0,
    stored_cost_is_authoritative: true,
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 500,
    web_search_requests: 2,
    total_tokens: 3_500,
  });

  assert.equal(result.total_cost_usd, 0);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "stored");
});

test("estimateUsageCost treats numeric web search requests as exact bucket input", async () => {
  await loadFixturePricing();
  const result = estimateUsageCost({
    source: "claude",
    model: "claude-opus-4-7",
    web_search_requests: 2,
    total_tokens: 2,
  });

  assert.equal(result.total_cost_usd, 0.02);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "token_buckets");
});

test("estimateUsageCost does not bill tools_json WebSearch without positive numeric web_search_requests", async () => {
  await loadFixturePricing();
  const withAbsentCount = estimateUsageCost({
    source: "claude",
    model: "claude-opus-4-7",
    tools_json: JSON.stringify({ WebSearch: 2 }),
    web_search_requests: undefined,
  });
  const withZeroCount = estimateUsageCost({
    source: "claude",
    model: "claude-opus-4-7",
    tools_json: JSON.stringify({ WebSearch: 2 }),
    web_search_requests: 0,
  });

  assert.equal(withAbsentCount.total_cost_usd, null);
  assert.equal(withAbsentCount.cost_estimated, true);
  assert.equal(withAbsentCount.cost_quality, "pricing_missing");
  assert.equal(withZeroCount.total_cost_usd, 0);
  assert.equal(withZeroCount.cost_estimated, false);
  assert.equal(withZeroCount.cost_quality, "token_buckets");
});
