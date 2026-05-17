'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('./cost-estimation');
const { readBranchUsageFactRows } = require('./sessions/branch-usage-facts');

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

function getZonedParts(date, context = {}) {
  const { timeZone, offsetMinutes } = context || {};
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

function userFacingLocalPath(value) {
  const normalized = normalizePathString(value);
  if (!normalized) return null;
  const alternate = normalized.startsWith('/private/var/')
    ? `/var/${normalized.slice('/private/var/'.length)}`
    : normalized.startsWith('/private/tmp/')
      ? `/tmp/${normalized.slice('/private/tmp/'.length)}`
      : null;
  if (!alternate) return normalized;
  try {
    return fs.realpathSync(alternate) === normalized ? alternate : normalized;
  } catch {
    return normalized;
  }
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

function isArchivedProjectState(projectState) {
  return projectState === 'git_missing' || projectState === 'cwd_missing';
}

function createUsageEntry({ project_key, project_ref, repo_root, project_state }) {
  const cleanProjectKey = normalizePathString(project_key) || 'unknown';
  const cleanProjectRef = normalizePathString(project_ref) || cleanProjectKey;
  const cleanRepoRoot = normalizePathString(repo_root);
  const cleanProjectState = normalizePathString(project_state);

  return {
    project_key: cleanProjectKey,
    project_ref: cleanProjectRef,
    repo_root: cleanRepoRoot,
    project_state: cleanProjectState,
    archived: isArchivedProjectState(cleanProjectState),
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
  if (!entry.project_state && descriptor.project_state) {
    entry.project_state = descriptor.project_state;
    entry.archived = isArchivedProjectState(descriptor.project_state);
  }
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
    project_state: entry.project_state,
    archived: Boolean(entry.archived),
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

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toBooleanFlag(value) {
  return value === true || value === 1 || value === '1';
}

function factCost(row) {
  return {
    total_cost_usd: toFiniteNumber(row?.total_cost_usd),
    cost_estimated: toBooleanFlag(row?.cost_estimated),
    cost_quality:
      typeof row?.cost_quality === 'string' && row.cost_quality.trim()
        ? row.cost_quality.trim()
        : row?.total_cost_usd == null
          ? 'partial_unknown'
          : 'mixed_known',
  };
}

function factProjectRef(row) {
  return (
    userFacingLocalPath(row?.project_ref) ||
    userFacingLocalPath(row?.repo_root) ||
    userFacingLocalPath(row?.cwd)
  );
}

function factProjectState(row) {
  return normalizePathString(row?.project_state) || null;
}

function isGitFactRow(row) {
  return String(factProjectState(row) || '').startsWith('git_');
}

function isTrackedGitBranchFact(row, branchName) {
  if (!isGitFactRow(row)) return false;
  if (typeof branchName !== 'string' || !branchName.trim()) return false;
  const kind = String(row?.branch_kind || '').trim();
  return kind === 'known' || kind === 'tag';
}

function factProjectRepoRoot(row, projectRef) {
  if (!isGitFactRow(row)) return null;
  return normalizePathString(projectRef) || userFacingLocalPath(row?.repo_root);
}

function factWorktreeKey(row, projectRef) {
  if (isGitFactRow(row)) {
    return userFacingLocalPath(row?.repo_root) || normalizePathString(projectRef);
  }
  return normalizePathString(projectRef);
}

function factWorktreeProjectKey(row, worktreeKey) {
  if (typeof row?.project_key === 'string' && row.project_key.trim() && !isGitFactRow(row)) {
    return row.project_key.trim();
  }
  return path.basename(worktreeKey || '') || normalizePathString(row?.project_key) || 'unknown';
}

function factProjectKey(row, fallbackRef) {
  return normalizePathString(row?.project_key) || localProjectKeyForDepth(fallbackRef, 1);
}

function factActivityAt(row) {
  return row?.last_observed_at || row?.first_observed_at || null;
}

function filterFactRowsForProjectUsage(rows, { from = '', to = '', timeZoneContext = null } = {}) {
  return rows.filter((row) => {
    const day = projectUsageDayKey(factActivityAt(row), timeZoneContext);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
}

function buildFactProjectKeyResolver(projectRowsByRef) {
  const refs = Array.from(projectRowsByRef.keys()).filter(Boolean);
  const disambiguatedLabels = buildLocalProjectKeyMap(refs);
  const refsByFactKey = new Map();

  for (const [projectRef, rows] of projectRowsByRef) {
    const key = factProjectKey(rows[0], projectRef);
    if (!refsByFactKey.has(key)) refsByFactKey.set(key, new Set());
    refsByFactKey.get(key).add(projectRef);
  }

  return (projectRef, row) => {
    const key = factProjectKey(row, projectRef);
    if ((refsByFactKey.get(key)?.size || 0) > 1) {
      return disambiguatedLabels.get(projectRef) || key;
    }
    return key;
  };
}

function readProjectUsageEntries(
  dbPath,
  { from = '', to = '', timeZoneContext = null, sourceFilter = null } = {},
) {
  if (!fs.existsSync(dbPath)) return [];

  const filteredRows = filterFactRowsForProjectUsage(
    readBranchUsageFactRows(dbPath, { sourceFilter, includeArchived: true }),
    { from, to, timeZoneContext },
  );
  if (filteredRows.length === 0) return [];

  const rowsByProjectRef = new Map();
  for (const row of filteredRows) {
    const projectRef = factProjectRef(row);
    if (!projectRef) continue;
    if (!rowsByProjectRef.has(projectRef)) rowsByProjectRef.set(projectRef, []);
    rowsByProjectRef.get(projectRef).push(row);
  }
  if (rowsByProjectRef.size === 0) return [];

  const projectKeyFor = buildFactProjectKeyResolver(rowsByProjectRef);
  const projects = new Map();
  for (const row of filteredRows) {
    const projectRef = factProjectRef(row);
    if (!projectRef) continue;
    const projectState = factProjectState(row);
    const projectKey = projectKeyFor(projectRef, row);
    const projectRepoRoot = factProjectRepoRoot(row, projectRef);
    const worktreeKey = factWorktreeKey(row, projectRef);
    if (!worktreeKey) continue;

    if (!projects.has(projectRef)) {
      projects.set(projectRef, {
        project: ensureUsageEntry(new Map(), projectRef, {
          project_key: projectKey,
          project_ref: projectRef,
          repo_root: projectRepoRoot,
          project_state: projectState,
          git_branches: [],
        }),
        worktrees: new Map(),
      });
    }

    const descriptor = projects.get(projectRef);
    const projectEntry = descriptor.project;
    const worktreeEntry = ensureUsageEntry(descriptor.worktrees, worktreeKey, {
      project_key: factWorktreeProjectKey(row, worktreeKey),
      project_ref: worktreeKey,
      repo_root: isGitFactRow(row) ? worktreeKey : null,
      project_state: projectState,
      git_branches: [],
    });

    const branchName = typeof row?.branch === 'string' && row.branch.trim() ? row.branch.trim() : null;
    const lastSeenAt = normalizeIsoTimestamp(factActivityAt(row));
    const group = {
      provider: row?.provider,
      model: row?.model,
      total_tokens: Number(row?.total_tokens || 0),
      billable_total_tokens: Number(row?.total_tokens || 0),
      session_count: 1,
      last_seen_at: lastSeenAt,
      branches: branchName ? [branchName] : [],
      costResult: factCost(row),
    };
    addUsageGroup(projectEntry, group);
    addUsageGroup(worktreeEntry, group);
    if (isTrackedGitBranchFact(row, branchName)) {
      projectEntry._gitBranches.add(branchName);
      worktreeEntry._gitBranches.add(branchName);
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
}

module.exports = {
  deriveProjectRoot,
  compareProjectUsageEntries,
  readProjectUsageEntries,
};
