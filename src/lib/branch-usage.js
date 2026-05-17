'use strict';

const fs = require('node:fs');
const path = require('node:path');
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

function safeRealpath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return fs.realpathSync(value.trim());
  } catch {
    return value.trim();
  }
}

function isGitProjectRoot(repoRoot) {
  if (!repoRootExists(repoRoot)) return false;
  try {
    return fs.existsSync(path.join(repoRoot, '.git'));
  } catch {
    return false;
  }
}

function isArchivedProjectState(projectState) {
  return projectState === 'git_missing' || projectState === 'cwd_missing';
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

function timestampDateKey(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  const isoDate = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function rowDateKey(row) {
  return timestampDateKey(row?.last_observed_at) || timestampDateKey(row?.first_observed_at);
}

function displayBranchIsUnknown(row) {
  const branch = String(row?.branch || '').trim();
  if (!branch) return true;
  if (['No branch', 'unattributed', 'unknown'].includes(branch)) return true;
  return row?.branch_kind !== 'known' && !row?.attribution_branch;
}

function pathParts(value) {
  return String(value || '').replace(/\\/g, '/').split('/').filter(Boolean);
}

function fromPathParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const prefix = String(process.platform) === 'win32' ? '' : '/';
  return `${prefix}${parts.join(path.sep)}`;
}

function historicalWorktreeDescriptor(row) {
  const candidates = [row?.repo_root, row?.project_ref, row?.cwd].filter((value) => typeof value === 'string' && value.trim());
  for (const candidate of candidates) {
    const parts = pathParts(candidate);
    const worktreesIndex = parts.lastIndexOf('.worktrees');
    if (worktreesIndex > 0 && worktreesIndex < parts.length - 1) {
      const parent = fromPathParts(parts.slice(0, worktreesIndex));
      const branch = parts[parts.length - 1];
      if (parent && branch) return { parent, branch };
    }

    const sddIndex = parts.lastIndexOf('.sdd');
    if (
      sddIndex > 0
      && parts[sddIndex + 1] === 'worktrees'
      && sddIndex + 2 < parts.length
    ) {
      const parent = fromPathParts(parts.slice(0, sddIndex));
      const branch = parts[parts.length - 1];
      if (parent && branch) return { parent, branch };
    }
  }
  return null;
}

function rowWithDisplayAttribution(row) {
  const descriptor = historicalWorktreeDescriptor(row);
  if (!descriptor) return row;

  const parentRoot = safeRealpath(descriptor.parent);
  const parentExists = repoRootExists(parentRoot);
  const projectState = parentExists
    ? (isGitProjectRoot(parentRoot) ? 'git_existing' : 'non_git_existing')
    : 'git_missing';
  const branch = displayBranchIsUnknown(row) ? descriptor.branch : row.branch;
  const branchKind = displayBranchIsUnknown(row) ? 'historical_worktree' : row.branch_kind;

  return {
    ...row,
    scope_key: `${projectState === 'git_existing' ? 'repo' : 'cwd'}:${parentRoot}`,
    project_state: projectState,
    project_key: path.basename(parentRoot || descriptor.parent),
    project_ref: parentRoot,
    repo_root: parentExists ? parentRoot : null,
    cwd: row.cwd,
    branch,
    attribution_branch: branchKind === 'historical_worktree' ? branch : row.attribution_branch,
    branch_kind: branchKind,
    historical_worktree: true,
  };
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function rowMatchesRepo(row, repo) {
  if (!isNonEmptyString(repo)) return true;
  const expected = repo.trim();
  return [row?.repo_root, row?.project_ref, row?.cwd, projectRef(row)]
    .filter((value) => typeof value === 'string' && value.trim())
    .some((value) => value.trim() === expected);
}

function rowMatchesBranch(row, branch) {
  if (!isNonEmptyString(branch)) return true;
  const expected = branch.trim();
  return [row?.branch, row?.attribution_branch]
    .filter((value) => typeof value === 'string' && value.trim())
    .some((value) => value.trim() === expected);
}

function displayFilterRows(rawRows, { repo = null, branch = null } = {}) {
  return rawRows
    .map((row) => rowWithDisplayAttribution(row))
    .filter((row) => rowMatchesRepo(row, repo) && rowMatchesBranch(row, branch));
}

function addModelRollup(models, row, rowTokens, rowCost) {
  const provider = String(row?.provider || 'unknown').trim() || 'unknown';
  const modelName = String(row?.model || 'unknown').trim() || 'unknown';
  const modelKey = `${provider}\u241f${modelName}`;
  if (!models.has(modelKey)) {
    models.set(modelKey, {
      provider,
      model: modelName,
      total_tokens: 0,
      total_cost_usd: null,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
      _cost: createCostAccumulator(),
    });
  }
  const modelEntry = models.get(modelKey);
  modelEntry.total_tokens += rowTokens;
  modelEntry.session_count += 1;
  addCostToAccumulator(modelEntry._cost, rowCost);
  return modelEntry;
}

function addDateBucketRollup(dateBuckets, row, rowTokens, rowCost) {
  const date = rowDateKey(row);
  if (!date) return null;
  if (!dateBuckets.has(date)) {
    dateBuckets.set(date, {
      date,
      total_tokens: 0,
      total_cost_usd: null,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
      models: new Map(),
      _cost: createCostAccumulator(),
    });
  }
  const bucket = dateBuckets.get(date);
  bucket.total_tokens += rowTokens;
  bucket.session_count += 1;
  addCostToAccumulator(bucket._cost, rowCost);
  addModelRollup(bucket.models, row, rowTokens, rowCost);
  return date;
}

function finalizeModelRollups(models, { includeProvider = false } = {}) {
  return Array.from(models.values())
    .map((modelEntry) => {
      const modelCost = finalizeCostAccumulator(modelEntry._cost);
      const out = {
        model: modelEntry.model,
        total_tokens: modelEntry.total_tokens,
        total_cost_usd: modelCost.total_cost_usd,
        cost_estimated: modelCost.cost_estimated,
        cost_quality: modelCost.cost_quality,
        session_count: modelEntry.session_count,
      };
      if (includeProvider) out.provider = modelEntry.provider;
      return out;
    })
    .sort((a, b) => b.total_tokens - a.total_tokens);
}

function finalizeDateBuckets(dateBuckets) {
  return Array.from(dateBuckets.values())
    .map((bucket) => {
      const bucketCost = finalizeCostAccumulator(bucket._cost);
      return {
        date: bucket.date,
        total_tokens: bucket.total_tokens,
        total_cost_usd: bucketCost.total_cost_usd,
        cost_estimated: bucketCost.cost_estimated,
        cost_quality: bucketCost.cost_quality,
        session_count: bucket.session_count,
        models: finalizeModelRollups(bucket.models, { includeProvider: true }),
      };
    })
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
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
    includeGitBranches = false,
    includeDateBuckets = false,
    sessionDate = null,
  } = {},
) {
  if (!fs.existsSync(dbPath)) return emptyResult();

  const requestedLimit = clampLimit(limit);
  const readOptions = {
    from,
    to,
    repo,
    branch,
    limit: requestedLimit,
    sourceFilter,
    includeArchived,
    includeUnattributed,
  };
  let rows = displayFilterRows(readBranchUsageFactRows(dbPath, readOptions), { repo, branch });
  if ((isNonEmptyString(repo) || isNonEmptyString(branch)) && rows.length === 0) {
    rows = displayFilterRows(
      readBranchUsageFactRows(dbPath, {
        from,
        to,
        sourceFilter,
        includeArchived,
        includeUnattributed,
      }),
      { repo, branch },
    );
  }

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
        date_buckets: includeDateBuckets ? new Map() : undefined,
        _cost: createCostAccumulator(),
        sessions: includeSessions ? [] : undefined,
        historical_worktree: row.historical_worktree || undefined,
      });
    }

    const branchEntry = repoEntry.branches.get(branchKey);
    branchEntry.historical_worktree = branchEntry.historical_worktree || row.historical_worktree || undefined;
    branchEntry.total_tokens += rowTokens;
    branchEntry.session_count += 1;
    addCostToAccumulator(branchEntry._cost, rowCost);
    if (String(rowLastSeen || '') > String(branchEntry.last_seen_at || '')) {
      branchEntry.last_seen_at = rowLastSeen;
    }
    branchEntry.confidence[normalizeConfidence(row.confidence)] += 1;

    addModelRollup(branchEntry.models, row, rowTokens, rowCost);
    const sessionDateKey = includeDateBuckets
      ? addDateBucketRollup(branchEntry.date_buckets, row, rowTokens, rowCost)
      : null;

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
        _date: sessionDateKey,
      });
    }
  }

  Object.assign(totals, finalizeCostAccumulator(totalsCost));

  return {
    repos: Array.from(repos.values()).map((repoEntry) => {
      const gitBranches =
        includeGitBranches && repoEntry.project_state === 'git_existing' && repoRootExists(repoEntry.repo_root)
          ? listGitBranches(repoEntry.repo_root)
          : [];
      return {
        repo_root: repoEntry.repo_root,
        project_state: repoEntry.project_state,
        archived: isArchivedProjectState(repoEntry.project_state),
        project_key: repoEntry.project_key,
        project_ref: repoEntry.project_ref,
        git_branches: gitBranches,
        git_branch_count: gitBranches.length,
        branches: Array.from(repoEntry.branches.values())
          .map((branchEntry) => {
            const branchCost = finalizeCostAccumulator(branchEntry._cost);
            const dateBuckets = includeDateBuckets ? finalizeDateBuckets(branchEntry.date_buckets) : [];
            const selectedDate =
              includeDateBuckets && sessionDate === 'latest'
                ? dateBuckets[0]?.date || null
                : includeDateBuckets && typeof sessionDate === 'string' && sessionDate.trim()
                  ? sessionDate.trim()
                  : null;
            const sessions = Array.isArray(branchEntry.sessions)
              ? branchEntry.sessions
                  .filter((session) => !selectedDate || session._date === selectedDate)
                  .map(({ _date, ...session }) => session)
              : branchEntry.sessions;
            return {
              ...branchEntry,
              total_cost_usd: branchCost.total_cost_usd,
              cost_estimated: branchCost.cost_estimated,
              cost_quality: branchCost.cost_quality,
              historical_worktree: branchEntry.historical_worktree || undefined,
              selected_date: selectedDate || undefined,
              date_buckets: includeDateBuckets ? dateBuckets : undefined,
              models: finalizeModelRollups(branchEntry.models),
              sessions,
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
