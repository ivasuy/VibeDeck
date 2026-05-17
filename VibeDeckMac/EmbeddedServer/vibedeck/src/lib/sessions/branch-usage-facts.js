'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { findBranchAt } = require('./head-history');
const { resolveRepo } = require('./repo-resolver');
const { classifyProjectAttribution } = require('./project-attribution-state');
const { normalizeBranchName } = require('./branch-name');
const { resolveUsageCost } = require('../cost-estimation');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInteger(value) {
  const n = toFiniteNumber(value);
  return n == null ? 0 : Math.trunc(n);
}

function roundCost(value) {
  return Math.round(Number(value || 0) * 10000) / 10000;
}

function branchUsageDisplayBranch({ branch, project }) {
  const normalizedBranch = normalizeBranchName(branch);
  if (normalizedBranch) {
    return { branch: normalizedBranch, branch_kind: 'known', confidence: 'high' };
  }
  return {
    branch: project.branch,
    branch_kind: project.branch_kind,
    confidence: project.branch_kind === 'unattributed' ? 'unattributed' : 'low',
  };
}

function projectShape(row, provider, sessionId) {
  return classifyProjectAttribution({
    provider,
    session_id: sessionId,
    cwd: row?.cwd ?? null,
    repo_root: row?.repo_root ?? null,
    repo_common_dir: row?.repo_common_dir ?? null,
    parent_repo: row?.parent_repo ?? null,
  });
}

function mergeProjectRow(event, session) {
  const eventCwd = isNonEmptyString(event?.cwd) ? event.cwd : null;
  const eventRepoRoot = isNonEmptyString(event?.repo_root) ? event.repo_root : null;
  const eventRepoCommonDir = isNonEmptyString(event?.repo_common_dir) ? event.repo_common_dir : null;
  const eventParentRepo = isNonEmptyString(event?.parent_repo) ? event.parent_repo : null;
  const hasEventProjectEvidence = Boolean(eventCwd || eventRepoRoot || eventRepoCommonDir || eventParentRepo);
  if (!hasEventProjectEvidence) return session;

  return {
    cwd: eventCwd ?? session?.cwd ?? null,
    repo_root: eventRepoRoot ?? session?.repo_root ?? null,
    repo_common_dir: eventRepoCommonDir ?? session?.repo_common_dir ?? null,
    parent_repo: eventParentRepo ?? session?.parent_repo ?? null,
  };
}

function headHistoryBranch(dbPath, project, observedAt) {
  if (!dbPath || !project || project.branch_kind !== 'unknown_git') return null;
  if (!isNonEmptyString(project.repo_root) || !isNonEmptyString(observedAt)) return null;
  try {
    return normalizeBranchName(findBranchAt(dbPath, { worktree_root: project.repo_root, when: observedAt }));
  } catch {
    return null;
  }
}

function factBranch({ dbPath, project, observedAt, event, session }) {
  if (!project || project.branch_kind !== 'unknown_git') return null;

  const eventBranch = normalizeBranchName(event?.branch);
  if (eventBranch) return eventBranch;

  const historyBranch = headHistoryBranch(dbPath, project, observedAt);
  if (historyBranch) return historyBranch;

  return normalizeBranchName(session?.branch);
}

