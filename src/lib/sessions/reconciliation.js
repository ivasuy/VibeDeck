'use strict';

const { readUsageRowsFromDb } = require('../usage-read-models');

function dayKey(iso) {
  const value = String(iso || '');
  return value.length >= 10 ? value.slice(0, 10) : 'unknown';
}

function toNumberOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function groupRows(rows, { trackQueueCostSignals = false } = {}) {
  const grouped = new Map();
  let hasQueueCostSignal = false;
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = [dayKey(row.hour_start), String(row.source || 'unknown'), String(row.model || 'unknown')].join('|');
    if (!grouped.has(key)) {
      grouped.set(key, {
        day: dayKey(row.hour_start),
        source: String(row.source || 'unknown'),
        model: String(row.model || 'unknown'),
        total_tokens: 0,
        total_cost_usd: 0,
      });
    }
    const entry = grouped.get(key);
    entry.total_tokens += toNumberOrZero(row.total_tokens);
    const rowCost = toNumberOrNull(row.total_cost_usd);
    if (rowCost !== null) {
      entry.total_cost_usd += rowCost;
      if (trackQueueCostSignals && rowCost !== 0) hasQueueCostSignal = true;
    }
  }
  return { grouped, hasQueueCostSignal };
}

function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return 0;
  if (denominator === 0) return numerator === 0 ? 0 : 1;
  return numerator / Math.abs(denominator);
}

function compareGrouped(canonicalRows, queueRows, options = {}) {
  const tokenWarnPct = Number.isFinite(Number(options.tokenWarnPct)) ? Number(options.tokenWarnPct) : 0.02;
  const tokenWarnAbsolute = Number.isFinite(Number(options.tokenWarnAbsolute)) ? Number(options.tokenWarnAbsolute) : 500;
  const canonicalResult = groupRows(canonicalRows);
  const queueResult = groupRows(queueRows, { trackQueueCostSignals: true });
  const canonical = canonicalResult.grouped;
  const queue = queueResult.grouped;
  const queueCostAvailable = queueResult.hasQueueCostSignal;
  const keys = new Set([...canonical.keys(), ...queue.keys()]);
  const groups = Array.from(keys)
    .sort()
    .map((key) => {
      const a = canonical.get(key) || {};
      const b = queue.get(key) || {};
      const canonicalCost = toNumberOrZero(a.total_cost_usd);
      const queueCost = toNumberOrZero(b.total_cost_usd);
      return {
        key,
        day: a.day || b.day,
        source: a.source || b.source,
        model: a.model || b.model,
        canonical_tokens: toNumberOrZero(a.total_tokens),
        queue_tokens: toNumberOrZero(b.total_tokens),
        token_delta: toNumberOrZero(a.total_tokens) - toNumberOrZero(b.total_tokens),
        canonical_cost_usd: canonicalCost,
        queue_cost_available: queueCostAvailable,
        queue_cost_usd: queueCostAvailable ? queueCost : null,
        cost_delta_usd: queueCostAvailable ? canonicalCost - queueCost : null,
      };
    });

  const canonicalTokens = groups.reduce((sum, row) => sum + toNumberOrZero(row.canonical_tokens), 0);
  const queueTokens = groups.reduce((sum, row) => sum + toNumberOrZero(row.queue_tokens), 0);
  const tokenDelta = canonicalTokens - queueTokens;
  const tokenDeltaPct = ratio(tokenDelta, queueTokens);
  const canonicalCostUsd = groups.reduce((sum, row) => sum + toNumberOrZero(row.canonical_cost_usd), 0);
  const queueCostUsd = queueCostAvailable
    ? groups.reduce((sum, row) => sum + toNumberOrZero(row.queue_cost_usd), 0)
    : null;
  const costDeltaUsd = queueCostAvailable ? canonicalCostUsd - queueCostUsd : null;
  const absTokenDeltaPct = Math.abs(tokenDeltaPct);
  const absTokenDelta = Math.abs(tokenDelta);
  const tokenDriftStatus = absTokenDeltaPct > tokenWarnPct && absTokenDelta > tokenWarnAbsolute ? 'warn' : 'ok';
  const topTokenMismatches = groups
    .filter((row) => toNumberOrZero(row.token_delta) !== 0)
    .map((row) => ({
      key: row.key,
      day: row.day,
      source: row.source,
      model: row.model,
      canonical_tokens: row.canonical_tokens,
      queue_tokens: row.queue_tokens,
      token_delta: row.token_delta,
      token_delta_pct: ratio(row.token_delta, row.queue_tokens),
    }))
    .sort((a, b) => Math.abs(b.token_delta) - Math.abs(a.token_delta))
    .slice(0, 5);

  const summary = {
    canonical_tokens: canonicalTokens,
    queue_tokens: queueTokens,
    token_delta: tokenDelta,
    token_delta_pct: tokenDeltaPct,
    token_drift_status: tokenDriftStatus,
    queue_cost_available: queueCostAvailable,
    canonical_cost_usd: canonicalCostUsd,
    queue_cost_usd: queueCostUsd,
    cost_delta_usd: costDeltaUsd,
    top_token_mismatches: topTokenMismatches,
  };

  return { summary, groups };
}

function reconcileCanonicalUsage({ dbPath, queueRows }) {
  const report = compareGrouped(readUsageRowsFromDb(dbPath), queueRows);
  return {
    generated_at: new Date().toISOString(),
    summary: report.summary,
    groups: report.groups,
  };
}

module.exports = { reconcileCanonicalUsage, compareGrouped };
