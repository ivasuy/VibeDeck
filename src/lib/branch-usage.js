'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const {
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');
const { readBranchUsageFactRows } = require('./sessions/branch-usage-facts');

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

function toBooleanFlag(value) {
  return value === true || value === 1 || value === '1';
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

function factCost(row) {
  const totalCostUsd = toFiniteNumber(row?.total_cost_usd);
  return {
    total_cost_usd: totalCostUsd,
    cost_estimated: toBooleanFlag(row?.cost_estimated),
    cost_quality:
      typeof row?.cost_quality === 'string' && row.cost_quality.trim()
        ? row.cost_quality.trim()
        : totalCostUsd == null
          ? 'partial_unknown'
          : 'mixed_known',
  };
}

function projectRef(row) {
  return row?.project_ref || row?.repo_root || row?.cwd || null;
}

function projectKey(row) {
  if (typeof row?.project_key === 'string' && row.project_key.trim()) return row.project_key.trim();
  const ref = projectRef(row);
  if (typeof ref !== 'string' || !ref.trim()) return 'unknown';
  return ref.split(/[\\/]+/).filter(Boolean).pop() || ref;
}

function repoGroupKey(row) {
  if (typeof row?.scope_key === 'string' && row.scope_key.trim()) return row.scope_key.trim();
  return [row?.project_state || 'unknown', projectRef(row) || '', row?.repo_root || '', row?.cwd || ''].join('\u241f');
}

function queryBranchUsage(
  dbPath,
  {
    from = null,
    to = null,
    repo = null,
    branch = null,
    limit = 100,
    includeSessions = false,
    sourceFilter = null,
    includeArchived = false,
    includeUnattributed = false,
  } = {},
) {
  if (!fs.existsSync(dbPath)) return emptyResult();

  const requestedLimit = clampLimit(limit);
  const rows = readBranchUsageFactRows(dbPath, {
    from,
    to,
    repo,
    branch,
    limit: requestedLimit,
    sourceFilter,
    includeArchived,
    includeUnattributed,
  });

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
    const rowCost = factCost(row);
    const rowTokens = Number(row.total_tokens || 0);
    const rowLastSeen = row.last_observed_at || row.first_observed_at || null;
    const repoKey = repoGroupKey(row);

    totals.total_tokens += rowTokens;
    totals.session_count += 1;
    addCostToAccumulator(totalsCost, rowCost);

    if (!repos.has(repoKey)) {
      repos.set(repoKey, {
        repo_root: row.repo_root || null,
        project_state: row.project_state || null,
        project_key: projectKey(row),
        project_ref: projectRef(row),
        branches: new Map(),
      });
    }

    const repoEntry = repos.get(repoKey);
    const branchName = row.branch || 'unattributed';
    const branchKind = row.branch_kind || 'unknown';
    const branchKey = `${branchName}\u241f${branchKind}`;

    if (!repoEntry.branches.has(branchKey)) {
      repoEntry.branches.set(branchKey, {
        branch: branchName,
        attribution_branch: row.attribution_branch || attributionBranchName(branchName),
        branch_kind: branchKind,
        total_tokens: 0,
        total_cost_usd: null,
        cost_estimated: false,
        cost_quality: 'zero_tokens',
        session_count: 0,
        last_seen_at: rowLastSeen,
        confidence: confidenceShape(),
        models: new Map(),
        _cost: createCostAccumulator(),
        sessions: includeSessions ? [] : undefined,
      });
    }

    const branchEntry = repoEntry.branches.get(branchKey);
    branchEntry.total_tokens += rowTokens;
    branchEntry.session_count += 1;
    addCostToAccumulator(branchEntry._cost, rowCost);
    if (String(rowLastSeen || '') > String(branchEntry.last_seen_at || '')) {
      branchEntry.last_seen_at = rowLastSeen;
    }
    branchEntry.confidence[normalizeConfidence(row.confidence)] += 1;

    const modelName = row.model || 'unknown';
    if (!branchEntry.models.has(modelName)) {
      branchEntry.models.set(modelName, {
        model: modelName,
        total_tokens: 0,
        total_cost_usd: null,
        cost_estimated: false,
        cost_quality: 'zero_tokens',
        session_count: 0,
        _cost: createCostAccumulator(),
      });
    }

    const modelEntry = branchEntry.models.get(modelName);
    modelEntry.total_tokens += rowTokens;
    modelEntry.session_count += 1;
    addCostToAccumulator(modelEntry._cost, rowCost);

    if (includeSessions) {
      branchEntry.sessions.push({
        provider: row.provider,
        session_id: row.session_id,
        started_at: row.first_observed_at,
        ended_at: row.last_observed_at,
        model: row.model,
        total_tokens: row.total_tokens,
        total_cost_usd: rowCost.total_cost_usd,
        cost_estimated: rowCost.cost_estimated,
        cost_quality: rowCost.cost_quality,
        confidence: row.confidence,
        branch_resolution_tier: row.branch_resolution_tier,
      });
    }
  }

  Object.assign(totals, finalizeCostAccumulator(totalsCost));

  return {
    repos: Array.from(repos.values()).map((repoEntry) => {
      const gitBranches =
        repoEntry.project_state === 'git_existing' && repoRootExists(repoEntry.repo_root)
          ? listGitBranches(repoEntry.repo_root)
          : [];
      return {
        repo_root: repoEntry.repo_root,
        project_state: repoEntry.project_state,
        project_key: repoEntry.project_key,
        project_ref: repoEntry.project_ref,
        git_branches: gitBranches,
        git_branch_count: gitBranches.length,
        branches: Array.from(repoEntry.branches.values())
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
}

module.exports = { queryBranchUsage };