function eventTokenTotal(event) {
  const explicit = toFiniteNumber(event?.delta_tokens);
  if (explicit != null) return Math.trunc(explicit);
  return (
    toInteger(event?.input_tokens) +
    toInteger(event?.cached_input_tokens) +
    toInteger(event?.cache_creation_input_tokens) +
    toInteger(event?.output_tokens) +
    toInteger(event?.reasoning_output_tokens)
  );
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function baseTimestamps(session) {
  const first = session.started_at || session.last_observed_at || session.ended_at || new Date().toISOString();
  const last = session.last_observed_at || session.ended_at || session.started_at || first;
  return { first, last };
}

function buildSyntheticGroup(session, { dbPath, provider, session_id }) {
  const project = projectShape(session, provider, session_id);
  const when = session.last_observed_at || session.ended_at || session.started_at || null;
  const resolvedBranch = factBranch({ dbPath, project, observedAt: when, event: null, session });
  const display = branchUsageDisplayBranch({ branch: resolvedBranch, project });
  const times = baseTimestamps(session);

  return {
    scope_key: project.scope_key,
    project_state: project.project_state,
    project_key: project.project_key,
    project_ref: project.project_ref,
    cwd: project.cwd,
    repo_root: project.repo_root,
    repo_common_dir: project.repo_common_dir,
    parent_repo: project.parent_repo,
    branch: display.branch,
    attribution_branch: display.branch_kind === 'known' ? display.branch : null,
    branch_kind: display.branch_kind,
    branch_resolution_tier: session.branch_resolution_tier || null,
    confidence: display.confidence,
    model: isNonEmptyString(session.model) ? session.model.trim() : 'unknown',
    first_observed_at: times.first,
    last_observed_at: times.last,
    event_count: 0,
    total_tokens: toInteger(session.total_tokens),
    input_tokens: toInteger(session.input_tokens),
    cached_input_tokens: toInteger(session.cached_input_tokens),
    cache_creation_input_tokens: toInteger(session.cache_creation_input_tokens),
    output_tokens: toInteger(session.output_tokens),
    reasoning_output_tokens: toInteger(session.reasoning_output_tokens),
    conversation_count: 0,
    total_cost_usd: null,
    cost_estimated: 1,
    cost_quality: session.cost_quality || 'partial_unknown',
    token_reconciled: 0,
    cost_reconciled: 0,
  };
}

function buildEventGroups(session, events, { dbPath, provider, session_id }) {
  const groups = new Map();

  for (const event of events) {
    const project = projectShape(mergeProjectRow(event, session), provider, session_id);
    const observedAt = isNonEmptyString(event.observed_at)
      ? event.observed_at
      : session.last_observed_at || session.ended_at || session.started_at;
    const resolvedBranch = factBranch({ dbPath, project, observedAt, event, session });
    const display = branchUsageDisplayBranch({ branch: resolvedBranch, project });
    const model = isNonEmptyString(event.model)
      ? event.model.trim()
      : isNonEmptyString(session.model)
        ? session.model.trim()
        : 'unknown';

    const key = [project.scope_key, display.branch, display.branch_kind, model].join('\u241f');
    if (!groups.has(key)) {
      groups.set(key, {
        scope_key: project.scope_key,
        project_state: project.project_state,
        project_key: project.project_key,
        project_ref: project.project_ref,
        cwd: project.cwd,
        repo_root: project.repo_root,
        repo_common_dir: project.repo_common_dir,
        parent_repo: project.parent_repo,
        branch: display.branch,
        attribution_branch: display.branch_kind === 'known' ? display.branch : null,
        branch_kind: display.branch_kind,
        branch_resolution_tier: event.branch_resolution_tier || session.branch_resolution_tier || null,
        confidence: display.confidence,
        model,
        first_observed_at: observedAt,
        last_observed_at: observedAt,
        event_count: 0,
        total_tokens: 0,
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
        total_cost_usd: null,
        cost_estimated: 1,
        cost_quality: 'partial_unknown',
        token_reconciled: 0,
        cost_reconciled: 0,
      });
    }

    const group = groups.get(key);
    group.first_observed_at = minIso(group.first_observed_at, observedAt);
    group.last_observed_at = maxIso(group.last_observed_at, observedAt);
    group.event_count += 1;
    group.total_tokens += eventTokenTotal(event);
    group.input_tokens += toInteger(event.input_tokens);
    group.cached_input_tokens += toInteger(event.cached_input_tokens);
    group.cache_creation_input_tokens += toInteger(event.cache_creation_input_tokens);
    group.output_tokens += toInteger(event.output_tokens);
    group.reasoning_output_tokens += toInteger(event.reasoning_output_tokens);
    group.conversation_count += toInteger(event.conversation_count);
  }

  return Array.from(groups.values());
}

function maxTokenGroupIndex(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return -1;
  let index = 0;
  for (let i = 1; i < groups.length; i += 1) {
    if (groups[i].total_tokens > groups[index].total_tokens) {
      index = i;
    }
  }
  return index;
}

function reconcileGroupTokens(groups, session) {
  const sessionTokens = toFiniteNumber(session?.total_tokens);
  if (sessionTokens == null || !Array.isArray(groups) || groups.length === 0) return;

  const sessionTotal = Math.trunc(sessionTokens);
  const current = groups.reduce((sum, group) => sum + toInteger(group.total_tokens), 0);
  const delta = sessionTotal - current;
  if (delta === 0) return;

  if (delta > 0) {
    const target = maxTokenGroupIndex(groups);
    if (target < 0) return;
    groups[target].total_tokens += delta;
    groups[target].token_reconciled = 1;
    return;
  }

  let remaining = Math.abs(delta);
  const indices = groups
    .map((group, index) => ({ index, total_tokens: Math.max(0, toInteger(group.total_tokens)) }))
    .sort((a, b) => b.total_tokens - a.total_tokens)
    .map((entry) => entry.index);

  for (const index of indices) {
    if (remaining <= 0) break;
    const available = Math.max(0, toInteger(groups[index].total_tokens));
    if (available === 0) continue;
    const take = Math.min(available, remaining);
    groups[index].total_tokens = available - take;
    groups[index].token_reconciled = 1;
    remaining -= take;
  }

  for (const group of groups) {
    if (group.total_tokens < 0) {
      group.total_tokens = 0;
      group.token_reconciled = 1;
    }
  }
}

function allocateStoredSessionCost(groups, session) {
  const totalCost = toFiniteNumber(session?.total_cost_usd);
  if (totalCost == null || !Array.isArray(groups) || groups.length === 0) return false;

  const tokenBase = groups.reduce((sum, group) => sum + Math.max(0, toInteger(group.total_tokens)), 0);
  const largestIndex = maxTokenGroupIndex(groups);

  let assigned = 0;
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (i === largestIndex) continue;
    const share = tokenBase > 0 ? totalCost * (Math.max(0, group.total_tokens) / tokenBase) : 0;
    group.total_cost_usd = roundCost(share);
    assigned += group.total_cost_usd;
    group.cost_estimated = 0;
    group.cost_quality = 'stored';
    group.cost_reconciled = 1;
  }

  const largest = groups[largestIndex];
  largest.total_cost_usd = roundCost(totalCost - assigned);
  largest.cost_estimated = 0;
  largest.cost_quality = 'stored';
  largest.cost_reconciled = 1;

  return true;
}

