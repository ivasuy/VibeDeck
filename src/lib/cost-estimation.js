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
    return {
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "zero_tokens",
    };
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
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "pricing_missing",
    };
  }

  const pricing = lookupModelPricing(row.model);
  if (!pricing.hit) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "pricing_missing",
    };
  }

  const rate = pickFallbackRate(pricing.value);
  if (rate == null) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "pricing_missing",
    };
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
    return {
      total_cost_usd: stored,
      cost_estimated: false,
      cost_quality: "stored",
    };
  }

  if (totalTokens === 0) {
    return {
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "zero_tokens",
    };
  }

  if (stored === 0 && storedAuthoritative && totalTokens == null) {
    return {
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "stored",
    };
  }

  return estimateUsageCost(row);
}

function createCostAccumulator() {
  return { sum: 0, unknown: false, estimated: false };
}

function addCostToAccumulator(acc, costResult) {
  if (!acc || !costResult) return;

  if (costResult.total_cost_usd == null) {
    acc.unknown = true;
  } else {
    acc.sum += Number(costResult.total_cost_usd || 0);
  }

  if (costResult.cost_estimated) {
    acc.estimated = true;
  }
}

function finalizeCostAccumulator(acc) {
  if (!acc) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "partial_unknown",
    };
  }

  if (acc.unknown) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "partial_unknown",
    };
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
