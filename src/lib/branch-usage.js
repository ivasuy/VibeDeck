'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

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
            COALESCE(w.prorated_cost_usd, 0) AS total_cost_usd
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
            COALESCE(s.total_cost_usd, 0) AS total_cost_usd
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
    const totals = { total_tokens: 0, total_cost_usd: 0, session_count: 0 };

    for (const row of rows) {
      totals.total_tokens += Number(row.total_tokens || 0);
      totals.total_cost_usd += Number(row.total_cost_usd || 0);
      totals.session_count += 1;

      if (!repos.has(row.repo_root)) repos.set(row.repo_root, new Map());
      const branches = repos.get(row.repo_root);

      if (!branches.has(row.branch)) {
        branches.set(row.branch, {
          branch: row.branch,
          total_tokens: 0,
          total_cost_usd: 0,
          session_count: 0,
          last_seen_at: row.started_at,
          confidence: confidenceShape(),
          sessions: includeSessions ? [] : undefined,
        });
      }

      const entry = branches.get(row.branch);
      entry.total_tokens += Number(row.total_tokens || 0);
      entry.total_cost_usd += Number(row.total_cost_usd || 0);
      entry.session_count += 1;
      if (String(row.started_at || '') > String(entry.last_seen_at || '')) {
        entry.last_seen_at = row.started_at;
      }
      entry.confidence[normalizeConfidence(row.confidence)] += 1;

      if (includeSessions) {
        entry.sessions.push({
          provider: row.provider,
          session_id: row.session_id,
          started_at: row.started_at,
          ended_at: row.ended_at,
          model: row.model,
          total_tokens: row.total_tokens,
          total_cost_usd: row.total_cost_usd,
          confidence: row.confidence,
          branch_resolution_tier: row.branch_resolution_tier,
        });
      }
    }

    return {
      repos: Array.from(repos.entries()).map(([repo_root, branches]) => ({
        repo_root,
        branches: Array.from(branches.values()).sort((a, b) => b.total_tokens - a.total_tokens),
      })),
      totals,
    };
  } finally {
    db.close();
  }
}

module.exports = { queryBranchUsage };
