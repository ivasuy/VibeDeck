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
const {
  groupingVisible,
  readSessionGroupingMode,
  readGroupEdges,
  buildSessionGroupsForRows,
} = require('./sessions/session-groups');

function emptyResult() {
  return {
    repos: [],
    totals: {
      total_tokens: 0,
      billable_total_tokens: 0,
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

function numericField(row, key) {
  const n = Number(row?.[key] || 0);
  return Number.isFinite(n) ? n : 0;
}

function billableTokens(row) {
  const n = Number((row?.billable_total_tokens ?? row?.total_tokens) || 0);
  return Number.isFinite(n) ? n : 0;
}

function parseCounterJson(value) {
  if (typeof value !== 'string' || !value.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, count] of Object.entries(parsed)) {
    if (typeof key !== 'string' || key === '') continue;
    if (!Number.isInteger(count) || count < 0) continue;
    out[key] = count;
  }
  return out;
}

function stableCounterJson(counter) {
  const keys = Object.keys(counter || {}).sort();
  if (keys.length === 0) return null;
  const out = {};
  for (const key of keys) out[key] = counter[key];
  return JSON.stringify(out);
}

function mergeCounterJson(existingJson, nextJson) {
  const counter = parseCounterJson(existingJson);
  const next = parseCounterJson(nextJson);
  for (const [key, count] of Object.entries(next)) {
    counter[key] = (counter[key] || 0) + count;
  }
  return stableCounterJson(counter);
}

function enrichmentShape() {
  return {
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    web_search_requests: 0,
    tool_call_count: 0,
    tools_json: null,
    activity_json: null,
    task_category: null,
    skills_json: null,
    fast_mode: 0,
  };
}

function addEnrichment(target, row) {
  target.cache_creation_5m_input_tokens += numericField(row, 'cache_creation_5m_input_tokens');
  target.cache_creation_1h_input_tokens += numericField(row, 'cache_creation_1h_input_tokens');
  target.web_search_requests += numericField(row, 'web_search_requests');
  target.tool_call_count += numericField(row, 'tool_call_count');
  target.tools_json = mergeCounterJson(target.tools_json, row?.tools_json);
  target.activity_json = mergeCounterJson(target.activity_json, row?.activity_json);
  target.task_category = mergeCounterJson(target.task_category, row?.task_category);
  target.skills_json = mergeCounterJson(target.skills_json, row?.skills_json);
  target.fast_mode += numericField(row, 'fast_mode');
}

function stripEmptyEnrichment(row) {
  const out = { ...row };
  for (const key of [
    'cache_creation_5m_input_tokens',
    'cache_creation_1h_input_tokens',
    'web_search_requests',
    'tool_call_count',
    'fast_mode',
  ]) {
    if ((Number(out[key]) || 0) === 0) delete out[key];
  }
  for (const key of ['tools_json', 'activity_json', 'task_category', 'skills_json']) {
    if (out[key] == null) delete out[key];
  }
  return out;
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

function isUnsafeUserFacingBranchLabel(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const lower = value.trim().toLowerCase();
  if (lower === 'head') return true;
  if (lower.startsWith('tags/')) return true;
  if (lower.startsWith('origin/')) return true;
  if (lower.startsWith('remotes/')) return true;
  if (lower.startsWith('refs/tags/')) return true;
  if (lower.startsWith('refs/remotes/')) return true;
  if (lower.startsWith('detached@')) return true;
  if (lower.startsWith('refs/')) return true;
  return false;
}

function sanitizeUserFacingBranchRow(row) {
  if (!row || row.branch_kind !== 'known') return row;
  if (!isUnsafeUserFacingBranchLabel(row.branch)) return row;
  const unattributed = row.project_state === 'unattributed';
  return {
    ...row,
    branch: unattributed ? 'Unattributed' : 'Unknown branch',
    attribution_branch: null,
    branch_kind: unattributed ? 'unattributed' : 'unknown_git',
    confidence: unattributed ? 'unattributed' : 'low',
  };
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

function workspaceFamilyDescriptor(row) {
  const candidates = [row?.repo_root, row?.project_ref, row?.cwd].filter((value) => typeof value === 'string' && value.trim());
  for (const candidate of candidates) {
    const parts = pathParts(candidate);
    if (parts.length < 2) continue;
    const leaf = parts[parts.length - 1];

    const parent = parts[parts.length - 2];
    const isGeneratedRoot = parent === 'workspaces' || parent === 'tmp';
    if (!isGeneratedRoot) continue;

    const hashMatch = leaf.match(/^(.+)-([0-9a-f]{7,})$/i);
    const smokeMatch = leaf.match(/^(.+)-(official-smoke)$/i);
    const base = hashMatch?.[1] || smokeMatch?.[1] || leaf;
    const suffix = hashMatch?.[2] || smokeMatch?.[2] || '';
    if (!base) continue;
    const familyRoot = fromPathParts([...parts.slice(0, parts.length - 1), base]);
    return {
      base,
      suffix,
      branch: suffix ? `workspace-${suffix}` : 'workspace',
      context: parent,
      familyRoot,
      sourcePath: candidate,
    };
  }
  return null;
}

function rowWithDisplayAttribution(row) {
  const descriptor = historicalWorktreeDescriptor(row);
  if (!descriptor) {
    const workspace = workspaceFamilyDescriptor(row);
    if (!workspace) return row;

    const branch = displayBranchIsUnknown(row) ? workspace.branch : row.branch;
    const branchKind = displayBranchIsUnknown(row) ? 'workspace_clone' : row.branch_kind;
    return {
      ...row,
      scope_key: `workspace:${workspace.familyRoot}`,
      project_state: 'cwd_missing',
      project_key: workspace.base,
      project_ref: workspace.familyRoot,
      repo_root: null,
      cwd: row.cwd,
      branch,
      attribution_branch: branchKind === 'workspace_clone' ? branch : row.attribution_branch,
      branch_kind: branchKind,
      workspace_family: true,
      workspace_base: workspace.base,
      workspace_context: workspace.context,
      workspace_source_path: workspace.sourcePath,
    };
  }

  const parentRoot = safeRealpath(descriptor.parent);
  const parentExists = repoRootExists(parentRoot);
  const projectState = parentExists
    ? (isGitProjectRoot(parentRoot) ? 'git_existing' : 'non_git_existing')
    : 'git_missing';
  const branch = displayBranchIsUnknown(row) ? descriptor.branch : row.branch;
  const branchKind = displayBranchIsUnknown(row) ? 'historical_worktree' : row.branch_kind;

  return {
    ...row,
    scope_key: `${projectState === 'git_existing' ? 'git' : projectState === 'git_missing' ? 'git-missing' : 'cwd'}:${parentRoot}`,
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

function activeProjectRank(row) {
  if (row?.project_state === 'git_existing') return 3;
  if (row?.project_state === 'non_git_existing') return 2;
  return 0;
}

function activeProjectShape(row) {
  return {
    rank: activeProjectRank(row),
    scope_key: row.scope_key,
    project_state: row.project_state,
    project_key: projectKey(row),
    project_ref: projectRef(row),
    repo_root: row.repo_root || null,
    repo_common_dir: row.repo_common_dir || null,
    parent_repo: row.parent_repo || null,
  };
}

function prepareDisplayRows(rawRows) {
  const rows = (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => rowWithDisplayAttribution(row))
    .map((row) => sanitizeUserFacingBranchRow(row));
  const activeByProjectKey = new Map();

  for (const row of rows) {
    const rank = activeProjectRank(row);
    if (rank <= 0 || row.workspace_family) continue;
    const key = projectKey(row);
    const current = activeByProjectKey.get(key);
    if (!current || rank > current.rank) {
      activeByProjectKey.set(key, activeProjectShape(row));
    }
  }

  return rows.map((row) => {
    if (!row?.workspace_family) return row;
    const active = activeByProjectKey.get(row.workspace_base || projectKey(row));
    if (!active) return row;
    return {
      ...row,
      scope_key: active.scope_key,
      project_state: active.project_state,
      project_key: active.project_key,
      project_ref: active.project_ref,
      repo_root: active.repo_root,
      repo_common_dir: active.repo_common_dir,
      parent_repo: active.parent_repo,
    };
  });
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
  const ref = projectRef(row);
  if (row?.project_state === 'git_existing' && ref) return `git:${ref}`;
  if (row?.project_state === 'non_git_existing' && ref) return `cwd:${ref}`;
  if ((row?.project_state === 'git_missing' || row?.project_state === 'cwd_missing') && ref) return `missing:${ref}`;
  if (typeof row?.scope_key === 'string' && row.scope_key.trim()) return row.scope_key.trim();
  return [row?.project_state || 'unknown', ref || '', row?.repo_root || '', row?.cwd || ''].join('\u241f');
}

function projectStateRank(state) {
  if (state === 'git_existing') return 4;
  if (state === 'non_git_existing') return 3;
  if (state === 'git_missing') return 2;
  if (state === 'cwd_missing') return 1;
  return 0;
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
  return prepareDisplayRows(rawRows)
    .filter((row) => rowMatchesRepo(row, repo) && rowMatchesBranch(row, branch));
}

function addModelRollup(models, row, rowTokens, rowBillableTokens, rowCost) {
  const provider = String(row?.provider || 'unknown').trim() || 'unknown';
  const modelName = String(row?.model || 'unknown').trim() || 'unknown';
  const modelKey = `${provider}\u241f${modelName}`;
  if (!models.has(modelKey)) {
    models.set(modelKey, {
      provider,
      model: modelName,
      total_tokens: 0,
      billable_total_tokens: 0,
      total_cost_usd: null,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
      ...enrichmentShape(),
      _cost: createCostAccumulator(),
    });
  }
  const modelEntry = models.get(modelKey);
  modelEntry.total_tokens += rowTokens;
  modelEntry.billable_total_tokens += rowBillableTokens;
  modelEntry.session_count += 1;
  addEnrichment(modelEntry, row);
  addCostToAccumulator(modelEntry._cost, rowCost);
  return modelEntry;
}

function addDateBucketRollup(dateBuckets, row, rowTokens, rowBillableTokens, rowCost) {
  const date = rowDateKey(row);
  if (!date) return null;
  if (!dateBuckets.has(date)) {
    dateBuckets.set(date, {
      date,
      total_tokens: 0,
      billable_total_tokens: 0,
      total_cost_usd: null,
      cost_estimated: false,
      cost_quality: 'zero_tokens',
      session_count: 0,
      models: new Map(),
      ...enrichmentShape(),
      _cost: createCostAccumulator(),
    });
  }
  const bucket = dateBuckets.get(date);
  bucket.total_tokens += rowTokens;
  bucket.billable_total_tokens += rowBillableTokens;
  bucket.session_count += 1;
  addEnrichment(bucket, row);
  addCostToAccumulator(bucket._cost, rowCost);
  addModelRollup(bucket.models, row, rowTokens, rowBillableTokens, rowCost);
  return date;
}

function finalizeModelRollups(models, { includeProvider = false } = {}) {
  return Array.from(models.values())
    .map((modelEntry) => {
      const modelCost = finalizeCostAccumulator(modelEntry._cost);
      const out = stripEmptyEnrichment({
        model: modelEntry.model,
        total_tokens: modelEntry.total_tokens,
        billable_total_tokens: modelEntry.billable_total_tokens,
        total_cost_usd: modelCost.total_cost_usd,
        cost_estimated: modelCost.cost_estimated,
        cost_quality: modelCost.cost_quality,
        session_count: modelEntry.session_count,
        cache_creation_5m_input_tokens: modelEntry.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens: modelEntry.cache_creation_1h_input_tokens,
        web_search_requests: modelEntry.web_search_requests,
        tool_call_count: modelEntry.tool_call_count,
        tools_json: modelEntry.tools_json,
        activity_json: modelEntry.activity_json,
        task_category: modelEntry.task_category,
        skills_json: modelEntry.skills_json,
        fast_mode: modelEntry.fast_mode,
      });
      if (includeProvider) out.provider = modelEntry.provider;
      return out;
    })
    .sort((a, b) => b.total_tokens - a.total_tokens);
}

function finalizeDateBuckets(dateBuckets) {
  return Array.from(dateBuckets.values())
    .map((bucket) => {
      const bucketCost = finalizeCostAccumulator(bucket._cost);
      return stripEmptyEnrichment({
        date: bucket.date,
        total_tokens: bucket.total_tokens,
        billable_total_tokens: bucket.billable_total_tokens,
        total_cost_usd: bucketCost.total_cost_usd,
        cost_estimated: bucketCost.cost_estimated,
        cost_quality: bucketCost.cost_quality,
        session_count: bucket.session_count,
        cache_creation_5m_input_tokens: bucket.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens: bucket.cache_creation_1h_input_tokens,
        web_search_requests: bucket.web_search_requests,
        tool_call_count: bucket.tool_call_count,
        tools_json: bucket.tools_json,
        activity_json: bucket.activity_json,
        task_category: bucket.task_category,
        skills_json: bucket.skills_json,
        fast_mode: bucket.fast_mode,
        models: finalizeModelRollups(bucket.models, { includeProvider: true }),
      });
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
  context = {},
) {
  if (!fs.existsSync(dbPath)) return emptyResult();

  const requestedLimit = clampLimit(limit);
  const groupingMode = context.groupingMode || readSessionGroupingMode(context.env || process.env);
  const groupEdges = groupingVisible(groupingMode) && includeSessions ? readGroupEdges(dbPath) : [];
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
  if (isNonEmptyString(repo) || isNonEmptyString(branch)) {
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
    billable_total_tokens: 0,
    total_cost_usd: 0,
    cost_estimated: false,
    cost_quality: 'zero_tokens',
    session_count: 0,
  };

  for (const row of rows) {
    const rowCost = factCost(row);
    const rowTokens = Number(row.total_tokens || 0);
    const rowBillableTokens = billableTokens(row);
    const rowLastSeen = row.last_observed_at || row.first_observed_at || null;
    const repoKey = repoGroupKey(row);

    totals.total_tokens += rowTokens;
    totals.billable_total_tokens += rowBillableTokens;
    totals.session_count += 1;
    addCostToAccumulator(totalsCost, rowCost);

    if (!repos.has(repoKey)) {
      repos.set(repoKey, {
        repo_root: row.repo_root || null,
        project_state: row.project_state || null,
        project_key: projectKey(row),
        project_ref: projectRef(row),
        workspace_family: Boolean(row.workspace_family),
        workspace_context: row.workspace_context || null,
        workspace_paths: new Set(),
        branches: new Map(),
      });
    }

    const repoEntry = repos.get(repoKey);
    if (projectStateRank(row.project_state) > projectStateRank(repoEntry.project_state)) {
      repoEntry.repo_root = row.repo_root || null;
      repoEntry.project_state = row.project_state || null;
      repoEntry.project_key = projectKey(row);
      repoEntry.project_ref = projectRef(row);
    }
    if (row.workspace_family) {
      repoEntry.workspace_family = true;
      repoEntry.workspace_context = repoEntry.workspace_context || row.workspace_context || null;
      if (row.workspace_source_path) repoEntry.workspace_paths.add(row.workspace_source_path);
    }
    const branchName = row.branch || 'unattributed';
    const branchKind = row.branch_kind || 'unknown';
    const branchKey = `${branchName}\u241f${branchKind}`;

    if (!repoEntry.branches.has(branchKey)) {
      repoEntry.branches.set(branchKey, {
        branch: branchName,
        attribution_branch: row.attribution_branch || attributionBranchName(branchName),
        branch_kind: branchKind,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: null,
        cost_estimated: false,
        cost_quality: 'zero_tokens',
        session_count: 0,
        last_seen_at: rowLastSeen,
        confidence: confidenceShape(),
        models: new Map(),
        date_buckets: includeDateBuckets ? new Map() : undefined,
        ...enrichmentShape(),
        _cost: createCostAccumulator(),
        sessions: includeSessions ? [] : undefined,
        historical_worktree: row.historical_worktree || undefined,
      });
    }

    const branchEntry = repoEntry.branches.get(branchKey);
    branchEntry.historical_worktree = branchEntry.historical_worktree || row.historical_worktree || undefined;
    branchEntry.total_tokens += rowTokens;
    branchEntry.billable_total_tokens += rowBillableTokens;
    branchEntry.session_count += 1;
    addEnrichment(branchEntry, row);
    addCostToAccumulator(branchEntry._cost, rowCost);
    if (String(rowLastSeen || '') > String(branchEntry.last_seen_at || '')) {
      branchEntry.last_seen_at = rowLastSeen;
    }
    branchEntry.confidence[normalizeConfidence(row.confidence)] += 1;

    addModelRollup(branchEntry.models, row, rowTokens, rowBillableTokens, rowCost);
    const sessionDateKey = includeDateBuckets
      ? addDateBucketRollup(branchEntry.date_buckets, row, rowTokens, rowBillableTokens, rowCost)
      : null;

    if (includeSessions) {
      branchEntry.sessions.push({
        provider: row.provider,
        session_id: row.session_id,
        started_at: row.first_observed_at,
        ended_at: row.last_observed_at,
        model: row.model,
        total_tokens: row.total_tokens,
        billable_total_tokens: row.billable_total_tokens ?? row.total_tokens,
        total_cost_usd: rowCost.total_cost_usd,
        cost_estimated: rowCost.cost_estimated,
        cost_quality: rowCost.cost_quality,
        confidence: row.confidence,
        branch_resolution_tier: row.branch_resolution_tier,
        cache_creation_5m_input_tokens: numericField(row, 'cache_creation_5m_input_tokens'),
        cache_creation_1h_input_tokens: numericField(row, 'cache_creation_1h_input_tokens'),
        web_search_requests: numericField(row, 'web_search_requests'),
        tool_call_count: numericField(row, 'tool_call_count'),
        tools_json: row.tools_json ?? null,
        activity_json: row.activity_json ?? null,
        task_category: row.task_category ?? null,
        skills_json: row.skills_json ?? null,
        fast_mode: numericField(row, 'fast_mode'),
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
        workspace_family: repoEntry.workspace_family || undefined,
        workspace_context: repoEntry.workspace_context || undefined,
        workspace_paths: repoEntry.workspace_paths.size > 0 ? Array.from(repoEntry.workspace_paths).sort() : undefined,
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
            const groupedSessions = groupingVisible(groupingMode) && Array.isArray(sessions)
              ? buildSessionGroupsForRows(sessions, groupEdges)
              : { sessions, session_groups: undefined };
            return stripEmptyEnrichment({
              ...branchEntry,
              total_cost_usd: branchCost.total_cost_usd,
              cost_estimated: branchCost.cost_estimated,
              cost_quality: branchCost.cost_quality,
              historical_worktree: branchEntry.historical_worktree || undefined,
              selected_date: selectedDate || undefined,
              date_buckets: includeDateBuckets ? dateBuckets : undefined,
              models: finalizeModelRollups(branchEntry.models),
              sessions: groupedSessions.sessions,
              session_groups: groupedSessions.session_groups,
            });
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
