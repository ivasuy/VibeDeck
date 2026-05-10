const assert = require("node:assert/strict");
const { test } = require("node:test");

process.env.NODE_ENV = "test";

const {
  estimateUsageCost,
  resolveUsageCost,
  createCostAccumulator,
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

test("estimateUsageCost falls back to total-token estimate when partial buckets undercount total tokens", () => {
  const result = estimateUsageCost({
    source: "codex",
    model: "gpt-5.4",
    output_tokens: 100,
    total_tokens: 1_000,
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
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

test("estimateUsageCost falls back to output or cache pricing when input pricing is absent or zero", () => {
  const result = estimateUsageCost({
    model: "test-output-fallback",
    total_tokens: 2_000_000,
    __private_test_pricing: {
      input: 0,
      output: 7.5,
      cache_read: 0.25,
      cache_write: 1,
    },
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
  assert.equal(result.total_cost_usd, 15);
});

test("estimateUsageCost returns exact zero for known free pricing on positive tokens", () => {
  const result = estimateUsageCost({
    model: "kimi-k2.5-free",
    total_tokens: 1_000_000,
  });

  assert.equal(result.total_cost_usd, 0);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "free_pricing");
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

test("resolveUsageCost preserves authoritative stored zero for positive-token rows only when explicitly true", () => {
  const result = resolveUsageCost({
    stored_cost_usd: 0,
    stored_cost_is_authoritative: true,
    source: "codex",
    model: "gpt-5.4",
    total_tokens: 1_000_000,
  });

  assert.equal(result.total_cost_usd, 0);
  assert.equal(result.cost_estimated, false);
  assert.equal(result.cost_quality, "stored");
});

test("resolveUsageCost estimates when stored zero is default and pricing exists", () => {
  const result = resolveUsageCost({
    stored_cost_usd: 0,
    source: "codex",
    model: "gpt-5.4",
    total_tokens: 1_000_000,
  });

  assert.equal(result.cost_estimated, true);
  assert.equal(result.cost_quality, "estimated_total_tokens");
  assert.ok(result.total_cost_usd > 0);
});

test("resolveUsageCost treats stale zero cost as estimate when explicitly false", () => {
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
  const acc = createCostAccumulator();
  addCostToAccumulator(acc, { total_cost_usd: 1, cost_estimated: false });
  addCostToAccumulator(acc, { total_cost_usd: null, cost_estimated: true });
  const final = finalizeCostAccumulator(acc);

  assert.equal(final.total_cost_usd, null);
  assert.equal(final.cost_estimated, true);
  assert.equal(final.cost_quality, "partial_unknown");
});

test("cost accumulator preserves token_buckets provenance for exact aggregates", () => {
  const acc = createCostAccumulator();
  addCostToAccumulator(acc, {
    total_cost_usd: 1,
    cost_estimated: false,
    cost_quality: "token_buckets",
  });
  addCostToAccumulator(acc, {
    total_cost_usd: 2,
    cost_estimated: false,
    cost_quality: "token_buckets",
  });
  const final = finalizeCostAccumulator(acc);

  assert.equal(final.total_cost_usd, 3);
  assert.equal(final.cost_estimated, false);
  assert.equal(final.cost_quality, "token_buckets");
});

test("cost accumulator reports mixed_known for mixed exact qualities", () => {
  const acc = createCostAccumulator();
  addCostToAccumulator(acc, {
    total_cost_usd: 1,
    cost_estimated: false,
    cost_quality: "stored",
  });
  addCostToAccumulator(acc, {
    total_cost_usd: 0,
    cost_estimated: false,
    cost_quality: "free_pricing",
  });
  const final = finalizeCostAccumulator(acc);

  assert.equal(final.total_cost_usd, 1);
  assert.equal(final.cost_estimated, false);
  assert.equal(final.cost_quality, "mixed_known");
});
