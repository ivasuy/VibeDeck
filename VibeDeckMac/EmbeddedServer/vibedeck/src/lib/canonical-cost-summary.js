'use strict';

function toNumberOrNull(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeKey(value) {
  const text = String(value || '').trim();
  return text || 'unknown';
}

function knownCostQuality(value) {
  const text = String(value || '').trim();
  return text || 'stored';
}

function summarizeCostQuality({ hasUnknownPositiveTokenCost, knownQualities }) {
  if (hasUnknownPositiveTokenCost) return 'unknown';
  if (knownQualities.size === 1) return knownQualities.values().next().value;
  if (knownQualities.size > 1) return 'mixed_known';
  return 'unknown';
}

function summarizeCanonicalUsageRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const providerMap = new Map();
  const modelMap = new Map();
  const knownQualities = new Set();
  let hasUnknownPositiveTokenCost = false;
  let totalTokens = 0;
  let knownCostUsd = 0;
  let costUnknownCount = 0;

  for (const row of list) {
    const provider = normalizeKey(row?.provider);
    const model = normalizeKey(row?.model);
    const tokens = toNumberOrNull(row?.total_tokens) ?? 0;
    const cost = toNumberOrNull(row?.total_cost_usd);
    const quality = cost != null ? knownCostQuality(row?.cost_quality) : normalizeKey(row?.cost_quality);
    const unknownPositiveTokenCost = tokens > 0 && cost == null;

    totalTokens += tokens;
    if (cost != null) {
      knownCostUsd += cost;
      knownQualities.add(quality);
    } else if (unknownPositiveTokenCost) {
      hasUnknownPositiveTokenCost = true;
      costUnknownCount += 1;
    }

    if (!providerMap.has(provider)) {
      providerMap.set(provider, {
        provider,
        total_tokens: 0,
        known_cost_usd: 0,
        cost_unknown_count: 0,
        session_count: 0,
        _known_qualities: new Set(),
        _has_unknown_positive_token_cost: false,
      });
    }
    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        total_tokens: 0,
        known_cost_usd: 0,
        cost_unknown_count: 0,
        session_count: 0,
        _known_qualities: new Set(),
        _has_unknown_positive_token_cost: false,
      });
    }

    const providerRow = providerMap.get(provider);
    providerRow.total_tokens += tokens;
    providerRow.session_count += 1;
    if (cost != null) {
      providerRow.known_cost_usd += cost;
      providerRow._known_qualities.add(quality);
    } else if (unknownPositiveTokenCost) {
      providerRow.cost_unknown_count += 1;
      providerRow._has_unknown_positive_token_cost = true;
    }

    const modelRow = modelMap.get(model);
    modelRow.total_tokens += tokens;
    modelRow.session_count += 1;
    if (cost != null) {
      modelRow.known_cost_usd += cost;
      modelRow._known_qualities.add(quality);
    } else if (unknownPositiveTokenCost) {
      modelRow.cost_unknown_count += 1;
      modelRow._has_unknown_positive_token_cost = true;
    }
  }

  const finalizeRow = (row, key) => ({
    [key]: row[key],
    total_tokens: row.total_tokens,
    total_cost_usd: row.cost_unknown_count > 0 ? null : row.known_cost_usd,
    known_cost_usd: row.known_cost_usd,
    cost_unknown_count: row.cost_unknown_count,
    cost_quality: summarizeCostQuality({
      hasUnknownPositiveTokenCost: row._has_unknown_positive_token_cost,
      knownQualities: row._known_qualities,
    }),
    session_count: row.session_count,
  });

  const providers = Array.from(providerMap.values())
    .map((row) => finalizeRow(row, 'provider'))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  const models = Array.from(modelMap.values())
    .map((row) => finalizeRow(row, 'model'))
    .sort((a, b) => a.model.localeCompare(b.model));

  return {
    total_tokens: totalTokens,
    total_cost_usd: costUnknownCount > 0 ? null : knownCostUsd,
    known_cost_usd: knownCostUsd,
    cost_unknown_count: costUnknownCount,
    cost_quality: summarizeCostQuality({ hasUnknownPositiveTokenCost, knownQualities }),
    providers,
    models,
    provider_breakdown: providers,
    model_breakdown: models,
    session_count: list.length,
  };
}

module.exports = {
  summarizeCanonicalUsageRows,
  toNumberOrNull,
};
