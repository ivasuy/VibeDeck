const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const pricing = require("../src/lib/pricing");

function tmpCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-pricing-enriched-"));
  return path.join(dir, "pricing.json");
}

const FIXTURE_LITELLM = {
  "claude-opus-4-7": {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 75e-6,
    cache_read_input_token_cost: 1.5e-6,
    cache_creation_input_token_cost: 18.75e-6,
  },
  "gpt-5.4": {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 15e-6,
    cache_read_input_token_cost: 0.25e-6,
  },
};

async function loadFixturePricing() {
  pricing.resetPricingForTests();
  await pricing.ensurePricingLoaded({
    cachePath: tmpCachePath(),
    fetchImpl: async () => FIXTURE_LITELLM,
  });
}

test("computeEnhancedRowCost prices Claude 1-hour cache only when split exists", async () => {
  await loadFixturePricing();
  const row = {
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    cache_creation_5m_input_tokens: 1_000,
    cache_creation_1h_input_tokens: 2_000,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
  };
  const cost = pricing.computeEnhancedRowCost(row);
  const expected =
    (1_000 * 15 + 2_000 * 1.5 + 1_000 * 18.75 + 2_000 * 18.75 * 1.6 + 500 * 75) /
    1_000_000;
  assert.ok(Math.abs(cost - expected) < 1e-9, `expected ${expected}, got ${cost}`);
});

test("computeEnhancedRowCost falls back to legacy cache write when split is absent", async () => {
  await loadFixturePricing();
  const row = {
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 1_000,
    cached_input_tokens: 2_000,
    cache_creation_input_tokens: 3_000,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
  };
  assert.equal(pricing.computeEnhancedRowCost(row), pricing.computeRowCost(row));
});

test("computeEnhancedRowCost falls back to legacy cache write when split fields are zero", async () => {
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
    web_search_requests: 0,
  };
  assert.equal(pricing.computeEnhancedRowCost(row), pricing.computeRowCost(row));
});

test("computeEnhancedRowCost bills web search only from numeric request count", async () => {
  await loadFixturePricing();
  const withCount = pricing.computeEnhancedRowCost({
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: 2,
  });
  const withoutCount = pricing.computeEnhancedRowCost({
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    tools_json: JSON.stringify({ WebSearch: 2 }),
  });
  assert.equal(withCount, 0.02);
  assert.equal(withoutCount, 0);
});

test("computeEnhancedRowCost ignores non-numeric web search request counts", async () => {
  await loadFixturePricing();
  const cost = pricing.computeEnhancedRowCost({
    source: "claude",
    model: "claude-opus-4-7",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: "2",
  });
  assert.equal(cost, 0);
});

test("computeEnhancedRowCost keeps Codex cached tokens separate without double-counting reasoning", async () => {
  await loadFixturePricing();
  const row = {
    source: "codex",
    model: "gpt-5.4",
    input_tokens: 20_000,
    cached_input_tokens: 80_000,
    cache_creation_input_tokens: 0,
    output_tokens: 10_000,
    reasoning_output_tokens: 5_000,
    web_search_requests: 0,
  };
  const cost = pricing.computeEnhancedRowCost(row);
  const expected = (20_000 * 2.5 + 80_000 * 0.25 + 10_000 * 15) / 1_000_000;
  assert.ok(Math.abs(cost - expected) < 1e-9, `expected ${expected}, got ${cost}`);
});
