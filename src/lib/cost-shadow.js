"use strict";

const { computeRowCost, computeEnhancedRowCost } = require("./pricing");

function toNumberOrNull(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function costDiffForRow(row = {}) {
  const current = computeRowCost(row);
  const enhanced = computeEnhancedRowCost(row);
  const currentCost = Number.isFinite(current) ? current : null;
  const enhancedCost = Number.isFinite(enhanced) ? enhanced : null;
  const delta = currentCost != null && enhancedCost != null ? enhancedCost - currentCost : null;
  const deltaRatio = currentCost && delta != null ? delta / currentCost : null;

  return {
    provider: row.provider || row.source || "unknown",
    session_id: row.session_id || null,
    model: row.model || null,
    current_cost_usd: currentCost,
    enhanced_cost_usd: enhancedCost,
    delta_usd: delta,
    delta_ratio: deltaRatio,
  };
}

function summarizeCostDiffs(rows = []) {
  const diffs = rows.map(costDiffForRow);
  let currentTotal = 0;
  let enhancedTotal = 0;
  let unknownCount = 0;

  for (const diff of diffs) {
    if (toNumberOrNull(diff.current_cost_usd) == null || toNumberOrNull(diff.enhanced_cost_usd) == null) {
      unknownCount += 1;
      continue;
    }
    currentTotal += diff.current_cost_usd;
    enhancedTotal += diff.enhanced_cost_usd;
  }

  return {
    row_count: diffs.length,
    unknown_count: unknownCount,
    current_total_cost_usd: currentTotal,
    enhanced_total_cost_usd: enhancedTotal,
    delta_usd: enhancedTotal - currentTotal,
    delta_ratio: currentTotal ? (enhancedTotal - currentTotal) / currentTotal : null,
    rows: diffs,
  };
}

module.exports = {
  costDiffForRow,
  summarizeCostDiffs,
};
