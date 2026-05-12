'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const {
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');
const { readCanonicalCompleteness } = require('./sessions/canonical-completeness');

function readUsageRowsFromDb(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || !fs.existsSync(dbPath)) return [];
  const completeness = readCanonicalCompleteness(dbPath);
  if (!completeness.complete) return [];

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sourceRows = db
      .prepare(
        `
        SELECT
          bucket_provider AS source,
          bucket_model AS model,
          bucket_hour_start AS hour_start,
          input_tokens,
          cached_input_tokens,
          cache_creation_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          conversation_count,
          total_tokens,
          total_cost_usd,
          cost_estimated,
          cost_quality
        FROM vibedeck_session_buckets
        ORDER BY bucket_hour_start ASC
        `,
      )
      .all();
    if (!Array.isArray(sourceRows) || sourceRows.length === 0) return [];

    const grouped = new Map();
    for (const row of sourceRows) {
      const source = typeof row?.source === 'string' && row.source.trim() ? row.source.trim() : 'unknown';
      const model = typeof row?.model === 'string' && row.model.trim() ? row.model.trim() : 'unknown';
      const hourStart = typeof row?.hour_start === 'string' && row.hour_start.trim() ? row.hour_start.trim() : null;
      if (!hourStart) continue;
      const key = `${source}|${model}|${hourStart}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          source,
          model,
          hour_start: hourStart,
          input_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          conversation_count: 0,
          total_tokens: 0,
          billable_total_tokens: 0,
          _cost: createCostAccumulator(),
        });
      }
      const entry = grouped.get(key);
      entry.input_tokens += Number(row?.input_tokens || 0) || 0;
      entry.cached_input_tokens += Number(row?.cached_input_tokens || 0) || 0;
      entry.cache_creation_input_tokens += Number(row?.cache_creation_input_tokens || 0) || 0;
      entry.output_tokens += Number(row?.output_tokens || 0) || 0;
      entry.reasoning_output_tokens += Number(row?.reasoning_output_tokens || 0) || 0;
      entry.conversation_count += Number(row?.conversation_count || 0) || 0;
      entry.total_tokens += Number(row?.total_tokens || 0) || 0;
      entry.billable_total_tokens += Number(row?.total_tokens || 0) || 0;
      addCostToAccumulator(entry._cost, {
        total_cost_usd: row?.total_cost_usd == null ? null : Number(row.total_cost_usd),
        cost_estimated: Boolean(row?.cost_estimated),
        cost_quality: row?.cost_quality || null,
      });
    }

    return Array.from(grouped.values()).map((entry) => {
      const cost = finalizeCostAccumulator(entry._cost);
      return {
        source: entry.source,
        model: entry.model,
        hour_start: entry.hour_start,
        input_tokens: entry.input_tokens,
        cached_input_tokens: entry.cached_input_tokens,
        cache_creation_input_tokens: entry.cache_creation_input_tokens,
        output_tokens: entry.output_tokens,
        reasoning_output_tokens: entry.reasoning_output_tokens,
        conversation_count: entry.conversation_count,
        total_tokens: entry.total_tokens,
        billable_total_tokens: entry.billable_total_tokens,
        total_cost_usd: cost.total_cost_usd,
        cost_estimated: cost.cost_estimated,
        cost_quality: cost.cost_quality,
      };
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}

module.exports = { readUsageRowsFromDb };
