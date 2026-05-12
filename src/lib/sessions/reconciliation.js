'use strict';

const { readUsageRowsFromDb } = require('../usage-read-models');

function dayKey(iso) {
  const value = String(iso || '');
  return value.length >= 10 ? value.slice(0, 10) : 'unknown';
}

function groupRows(rows) {
  const grouped = new Map();
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
    entry.total_tokens += Number(row.total_tokens || 0) || 0;
    entry.total_cost_usd += Number(row.total_cost_usd || 0) || 0;
  }
  return grouped;
}

function compareGrouped(canonicalRows, queueRows) {
  const canonical = groupRows(canonicalRows);
  const queue = groupRows(queueRows);
  const keys = new Set([...canonical.keys(), ...queue.keys()]);
  return Array.from(keys)
    .sort()
    .map((key) => {
      const a = canonical.get(key) || {};
      const b = queue.get(key) || {};
      return {
        key,
        day: a.day || b.day,
        source: a.source || b.source,
        model: a.model || b.model,
        canonical_tokens: Number(a.total_tokens || 0),
        queue_tokens: Number(b.total_tokens || 0),
        token_delta: Number(a.total_tokens || 0) - Number(b.total_tokens || 0),
        canonical_cost_usd: Number(a.total_cost_usd || 0),
        queue_cost_usd: Number(b.total_cost_usd || 0),
        cost_delta_usd: Number(a.total_cost_usd || 0) - Number(b.total_cost_usd || 0),
      };
    });
}

function reconcileCanonicalUsage({ dbPath, queueRows }) {
  return {
    generated_at: new Date().toISOString(),
    groups: compareGrouped(readUsageRowsFromDb(dbPath), queueRows),
  };
}

module.exports = { reconcileCanonicalUsage, compareGrouped };
