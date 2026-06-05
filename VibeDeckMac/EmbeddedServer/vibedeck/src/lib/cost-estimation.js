"use strict";

const { computeEnhancedRowCost, lookupModelPricing } = require("./pricing");

const TOKEN_BUCKET_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "cache_creation_input_tokens",
  "cache_creation_5m_input_tokens",
  "cache_creation_1h_input_tokens",
  "reasoning_output_tokens",
];

const NON_CACHE_TOKEN_BUCKET_FIELDS = [
  "input_tokens",
  "output_tokens",
  "cached_input_tokens",
  "reasoning_output_tokens",
];

function toFiniteNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFiniteNumericField(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function hasTokenBuckets(row) {
  return (
    TOKEN_BUCKET_FIELDS.some((key) => toFiniteNumber(row?.[key]) != null) ||
    toFiniteNumericField(row?.web_search_requests) != null
  );
}

function sumTokenBuckets(row) {
  const tokenTotal = NON_CACHE_TOKEN_BUCKET_FIELDS.reduce(
    (sum, key) => sum + (toFiniteNumber(row?.[key]) || 0),
    0,
  );
  const cacheCreation5m = toFiniteNumber(row?.cache_creation_5m_input_tokens) || 0;
  const cacheCreation1h = toFiniteNumber(row?.cache_creation_1h_input_tokens) || 0;
  const cacheCreationTotal =
    cacheCreation5m > 0 || cacheCreation1h > 0
      ? cacheCreation5m + cacheCreation1h
      : toFiniteNumber(row?.cache_creation_input_tokens) || 0;
  const webSearchRequests = toFiniteNumericField(row?.web_search_requests);
  const webSearchBucketTotal =
    webSearchRequests != null && webSearchRequests > 0 ? webSearchRequests : 0;
  return tokenTotal + cacheCreationTotal + webSearchBucketTotal;
}

function pickFallbackRate(pricing) {
  if (!pricing || typeof pricing !== "object") return null;

  const input = toFiniteNumber(pricing.input);
  if (input != null && input > 0) return input;

  for (const key of ["output", "cache_read", "cache_write"]) {
    const value = toFiniteNumber(pricing[key]);
    if (value != null && value > 0) return value;
  }

  return null;
}

function hasExplicitZeroRate(pricing) {
  if (!pricing || typeof pricing !== "object") return false;
  return ["input", "output", "cache_read", "cache_write"].some(
    (key) => toFiniteNumber(pricing[key]) === 0,
  );
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
    const bucketTotal = sumTokenBuckets(row);
    const canUseBucketExact = totalTokens == null || totalTokens <= bucketTotal;
    if (canUseBucketExact) {
      const cost = computeEnhancedRowCost(row);
      return {
        total_cost_usd: Number.isFinite(cost) ? cost : null,
        cost_estimated: false,
        cost_quality: Number.isFinite(cost) ? "token_buckets" : "pricing_missing",
      };
    }
  }

  if (totalTokens == null) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "pricing_missing",
    };
  }

  const pricing = process.env.NODE_ENV === "test" && row.__private_test_pricing
    ? { hit: true, value: row.__private_test_pricing }
    : lookupModelPricing(row.model);
  if (!pricing.hit) {
    return {
      total_cost_usd: null,
      cost_estimated: true,
      cost_quality: "pricing_missing",
    };
  }

  const rate = pickFallbackRate(pricing.value);
  if (rate == null) {
    if (hasExplicitZeroRate(pricing.value)) {
      return {
        total_cost_usd: 0,
        cost_estimated: false,
        cost_quality: "free_pricing",
      };
    }
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
  const storedAuthoritative = row.stored_cost_is_authoritative === true;

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

  if (stored === 0 && storedAuthoritative) {
    return {
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: "stored",
    };
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

  if (costResult.cost_estimated) {
    acc.estimated = true;
  }
  if (costResult.total_cost_usd != null && costResult.cost_quality) {
    acc.qualities.add(costResult.cost_quality);
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
    cost_quality:
      acc.qualities.size === 1
        ? [...acc.qualities][0]
        : acc.qualities.size > 1
          ? "mixed_known"
          : acc.estimated
            ? "estimated_total_tokens"
            : "mixed_known",
  };
}

module.exports = {
  estimateUsageCost,
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
};
