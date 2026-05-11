'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');

function emptyResult() {
  return {
    repos: [],
    totals: {
      total_tokens: 0,
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
    },
  };
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

function repoRootExists(repoRoot) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) return false;
  try {
    return fs.statSync(repoRoot.trim()).isDirectory();
  } catch {
    return false;
  }
}

function listGitBranches(repoRoot) {
  if (!repoRootExists(repoRoot)) return [];
  try {
    const out = execFileSync('git', ['-C', repoRoot, 'branch', '--format=%(refname:short)'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return Array.from(
      new Set(
        String(out || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function attributionBranchName(value) {
  return String(value || '').replace(/~\d+$/, '');
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

    const requestedLimit = clampLimit(limit);
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
            w.prorated_cost_usd AS total_cost_usd,
            s.total_cost_usd AS session_total_cost_usd
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
            s.total_cost_usd AS total_cost_usd,
            s.total_cost_usd AS session_total_cost_usd
          FROM vibedeck_sessions s
          WHERE NOT EXISTS (
            SELECT 1 FROM vibedeck_session_branch_windows w
            WHERE w.provider = s.provider AND w.session_id = s.session_id
          )
        )
        SELECT * FROM source_rows
        ${where}
        ORDER BY started_at DESC
      `,
      )
      .all(params)
      .filter((row) => repoRootExists(row.repo_root));

    const repos = new Map();
    const totalsCost = createCostAccumulator();
    const totals = {
      total_tokens: 0,
      total_cost_usd: 0,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
    };

    for (const row of rows) {
      const storedCostUsd = toFiniteNumber(row.total_cost_usd);
      const sessionStoredCostUsd = toFiniteNumber(row.session_total_cost_usd);
      const resolvedCost = resolveUsageCost({
        source: row.provider,
        model: row.model,
        total_tokens: row.total_tokens,
        total_cost_usd: row.total_cost_usd,
        stored_cost_is_authoritative:
          !(storedCostUsd === 0 && sessionStoredCostUsd == null && Number(row.total_tokens || 0) > 0),
      });

      totals.total_tokens += Number(row.total_tokens || 0);
      totals.session_count += 1;
      addCostToAccumulator(totalsCost, resolvedCost);

      if (!repos.has(row.repo_root)) repos.set(row.repo_root, new Map());
      const branches = repos.get(row.repo_root);

      if (!branches.has(row.branch)) {
        branches.set(row.branch, {
          branch: row.branch,
          attribution_branch: attributionBranchName(row.branch),
          total_tokens: 0,
          total_cost_usd: null,
          cost_estimated: false,
          cost_quality: 'zero_tokens',
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
      addCostToAccumulator(entry._cost, resolvedCost);
      if (String(row.started_at || '') > String(entry.last_seen_at || '')) {
        entry.last_seen_at = row.started_at;
      }
      entry.confidence[normalizeConfidence(row.confidence)] += 1;

      if (!entry.models.has(row.model || 'unknown')) {
        entry.models.set(row.model || 'unknown', {
          model: row.model || 'unknown',
          total_tokens: 0,
          total_cost_usd: null,
          cost_estimated: false,
          cost_quality: 'zero_tokens',
          session_count: 0,
          _cost: createCostAccumulator(),
        });
      }
      const modelEntry = entry.models.get(row.model || 'unknown');
      modelEntry.total_tokens += Number(row.total_tokens || 0);
      modelEntry.session_count += 1;
      addCostToAccumulator(modelEntry._cost, resolvedCost);

      if (includeSessions) {
        entry.sessions.push({
          provider: row.provider,
          session_id: row.session_id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          model: row.model,
          total_tokens: row.total_tokens,
          total_cost_usd: resolvedCost.total_cost_usd,
          cost_estimated: resolvedCost.cost_estimated,
          cost_quality: resolvedCost.cost_quality,
          confidence: row.confidence,
          branch_resolution_tier: row.branch_resolution_tier,
        });
      }
    }

    Object.assign(totals, finalizeCostAccumulator(totalsCost));

    return {
      repos: Array.from(repos.entries()).map(([repo_root, branches]) => {
        const gitBranches = listGitBranches(repo_root);
        return {
          repo_root,
          git_branches: gitBranches,
          git_branch_count: gitBranches.length,
          branches: Array.from(branches.values())
            .map((branchEntry) => {
            const branchCost = finalizeCostAccumulator(branchEntry._cost);
            return {
              ...branchEntry,
              total_cost_usd: branchCost.total_cost_usd,
              cost_estimated: branchCost.cost_estimated,
              cost_quality: branchCost.cost_quality,
              models: Array.from(branchEntry.models.values())
                .map((modelEntry) => {
                  const modelCost = finalizeCostAccumulator(modelEntry._cost);
                  return {
                    model: modelEntry.model,
                    total_tokens: modelEntry.total_tokens,
                    total_cost_usd: modelCost.total_cost_usd,
                    cost_estimated: modelCost.cost_estimated,
                    cost_quality: modelCost.cost_quality,
                    session_count: modelEntry.session_count,
                  };
                })
                .sort((a, b) => b.total_tokens - a.total_tokens),
            };
            })
            .map(({ _cost, ...branchEntry }) => branchEntry)
            .sort((a, b) => b.total_tokens - a.total_tokens)
            .slice(0, requestedLimit),
        };
      }),
      totals,
    };
  } finally {
    db.close();
  }
}

module.exports = { queryBranchUsage };
