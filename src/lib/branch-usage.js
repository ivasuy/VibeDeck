'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { lookupModelPricing } = require('./pricing');

function emptyResult() {
  return { repos: [], totals: { total_tokens: 0, total_cost_usd: 0, session_count: 0 } };
}

function confidenceShape() {
  return { high: 0, medium: 0, low: 0, unattributed: 0 };
}

function normalizeConfidence(value) {
  return ['high', 'medium', 'low', 'unattributed'].includes(value) ? value : 'unattributed';
}

function clampLimit(limit) {
  if (limit == null || limit === '') return 100;
  const n = Number(limit);
  if (!Number.isFinite(n)) return 100;
  return Math.max(1, Math.min(500, Math.trunc(n)));
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickApproximateTokenRate(pricing) {
  if (!pricing || typeof pricing !== 'object') return null;
  const candidates = [pricing.input, pricing.output, pricing.cache_read, pricing.cache_write]
    .map((value) => toFiniteNumber(value))
    .filter((value) => value != null && value > 0);
  if (candidates.length === 0) {
    const zeroCandidate = [pricing.input, pricing.output, pricing.cache_read, pricing.cache_write]
      .map((value) => toFiniteNumber(value))
      .find((value) => value === 0);
    return zeroCandidate === 0 ? 0 : null;
  }
  return pricing.input > 0 ? pricing.input : candidates[0];
}

function resolveRowCostUsd(row) {
  const existing = toFiniteNumber(row?.total_cost_usd);
  if (existing != null) return existing;

  const totalTokens = toFiniteNumber(row?.total_tokens);
  if (totalTokens == null) return null;
  if (totalTokens === 0) return 0;

  const pricingMatch = lookupModelPricing(row?.model);
  if (!pricingMatch.hit) return null;

  const ratePerMillionTokens = pickApproximateTokenRate(pricingMatch.value);
  if (ratePerMillionTokens == null) return null;
  return (totalTokens * ratePerMillionTokens) / 1_000_000;
}

function createCostAccumulator() {
  return { sum: 0, unknown: false };
}

function addCost(accumulator, value) {
  if (value == null) {
    accumulator.unknown = true;
    return;
  }
  accumulator.sum += value;
}

function finalizeCost(accumulator) {
  return accumulator.unknown ? null : accumulator.sum;
}

function queryBranchUsage(
  dbPath,
  { from = null, to = null, repo = null, branch = null, limit = 100, includeSessions = false } = {},
) {
  if (!fs.existsSync(dbPath)) return emptyResult();

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses = ["repo_root IS NOT NULL", "repo_root <> ''"];
    const params = {};

    if (from) {
      clauses.push('started_at >= @from');
      params.from = from;
    }
    if (to) {
      clauses.push('started_at <= @to');
      params.to = to;
    }
    if (repo) {
      clauses.push('repo_root = @repo');
      params.repo = repo;
    }
    if (branch) {
      clauses.push('branch = @branch');
      params.branch = branch;
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const rows = db
      .prepare(
        `
        WITH source_rows AS (
          SELECT
            s.provider,
            s.session_id,
            w.window_start AS started_at,
            w.window_end AS ended_at,
            s.repo_root,
            COALESCE(w.branch, 'unattributed') AS branch,
            s.branch_resolution_tier,
            s.confidence,
            s.model,
            COALESCE(w.prorated_tokens, 0) AS total_tokens,
            w.prorated_cost_usd AS total_cost_usd
          FROM vibedeck_session_branch_windows w
          JOIN vibedeck_sessions s
            ON s.provider = w.provider AND s.session_id = w.session_id

          UNION ALL

          SELECT
            s.provider,
            s.session_id,
            s.started_at,
            s.ended_at,
            s.repo_root,
            COALESCE(s.branch, 'unattributed') AS branch,
            s.branch_resolution_tier,
            s.confidence,
            s.model,
            COALESCE(s.total_tokens, 0) AS total_tokens,
            s.total_cost_usd AS total_cost_usd
          FROM vibedeck_sessions s
          WHERE NOT EXISTS (
            SELECT 1 FROM vibedeck_session_branch_windows w
            WHERE w.provider = s.provider AND w.session_id = s.session_id
          )
        )
        SELECT * FROM source_rows
        ${where}
        ORDER BY started_at DESC
        LIMIT @limit
      `,
      )
      .all({ ...params, limit: clampLimit(limit) });

    const repos = new Map();
    const totalsCost = createCostAccumulator();
    const totals = { total_tokens: 0, total_cost_usd: 0, session_count: 0 };

    for (const row of rows) {
      const resolvedCostUsd = resolveRowCostUsd(row);

      totals.total_tokens += Number(row.total_tokens || 0);
      totals.session_count += 1;
      addCost(totalsCost, resolvedCostUsd);

      if (!repos.has(row.repo_root)) repos.set(row.repo_root, new Map());
      const branches = repos.get(row.repo_root);

      if (!branches.has(row.branch)) {
        branches.set(row.branch, {
          branch: row.branch,
          total_tokens: 0,
          total_cost_usd: null,
          session_count: 0,
          last_seen_at: row.started_at,
          confidence: confidenceShape(),
          models: new Map(),
          _cost: createCostAccumulator(),
          sessions: includeSessions ? [] : undefined,
        });
      }

      const entry = branches.get(row.branch);
      entry.total_tokens += Number(row.total_tokens || 0);
      entry.session_count += 1;
      addCost(entry._cost, resolvedCostUsd);
      if (String(row.started_at || '') > String(entry.last_seen_at || '')) {
        entry.last_seen_at = row.started_at;
      }
      entry.confidence[normalizeConfidence(row.confidence)] += 1;

      if (!entry.models.has(row.model || 'unknown')) {
        entry.models.set(row.model || 'unknown', {
          model: row.model || 'unknown',
          total_tokens: 0,
          total_cost_usd: null,
          session_count: 0,
          _cost: createCostAccumulator(),
        });
      }
      const modelEntry = entry.models.get(row.model || 'unknown');
      modelEntry.total_tokens += Number(row.total_tokens || 0);
      modelEntry.session_count += 1;
      addCost(modelEntry._cost, resolvedCostUsd);

      if (includeSessions) {
        entry.sessions.push({
          provider: row.provider,
          session_id: row.session_id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          model: row.model,
          total_tokens: row.total_tokens,
          total_cost_usd: resolvedCostUsd,
          confidence: row.confidence,
          branch_resolution_tier: row.branch_resolution_tier,
        });
      }
    }

    totals.total_cost_usd = finalizeCost(totalsCost);

    return {
      repos: Array.from(repos.entries()).map(([repo_root, branches]) => ({
        repo_root,
        branches: Array.from(branches.values())
          .map((branchEntry) => ({
            ...branchEntry,
            total_cost_usd: finalizeCost(branchEntry._cost),
            models: Array.from(branchEntry.models.values())
              .map((modelEntry) => ({
                model: modelEntry.model,
                total_tokens: modelEntry.total_tokens,
                total_cost_usd: finalizeCost(modelEntry._cost),
                session_count: modelEntry.session_count,
              }))
              .sort((a, b) => b.total_tokens - a.total_tokens),
          }))
          .map(({ _cost, ...branchEntry }) => branchEntry)
          .sort((a, b) => b.total_tokens - a.total_tokens),
      })),
      totals,
    };
  } finally {
    db.close();
  }
}

module.exports = { queryBranchUsage };