function estimateGroupCosts(groups, session) {
  for (const group of groups) {
    const resolved = resolveUsageCost({
      source: session.provider,
      model: group.model,
      total_tokens: group.total_tokens,
      input_tokens: group.input_tokens,
      cached_input_tokens: group.cached_input_tokens,
      cache_creation_input_tokens: group.cache_creation_input_tokens,
      output_tokens: group.output_tokens,
      reasoning_output_tokens: group.reasoning_output_tokens,
      stored_cost_usd: null,
      stored_cost_is_authoritative: false,
    });
    group.total_cost_usd = resolved.total_cost_usd;
    group.cost_estimated = resolved.cost_estimated ? 1 : 0;
    group.cost_quality = resolved.cost_quality || 'partial_unknown';
    group.cost_reconciled = 0;
  }
}

function readSession(db, { provider, session_id }) {
  return (
    db
      .prepare(
        `
        SELECT *
        FROM vibedeck_sessions
        WHERE provider = ? AND session_id = ?
        `,
      )
      .get(provider, session_id) || null
  );
}

function readUpdateEvents(db, { provider, session_id }) {
  return db
    .prepare(
      `
      SELECT *
      FROM vibedeck_session_events
      WHERE provider = ? AND session_id = ? AND kind = 'update'
      ORDER BY observed_at ASC, event_key ASC
      `,
    )
    .all(provider, session_id);
}

function persistSessionRepoMetadata(db, { provider, session_id, repo } = {}) {
  if (!repo || typeof repo !== 'object') return 0;
  if (!isNonEmptyString(provider) || !isNonEmptyString(session_id)) return 0;
  if (!isNonEmptyString(repo.repo_root)) return 0;

  const now = new Date().toISOString();
  return db
    .prepare(
      `
      UPDATE vibedeck_sessions
      SET repo_root = ?, repo_common_dir = ?, parent_repo = ?, updated_at = ?
      WHERE provider = ? AND session_id = ?
      `,
    )
    .run(
      repo.repo_root.trim(),
      isNonEmptyString(repo.repo_common_dir) ? repo.repo_common_dir.trim() : null,
      isNonEmptyString(repo.parent_repo) ? repo.parent_repo.trim() : null,
      now,
      provider,
      session_id,
    ).changes;
}

