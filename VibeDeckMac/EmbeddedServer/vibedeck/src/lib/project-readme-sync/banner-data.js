'use strict';

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { resolveTrackerPaths } = require('../tracker-paths');
const {
  formatCompactTokenCount,
  formatUpdatedDate,
  formatUsd,
} = require('../readme-sync/banner-data');
const { resolveUsageCost } = require('../cost-estimation');

function toFinite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toSafeDate(value) {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function resolveTopModels(rows, totalTokens) {
  const byModel = new Map();
  for (const row of rows) {
    const model = typeof row?.model === 'string' && row.model.trim() ? row.model.trim() : 'unknown';
    const value = toFinite(row?.total_tokens);
    byModel.set(model, (byModel.get(model) || 0) + value);
  }

  const entries = Array.from(byModel.entries()).sort((a, b) => b[1] - a[1]);
  return entries.slice(0, 3).map(([name, total]) => {
    const percent = totalTokens > 0 ? Math.round((total / totalTokens) * 100) : 0;
    return {
      name,
      valueLabel: formatCompactTokenCount(total),
      percentLabel: `${Math.min(100, Math.max(0, percent))}%`,
    };
  });
}

function readProjectSessionRows(dbPath, cwd) {
  if (!fs.existsSync(dbPath)) return [];

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `
        SELECT
          provider,
          model,
          total_tokens,
          input_tokens,
          output_tokens,
          cached_input_tokens,
          cache_creation_input_tokens,
          reasoning_output_tokens,
          started_at,
          ended_at,
          updated_at,
          total_cost_usd,
          cost_estimated,
          repo_root,
          cwd
        FROM vibedeck_sessions
        WHERE repo_root = ? OR cwd = ?
        ORDER BY COALESCE(updated_at, started_at) ASC
      `,
      )
      .all(cwd, cwd);
  } finally {
    db.close();
  }
}

async function buildProjectReadmeBannerData({
  home = os.homedir(),
  cwd = process.cwd(),
  now = new Date(),
} = {}) {
  const resolvedCwd = typeof cwd === 'string' && cwd.trim() ? cwd.trim() : process.cwd();
  const { trackerDir } = await resolveTrackerPaths({ home });
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const rows = readProjectSessionRows(dbPath, resolvedCwd);

  const totals = rows.reduce(
    (acc, row) => {
      const totalTokens = toFinite(row?.total_tokens);
      const inputTokens = toFinite(row?.input_tokens);
      const outputTokens = toFinite(row?.output_tokens);
  const resolvedCost = resolveUsageCost({
        source: row?.provider,
        model: row?.model,
        total_tokens: totalTokens,
        input_tokens: toFinite(row?.input_tokens),
        cached_input_tokens: toFinite(row?.cached_input_tokens),
        cache_creation_input_tokens: toFinite(row?.cache_creation_input_tokens),
        output_tokens: outputTokens,
        reasoning_output_tokens: toFinite(row?.reasoning_output_tokens),
        stored_cost_usd: row?.total_cost_usd,
        stored_cost_is_authoritative:
          row?.total_cost_usd != null && Number(row?.cost_estimated || 0) === 0,
      });

      const day = toSafeDate(row?.ended_at || row?.started_at || row?.updated_at);

      acc.totalTokens += totalTokens;
      acc.inputTokens += inputTokens;
      acc.outputTokens += outputTokens;
      acc.totalCost += resolvedCost?.total_cost_usd != null ? Number(resolvedCost.total_cost_usd) : 0;
      if (day) acc.activeDays.add(day);
      return acc;
    },
    {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalCost: 0,
      activeDays: new Set(),
    },
  );

  const resolvedNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const totalTokens = totals.totalTokens;
  const topModels = resolveTopModels(rows, totalTokens);

  return {
    projectLabel: path.basename(resolvedCwd),
    updatedDateLabel: formatUpdatedDate(resolvedNow),
    totalTokensLabel: formatCompactTokenCount(totalTokens),
    totalTokensSubLabel: `${Math.round(totalTokens).toLocaleString()} tokens total`,
    totalCostLabel: formatUsd(totals.totalCost),
    activeDaysLabel: String(totals.activeDays.size),
    inputTokensLabel: formatCompactTokenCount(totals.inputTokens),
    outputTokensLabel: formatCompactTokenCount(totals.outputTokens),
    topModels,
  };
}

module.exports = {
  buildProjectReadmeBannerData,
};
