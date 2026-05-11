'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');

function repoRootExists(repoRoot) {
  if (typeof repoRoot !== 'string' || !repoRoot.trim()) return false;
  try {
    return fs.statSync(repoRoot.trim()).isDirectory();
  } catch {
    return false;
  }
}

function normalizeIsoTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function getZonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(dt.getTime())) return null;

  if (timeZone && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      });
      const parts = formatter.formatToParts(dt);
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value;
        return acc;
      }, {});
      const year = Number(values.year);
      const month = Number(values.month);
      const day = Number(values.day);
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      const second = Number(values.second);
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return { year, month, day, hour, minute, second };
      }
    } catch {}
  }

  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  };
}

function formatPartsDayKey(parts) {
  if (!parts) return '';
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function projectUsageDayKey(value, timeZoneContext) {
  const iso = normalizeIsoTimestamp(value);
  if (!iso) return '';
  return formatPartsDayKey(getZonedParts(new Date(iso), timeZoneContext)) || iso.slice(0, 10);
}

function normalizePathString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stripTrailingDotGit(repoCommonDir) {
  const normalized = normalizePathString(repoCommonDir);
  if (!normalized) return null;
  if (path.basename(normalized) !== '.git') return normalized;
  return path.dirname(normalized);
}

function deriveProjectRoot(parentRepo, repoCommonDir, repoRoot) {
  const normalizedParent = normalizePathString(parentRepo);
  if (normalizedParent) return normalizedParent;
  const fromCommonDir = stripTrailingDotGit(repoCommonDir);
  if (fromCommonDir) return fromCommonDir;
  return normalizePathString(repoRoot);
}

function splitRepoRootSegments(repoRoot) {
  return String(repoRoot || '')
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
}

function localProjectKeyForDepth(repoRoot, depth) {
  const parts = splitRepoRootSegments(repoRoot);
  if (parts.length === 0) return String(repoRoot || '').trim() || 'unknown';
  return parts.slice(Math.max(0, parts.length - depth)).join('/');
}

function buildLocalProjectKeyMap(projectRoots) {
  const repoRoots = Array.from(new Set((Array.isArray(projectRoots) ? projectRoots : []).filter(Boolean)));
  const labels = new Map();
  let pending = repoRoots;
  let depth = 1;

  while (pending.length > 0) {
    const groups = new Map();
    for (const repoRoot of pending) {
      const label = localProjectKeyForDepth(repoRoot, depth);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(repoRoot);
    }

    const nextPending = [];
    for (const [label, repoRootsForLabel] of groups) {
      if (repoRootsForLabel.length === 1) {
        labels.set(repoRootsForLabel[0], label);
        continue;
      }

      for (const repoRoot of repoRootsForLabel) {
        if (depth >= splitRepoRootSegments(repoRoot).length) {
          labels.set(repoRoot, label);
        } else {
          nextPending.push(repoRoot);
        }
      }
    }

    pending = nextPending;
    depth += 1;
  }

  return labels;
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

function createUsageEntry({ project_key, project_ref, repo_root }) {
  const cleanProjectKey = normalizePathString(project_key) || 'unknown';
  const cleanProjectRef = normalizePathString(project_ref) || cleanProjectKey;
  const cleanRepoRoot = normalizePathString(repo_root);

  return {
    project_key: cleanProjectKey,
    project_ref: cleanProjectRef,
    repo_root: cleanRepoRoot,
    total_tokens: 0,
    billable_total_tokens: 0,
    last_seen_at: null,
    _gitBranches: new Set(),
    _cost: createCostAccumulator(),
    _providers: new Map(),
    _branches: new Set(),
  };
}

function ensureUsageEntry(map, key, descriptor) {
  if (!map.has(key)) {
    map.set(key, createUsageEntry(descriptor));
  }
  const entry = map.get(key);
  if (!entry.repo_root && descriptor.repo_root) entry.repo_root = descriptor.repo_root;
  if (!entry.project_ref && descriptor.project_ref) entry.project_ref = descriptor.project_ref;
  if (descriptor.project_key && (!entry.project_key || entry.project_key === entry.project_ref)) {
    entry.project_key = descriptor.project_key;
  }
  if (Array.isArray(descriptor.git_branches)) {
    for (const branchName of descriptor.git_branches) {
      if (typeof branchName === 'string' && branchName.trim()) {
        entry._gitBranches.add(branchName.trim());
      }
    }
  }
  return entry;
}

function ensureProviderUsageEntry(entry, providerName) {
  const providerKey = typeof providerName === 'string' && providerName.trim()
    ? providerName.trim()
    : 'unknown';
  if (!entry._providers.has(providerKey)) {
    entry._providers.set(providerKey, {
      provider: providerKey,
      total_tokens: 0,
      billable_total_tokens: 0,
      session_count: 0,
      _cost: createCostAccumulator(),
      _models: new Map(),
    });
  }
  return entry._providers.get(providerKey);
}

function ensureModelUsageEntry(providerEntry, modelName) {
  const modelKey = typeof modelName === 'string' && modelName.trim() ? modelName.trim() : 'unknown';
  if (!providerEntry._models.has(modelKey)) {
    providerEntry._models.set(modelKey, {
      model: modelKey,
      total_tokens: 0,
      billable_total_tokens: 0,
      session_count: 0,
      _cost: createCostAccumulator(),
    });
  }
  return providerEntry._models.get(modelKey);
}

function updateUsageLastSeen(entry, lastSeenAt) {
  if (lastSeenAt && (!entry.last_seen_at || lastSeenAt > entry.last_seen_at)) {
    entry.last_seen_at = lastSeenAt;
  }
}

function addUsageGroup(entry, group) {
  const totalTokens = Number(group?.total_tokens || 0);
  const billableTotalTokens = Number((group?.billable_total_tokens ?? group?.total_tokens) || 0);
  const sessionCount = Number(group?.session_count || 0);
  const lastSeenAt = normalizeIsoTimestamp(group?.last_seen_at);
  const costResult = group?.costResult || {
    total_cost_usd: null,
    cost_estimated: true,
    cost_quality: 'pricing_missing',
  };
  const providerEntry = ensureProviderUsageEntry(entry, group?.provider);
  const modelEntry = ensureModelUsageEntry(providerEntry, group?.model);

  entry.total_tokens += totalTokens;
  entry.billable_total_tokens += billableTotalTokens;
  updateUsageLastSeen(entry, lastSeenAt);
  addCostToAccumulator(entry._cost, costResult);
  if (Array.isArray(group?.branches)) {
    for (const branchName of group.branches) {
      if (typeof branchName === 'string' && branchName.trim()) {
        entry._branches.add(branchName.trim());
      }
    }
  }

  providerEntry.total_tokens += totalTokens;
  providerEntry.billable_total_tokens += billableTotalTokens;
  providerEntry.session_count += sessionCount;
  addCostToAccumulator(providerEntry._cost, costResult);

  modelEntry.total_tokens += totalTokens;
  modelEntry.billable_total_tokens += billableTotalTokens;
  modelEntry.session_count += sessionCount;
  addCostToAccumulator(modelEntry._cost, costResult);
}

function formatCost(value) {
  return Number.isFinite(value) ? Number(value).toFixed(6) : null;
}

function finalizeUsageEntry(entry) {
  const providers = Array.from(entry._providers.values())
    .sort((a, b) => {
      const byTokens = b.total_tokens - a.total_tokens;
      return byTokens !== 0 ? byTokens : a.provider.localeCompare(b.provider);
    })
    .map((providerEntry) => {
      const providerCost = finalizeCostAccumulator(providerEntry._cost);
      const models = Array.from(providerEntry._models.values())
        .sort((a, b) => {
          const byTokens = b.total_tokens - a.total_tokens;
          return byTokens !== 0 ? byTokens : a.model.localeCompare(b.model);
        })
        .map((modelEntry) => {
          const modelCost = finalizeCostAccumulator(modelEntry._cost);
          return {
            model: modelEntry.model,
            total_tokens: String(modelEntry.total_tokens),
            billable_total_tokens: String(modelEntry.billable_total_tokens),
            estimated_total_cost_usd: formatCost(modelCost.total_cost_usd),
            cost_estimated: modelCost.cost_estimated,
            cost_quality: modelCost.cost_quality,
            session_count: modelEntry.session_count,
          };
        });

      return {
        provider: providerEntry.provider,
        total_tokens: String(providerEntry.total_tokens),
        billable_total_tokens: String(providerEntry.billable_total_tokens),
        estimated_total_cost_usd: formatCost(providerCost.total_cost_usd),
        cost_estimated: providerCost.cost_estimated,
        cost_quality: providerCost.cost_quality,
        session_count: providerEntry.session_count,
        models,
      };
    });

  const topModels = providers
    .flatMap((providerEntry) =>
      providerEntry.models.map((modelEntry) => ({
        provider: providerEntry.provider,
        model: modelEntry.model,
        total_tokens: modelEntry.total_tokens,
        billable_total_tokens: modelEntry.billable_total_tokens,
        estimated_total_cost_usd: modelEntry.estimated_total_cost_usd,
        cost_estimated: modelEntry.cost_estimated,
        cost_quality: modelEntry.cost_quality,
        session_count: modelEntry.session_count,
      })),
    )
    .sort((a, b) => {
      const byTokens = Number(b.total_tokens) - Number(a.total_tokens);
      if (byTokens !== 0) return byTokens;
      const byProvider = a.provider.localeCompare(b.provider);
      return byProvider !== 0 ? byProvider : a.model.localeCompare(b.model);
    });

  const totalCost = finalizeCostAccumulator(entry._cost);
  const branches = Array.from(entry._branches).sort();
  const gitBranches = Array.from(entry._gitBranches).sort();
  return {
    project_key: entry.project_key,
    project_ref: entry.project_ref,
    repo_root: entry.repo_root,
    total_tokens: String(entry.total_tokens),
    billable_total_tokens: String(entry.billable_total_tokens),
    estimated_total_cost_usd: formatCost(totalCost.total_cost_usd),
    cost_estimated: totalCost.cost_estimated,
    cost_quality: totalCost.cost_quality,
    last_seen_at: entry.last_seen_at,
    branch_count: branches.length,
    branches,
    git_branch_count: gitBranches.length,
    git_branches: gitBranches,
    providers,
    top_models: topModels,
  };
}

function compareProjectUsageEntries(a, b, sortMode) {
  if (sortMode === 'recent') {
    const byRecent = String(b?.last_seen_at || '').localeCompare(String(a?.last_seen_at || ''));
    if (byRecent !== 0) return byRecent;
  }
  const byTokens = Number(b?.billable_total_tokens || 0) - Number(a?.billable_total_tokens || 0);
  if (byTokens !== 0) return byTokens;
  if (sortMode !== 'recent') {
    const byRecent = String(b?.last_seen_at || '').localeCompare(String(a?.last_seen_at || ''));
    if (byRecent !== 0) return byRecent;
  }
  return String(a?.project_key || '').localeCompare(String(b?.project_key || ''));
}

function readProjectUsageEntries(
  dbPath,
  { from = '', to = '', timeZoneContext = null, sourceFilter = null } = {},
) {
  if (!fs.existsSync(dbPath)) return [];
  const clauses = ['repo_root IS NOT NULL', "repo_root <> ''"];
  const params = [];

  if (sourceFilter && sourceFilter.size > 0) {
    const placeholders = Array.from(sourceFilter, () => '?').join(', ');
    clauses.push(`LOWER(COALESCE(provider, '')) IN (${placeholders})`);
    params.push(...sourceFilter);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT
        repo_root,
        repo_common_dir,
        parent_repo,
        provider,
        branch,
        model,
        COALESCE(total_tokens, 0) AS total_tokens,
        total_cost_usd,
        last_observed_at,
        input_tokens,
        cached_input_tokens,
        cache_creation_input_tokens,
        output_tokens,
        reasoning_output_tokens,
        cost_estimated,
        cost_quality,
        COALESCE(last_observed_at, ended_at, updated_at, started_at) AS activity_at
      FROM vibedeck_sessions
      WHERE ${clauses.join(' AND ')}
    `).all(...params);
    const filteredRows = rows
      .filter((row) => repoRootExists(row?.repo_root))
      .filter((row) => {
        const day = projectUsageDayKey(row?.activity_at, timeZoneContext);
        if (!day) return false;
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      });
    if (filteredRows.length === 0) return [];

    const projectRoots = Array.from(
      new Set(
        filteredRows
          .map((row) => deriveProjectRoot(row?.parent_repo, row?.repo_common_dir, row?.repo_root))
          .filter(Boolean),
      ),
    );
    const projectLabels = buildLocalProjectKeyMap(projectRoots);
    const gitBranchesByWorktree = new Map();
    for (const row of filteredRows) {
      const repoRoot = normalizePathString(row?.repo_root);
      if (repoRoot && !gitBranchesByWorktree.has(repoRoot)) {
        gitBranchesByWorktree.set(repoRoot, listGitBranches(repoRoot));
      }
    }

    const projects = new Map();
    for (const row of filteredRows) {
      const repoRoot = normalizePathString(row?.repo_root);
      if (!repoRoot) continue;
      const projectRoot = deriveProjectRoot(row?.parent_repo, row?.repo_common_dir, row?.repo_root) || repoRoot;
      const projectKey = projectLabels.get(projectRoot) || projectRoot;
      const worktreeKey = repoRoot;
      if (!projects.has(projectRoot)) {
        projects.set(projectRoot, {
          project: ensureUsageEntry(new Map(), projectRoot, {
            project_key: projectKey,
            project_ref: projectRoot,
            repo_root: projectRoot,
            git_branches: [],
          }),
          worktrees: new Map(),
        });
      }

      const descriptor = projects.get(projectRoot);
      const projectEntry = descriptor.project;
      const worktreeEntry = ensureUsageEntry(descriptor.worktrees, worktreeKey, {
        project_key: path.basename(repoRoot),
        project_ref: repoRoot,
        repo_root: repoRoot,
        git_branches: gitBranchesByWorktree.get(repoRoot) || [],
      });

      const branchName = typeof row?.branch === 'string' && row.branch.trim() ? row.branch.trim() : null;
      const lastSeenAt = normalizeIsoTimestamp(row?.activity_at);
      const costResult = resolveUsageCost({
        source: row?.provider,
        model: row?.model,
        total_tokens: Number(row?.total_tokens || 0),
        input_tokens: Number(row?.input_tokens || 0),
        cached_input_tokens: Number(row?.cached_input_tokens || 0),
        cache_creation_input_tokens: Number(row?.cache_creation_input_tokens || 0),
        output_tokens: Number(row?.output_tokens || 0),
        reasoning_output_tokens: Number(row?.reasoning_output_tokens || 0),
        stored_cost_usd: row?.total_cost_usd,
        stored_cost_is_authoritative: row?.total_cost_usd != null && Number(row?.cost_estimated || 0) === 0,
      });

      const group = {
        provider: row?.provider,
        model: row?.model,
        total_tokens: Number(row?.total_tokens || 0),
        billable_total_tokens: Number(row?.total_tokens || 0),
        session_count: 1,
        last_seen_at: lastSeenAt,
        branches: branchName ? [branchName] : [],
        costResult,
      };
      addUsageGroup(projectEntry, group);
      addUsageGroup(worktreeEntry, group);
      for (const gitBranch of gitBranchesByWorktree.get(repoRoot) || []) {
        projectEntry._gitBranches.add(gitBranch);
      }
    }

    return Array.from(projects.values()).map(({ project, worktrees }) => {
      const finalizedProject = finalizeUsageEntry(project);
      const finalizedWorktrees = Array.from(worktrees.values())
        .map((entry) => finalizeUsageEntry(entry))
        .sort((a, b) => Number(b.total_tokens) - Number(a.total_tokens));

      return {
        ...finalizedProject,
        worktree_count: finalizedWorktrees.length,
        worktrees: finalizedWorktrees,
      };
    });
  } finally {
    db.close();
  }
}

module.exports = {
  deriveProjectRoot,
  compareProjectUsageEntries,
  readProjectUsageEntries,
};