function insertFacts(db, session, groups) {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `
    INSERT INTO vibedeck_branch_usage_facts (
      provider, session_id,
      scope_key, project_state, project_key, project_ref,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, attribution_branch, branch_kind,
      branch_resolution_tier, confidence, model,
      first_observed_at, last_observed_at,
      event_count, total_tokens,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count,
      total_cost_usd, cost_estimated, cost_quality,
      token_reconciled, cost_reconciled,
      created_at, updated_at
    ) VALUES (
      @provider, @session_id,
      @scope_key, @project_state, @project_key, @project_ref,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @attribution_branch, @branch_kind,
      @branch_resolution_tier, @confidence, @model,
      @first_observed_at, @last_observed_at,
      @event_count, @total_tokens,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @conversation_count,
      @total_cost_usd, @cost_estimated, @cost_quality,
      @token_reconciled, @cost_reconciled,
      @created_at, @updated_at
    )
    `,
  );

  for (const group of groups) {
    stmt.run({
      provider: session.provider,
      session_id: session.session_id,
      ...group,
      created_at: now,
      updated_at: now,
    });
  }
}

function rebuildBranchUsageFactsForSession(db, { dbPath, provider, session_id } = {}) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('rebuildBranchUsageFactsForSession: db must be a writable sqlite connection');
  }
  if (!isNonEmptyString(dbPath)) {
    throw new TypeError('rebuildBranchUsageFactsForSession: dbPath must be a non-empty string');
  }
  if (!isNonEmptyString(provider)) {
    throw new TypeError('rebuildBranchUsageFactsForSession: provider must be a non-empty string');
  }
  if (!isNonEmptyString(session_id)) {
    throw new TypeError('rebuildBranchUsageFactsForSession: session_id must be a non-empty string');
  }

  db.prepare('DELETE FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?').run(provider, session_id);

  const session = readSession(db, { provider, session_id });
  if (!session) return 0;

  const events = readUpdateEvents(db, { provider, session_id });
  const groups = events.length > 0
    ? buildEventGroups(session, events, { dbPath, provider, session_id })
    : [buildSyntheticGroup(session, { dbPath, provider, session_id })];

  reconcileGroupTokens(groups, session);
  if (!allocateStoredSessionCost(groups, session)) {
    estimateGroupCosts(groups, session);
  }

  insertFacts(db, session, groups);
  return groups.length;
}

function rebuildAllBranchUsageFacts(dbPath, { provider = null, onProgress = null } = {}) {
  if (!isNonEmptyString(dbPath)) {
    throw new TypeError('rebuildAllBranchUsageFacts: dbPath must be a non-empty string');
  }
  const progress = typeof onProgress === 'function' ? onProgress : null;
  const db = new DatabaseSync(dbPath);
  try {
    const rows = provider
      ? db.prepare('SELECT provider, session_id FROM vibedeck_sessions WHERE provider = ? ORDER BY started_at ASC').all(provider)
      : db.prepare('SELECT provider, session_id FROM vibedeck_sessions ORDER BY started_at ASC').all();

    db.exec('BEGIN IMMEDIATE');
    try {
      let rebuilt = 0;
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        rebuilt += rebuildBranchUsageFactsForSession(db, { dbPath, provider: row.provider, session_id: row.session_id });
        progress?.({
          index: index + 1,
          total: rows.length,
          provider: row.provider,
          session_id: row.session_id,
          factsRebuilt: rebuilt,
        });
      }
      db.exec('COMMIT');
      return rebuilt;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function repairMissingProjectAttribution(dbPath, { provider = null, onProgress = null } = {}) {
  if (!isNonEmptyString(dbPath) || !fs.existsSync(dbPath)) return 0;

  const progress = typeof onProgress === 'function' ? onProgress : null;
  const db = new DatabaseSync(dbPath);
  try {
    const rows = provider
      ? db
          .prepare(
            `
            SELECT s.provider, s.session_id, s.cwd, s.repo_root
            FROM vibedeck_sessions s
            LEFT JOIN vibedeck_branch_usage_facts f
              ON f.provider = s.provider AND f.session_id = s.session_id
            WHERE s.provider = ?
              AND s.cwd IS NOT NULL
              AND TRIM(s.cwd) <> ''
            GROUP BY s.provider, s.session_id
            HAVING TRIM(COALESCE(s.repo_root, '')) = '' OR COUNT(f.provider) = 0
            `,
          )
          .all(provider)
      : db
          .prepare(
            `
            SELECT s.provider, s.session_id, s.cwd, s.repo_root
            FROM vibedeck_sessions s
            LEFT JOIN vibedeck_branch_usage_facts f
              ON f.provider = s.provider AND f.session_id = s.session_id
            WHERE s.cwd IS NOT NULL
              AND TRIM(s.cwd) <> ''
            GROUP BY s.provider, s.session_id
            HAVING TRIM(COALESCE(s.repo_root, '')) = '' OR COUNT(f.provider) = 0
            `,
          )
          .all();

    db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < rows.length; index++) {
        const row = rows[index];
        if (isNonEmptyString(row.cwd)) {
          let repo = null;
          try {
            repo = resolveRepo(row.cwd);
          } catch {
            repo = null;
          }
          if (repo && isNonEmptyString(repo.repo_root)) {
            persistSessionRepoMetadata(db, {
              provider: row.provider,
              session_id: row.session_id,
              repo,
            });
          }
        }

        rebuildBranchUsageFactsForSession(db, {
          dbPath,
          provider: row.provider,
          session_id: row.session_id,
        });
        progress?.({
          index: index + 1,
          total: rows.length,
          provider: row.provider,
          session_id: row.session_id,
          cwd: row.cwd || null,
        });
      }
      db.exec('COMMIT');
      return rows.length;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

function readBranchUsageFactRows(
  dbPath,
  {
    from = null,
    to = null,
    repo = null,
    branch = null,
    sourceFilter = null,
    includeArchived = false,
    includeUnattributed = false,
  } = {},
) {
  if (!isNonEmptyString(dbPath) || !fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const clauses = [];
    const params = {};

    const states = includeArchived
      ? ['git_existing', 'non_git_existing', 'git_missing', 'cwd_missing']
      : ['git_existing', 'non_git_existing'];
    const stateExpr = states.map((_, index) => `@state_${index}`).join(', ');
    states.forEach((value, index) => {
      params[`state_${index}`] = value;
    });
    clauses.push(`project_state IN (${stateExpr})`);

    if (includeUnattributed) {
      clauses[clauses.length - 1] = `(${clauses[clauses.length - 1]} OR project_state = 'unattributed')`;
    }

    if (isNonEmptyString(from)) {
      clauses.push('last_observed_at >= @from');
      params.from = from;
    }
    if (isNonEmptyString(to)) {
      clauses.push('first_observed_at <= @to');
      params.to = to;
    }
    if (isNonEmptyString(repo)) {
      clauses.push('COALESCE(repo_root, project_ref, cwd) = @repo');
      params.repo = repo;
    }
    if (isNonEmptyString(branch)) {
      clauses.push('branch = @branch');
      params.branch = normalizeBranchName(branch) || branch.trim();
    }
    const providerFilters = sourceFilterValues(sourceFilter);
    if (providerFilters.length === 1) {
      clauses.push('LOWER(provider) = @sourceFilter_0');
      params.sourceFilter_0 = providerFilters[0];
    } else if (providerFilters.length > 1) {
      const filterExpr = providerFilters.map((_, index) => `@sourceFilter_${index}`).join(', ');
      clauses.push(`LOWER(provider) IN (${filterExpr})`);
      providerFilters.forEach((name, index) => {
        params[`sourceFilter_${index}`] = name;
      });
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return db
      .prepare(
        `
        SELECT *
        FROM vibedeck_branch_usage_facts
        ${where}
        ORDER BY last_observed_at ASC, first_observed_at ASC, provider ASC, session_id ASC, branch ASC, model ASC
        `,
      )
      .all(params);
  } finally {
    db.close();
  }
}

module.exports = {
  rebuildBranchUsageFactsForSession,
  rebuildAllBranchUsageFacts,
  repairMissingProjectAttribution,
  readBranchUsageFactRows,
  branchUsageDisplayBranch,
  normalizeBranchName,
};
    function sourceFilterValues(value) {
      if (isNonEmptyString(value)) return [value.trim().toLowerCase()];
      if (Array.isArray(value)) {
        return Array.from(
          new Set(
            value
              .filter((entry) => isNonEmptyString(entry))
              .map((entry) => entry.trim().toLowerCase()),
          ),
        );
      }
      if (value instanceof Set) {
        return Array.from(
          new Set(
            Array.from(value)
              .filter((entry) => isNonEmptyString(entry))
              .map((entry) => entry.trim().toLowerCase()),
          ),
        );
      }
      return [];
    }
