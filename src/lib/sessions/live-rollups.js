'use strict';

const { DatabaseSync } = require('node:sqlite');
const { reapOrphanedSessions } = require('./reaper');
const { getIdleTimeoutMin } = require('./idle-timeout');
const { isSessionEnded, isLiveEligibleSession, liveSortIso } = require('./activity-state');
const { resolveUsageCost } = require('../cost-estimation');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : null;
}

function toIsoFromMs(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function stableHash(value) {
  let hash = 0;
  const source = String(value || '');
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function safeBranch(value) {
  const branch = text(value);
  return branch || 'unattributed';
}

function safeModel(value) {
  const model = text(value);
  return model || 'unknown';
}

function sessionKey(row) {
  return `${text(row?.provider)}:${text(row?.session_id)}`;
}

function projectScopeKey(row) {
  const projectRef = text(row?.parent_repo) || text(row?.repo_common_dir) || text(row?.repo_root);
  if (projectRef) {
    return {
      key: `project:${projectRef}`,
      audit_scope: 'project',
      project_ref: projectRef,
      repo_root: text(row?.repo_root) || projectRef,
      cwd: null,
      project_key: projectRef.split('/').filter(Boolean).pop() || projectRef,
    };
  }

  const repoRoot = text(row?.repo_root);
  if (repoRoot) {
    return {
      key: `repo:${repoRoot}`,
      audit_scope: 'repo_root',
      project_ref: repoRoot,
      repo_root: repoRoot,
      cwd: null,
      project_key: repoRoot.split('/').filter(Boolean).pop() || repoRoot,
    };
  }

  const cwd = text(row?.cwd);
  if (cwd) {
    return {
      key: `cwd:${cwd}`,
      audit_scope: 'cwd_only',
      project_ref: cwd,
      repo_root: null,
      cwd,
      project_key: cwd.split('/').filter(Boolean).pop() || cwd,
    };
  }

  const fallback = `${text(row?.provider) || 'unknown'}:${text(row?.session_id) || 'unknown'}`;
  return {
    key: `session:${fallback}`,
    audit_scope: 'session_only',
    project_ref: fallback,
    repo_root: null,
    cwd: null,
    project_key: fallback,
  };
}

function sessionCost(row) {
  const canonicalQuality = text(row?.cost_quality);
  if ((canonicalQuality === 'pricing_missing' || canonicalQuality === 'partial_unknown' || canonicalQuality === 'missing_tokens')
    && row?.total_cost_usd == null) {
    return {
      total_cost_usd: null,
      known_cost_usd: 0,
      unknown_count: 1,
      cost_estimated: true,
      cost_quality: canonicalQuality || 'partial_unknown',
    };
  }
  const storedIsAuthoritative = Number(row?.cost_estimated || 0) === 0 && text(row?.cost_quality) === 'stored';
  const cost = resolveUsageCost({
    stored_cost_usd: row?.total_cost_usd,
    stored_cost_is_authoritative: storedIsAuthoritative,
    model: row?.model,
    source: row?.provider,
    total_tokens: row?.total_tokens,
    input_tokens: row?.input_tokens,
    cached_input_tokens: row?.cached_input_tokens,
    cache_creation_input_tokens: row?.cache_creation_input_tokens,
    output_tokens: row?.output_tokens,
    reasoning_output_tokens: row?.reasoning_output_tokens,
  });
  const total = Number(cost?.total_cost_usd);
  if (!Number.isFinite(total)) {
    return {
      total_cost_usd: null,
      known_cost_usd: 0,
      unknown_count: 1,
      cost_estimated: Boolean(cost?.cost_estimated),
      cost_quality: String(cost?.cost_quality || 'partial_unknown'),
    };
  }
  return {
    total_cost_usd: total,
    known_cost_usd: total,
    unknown_count: 0,
    cost_estimated: Boolean(cost?.cost_estimated),
    cost_quality: String(cost?.cost_quality || 'stored'),
  };
}

function withDisplayCost(row) {
  const cost = sessionCost(row);
  return {
    ...row,
    estimated_total_cost_usd: cost.total_cost_usd,
    cost_estimated: cost.cost_estimated,
    cost_quality: cost.cost_quality,
  };
}

function sumCost(rows) {
  return rows.reduce((acc, row) => {
    const cost = sessionCost(row);
    return {
      total_cost_usd: acc.total_cost_usd + (cost.total_cost_usd ?? 0),
      known_cost_usd: acc.known_cost_usd + cost.known_cost_usd,
      unknown_count: acc.unknown_count + cost.unknown_count,
    };
  }, { total_cost_usd: 0, known_cost_usd: 0, unknown_count: 0 });
}

function factCost(row) {
  const total = row?.total_cost_usd == null ? null : Number(row.total_cost_usd);
  if (!Number.isFinite(total)) {
    return {
      total_cost_usd: null,
      known_cost_usd: 0,
      unknown_count: 1,
      cost_estimated: Boolean(Number(row?.cost_estimated || 0)),
      cost_quality: text(row?.cost_quality) || 'partial_unknown',
    };
  }
  return {
    total_cost_usd: total,
    known_cost_usd: total,
    unknown_count: 0,
    cost_estimated: Boolean(Number(row?.cost_estimated || 0)),
    cost_quality: text(row?.cost_quality) || 'stored',
  };
}

function compareLiveRowsActiveFirst(a, b) {
  const aActive = !isSessionEnded(a);
  const bActive = !isSessionEnded(b);
  if (aActive !== bActive) return aActive ? -1 : 1;
  return String(liveSortIso(b) || '').localeCompare(String(liveSortIso(a) || ''));
}

function uniqueSortedSessions(sessionMap) {
  return Array.from(sessionMap.values()).sort(compareLiveRowsActiveFirst);
}

function addSessionToSet(set, row) {
  set.add(sessionKey(row));
}

function addContributionToBreakdown(entry, { tokens, cost, session, active }) {
  entry.audit_total_tokens += tokens;
  entry.audit_known_cost_usd += cost.known_cost_usd;
  entry.audit_cost_unknown_count += cost.unknown_count;
  addSessionToSet(entry.audit_session_keys, session);

  if (active) {
    entry.active_total_tokens += tokens;
    entry.active_known_cost_usd += cost.known_cost_usd;
    entry.active_cost_unknown_count += cost.unknown_count;
    addSessionToSet(entry.active_session_keys, session);
  } else if (isSessionEnded(session)) {
    addSessionToSet(entry.recently_completed_keys, session);
  }
}

function finalizeFactBreakdown(entry) {
  return {
    ...entry,
    session_count: entry.audit_session_keys.size,
    active_total_cost_usd: entry.active_cost_unknown_count > 0 ? null : entry.active_known_cost_usd,
    audit_total_cost_usd: entry.audit_cost_unknown_count > 0 ? null : entry.audit_known_cost_usd,
  };
}

function createFactBreakdown(fields) {
  return {
    ...fields,
    session_count: 0,
    active_total_tokens: 0,
    audit_total_tokens: 0,
    active_total_cost_usd: 0,
    audit_total_cost_usd: 0,
    active_known_cost_usd: 0,
    audit_known_cost_usd: 0,
    active_cost_unknown_count: 0,
    audit_cost_unknown_count: 0,
    active_session_keys: new Set(),
    audit_session_keys: new Set(),
    recently_completed_keys: new Set(),
  };
}

function sortTime(row) {
  return row?.last_observed_at || row?.first_observed_at || liveSortIso(row) || '';
}

function buildFactsBySessionKey(branchFacts) {
  const factsBySessionKey = new Map();
  for (const fact of Array.isArray(branchFacts) ? branchFacts : []) {
    const key = sessionKey(fact);
    if (key === ':') continue;
    if (!factsBySessionKey.has(key)) factsBySessionKey.set(key, []);
    factsBySessionKey.get(key).push(fact);
  }
  return factsBySessionKey;
}

function buildEffectiveBranchGroups(rows, factsBySessionKey, activeSessionKeys, visibleSessionKeys = null) {
  const byBranch = new Map();

  function addContribution({ branch, provider, model, tokens, cost, session, sourceRow }) {
    const key = sessionKey(session);
    const active = activeSessionKeys.has(key);

    if (!byBranch.has(branch)) {
      byBranch.set(branch, {
        branch,
        active_session_count: 0,
        recently_completed_count: 0,
        audit_session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
        active_session_keys: new Set(),
        audit_session_keys: new Set(),
        recently_completed_keys: new Set(),
        providers: new Map(),
        models: new Map(),
        sessions: new Map(),
        newest_active_ms: 0,
        newest_audit_ms: 0,
      });
    }

    const branchEntry = byBranch.get(branch);
    const sessionMs = toMs(liveSortIso(session)) || 0;
    const sourceMs = toMs(sortTime(sourceRow)) || 0;
    if (!visibleSessionKeys || visibleSessionKeys.has(key)) {
      branchEntry.sessions.set(key, session);
    }
    branchEntry.audit_session_keys.add(key);
    branchEntry.audit_total_tokens += tokens;
    branchEntry.audit_known_cost_usd += cost.known_cost_usd;
    branchEntry.audit_cost_unknown_count += cost.unknown_count;
    branchEntry.newest_audit_ms = Math.max(branchEntry.newest_audit_ms, sessionMs, sourceMs);

    if (active) {
      branchEntry.active_session_keys.add(key);
      branchEntry.active_total_tokens += tokens;
      branchEntry.active_known_cost_usd += cost.known_cost_usd;
      branchEntry.active_cost_unknown_count += cost.unknown_count;
      branchEntry.newest_active_ms = Math.max(branchEntry.newest_active_ms, sessionMs, sourceMs);
    } else if (isSessionEnded(session)) {
      branchEntry.recently_completed_keys.add(key);
    }

    if (!branchEntry.providers.has(provider)) {
      branchEntry.providers.set(provider, createFactBreakdown({ provider }));
    }
    if (!branchEntry.models.has(model)) {
      branchEntry.models.set(model, createFactBreakdown({ model }));
    }
    addContributionToBreakdown(branchEntry.providers.get(provider), { tokens, cost, session, active });
    addContributionToBreakdown(branchEntry.models.get(model), { tokens, cost, session, active });
  }

  for (const session of rows) {
    const facts = factsBySessionKey.get(sessionKey(session));
    if (facts && facts.length > 0) {
      for (const fact of facts) {
        addContribution({
          branch: safeBranch(fact?.branch),
          provider: text(fact?.provider) || 'unknown',
          model: safeModel(fact?.model),
          tokens: Number(fact?.total_tokens || 0) || 0,
          cost: factCost(fact),
          session,
          sourceRow: fact,
        });
      }
      continue;
    }

    addContribution({
      branch: safeBranch(session?.branch),
      provider: text(session?.provider) || 'unknown',
      model: safeModel(session?.model),
      tokens: Number(session?.total_tokens || 0) || 0,
      cost: sessionCost(session),
      session,
      sourceRow: session,
    });
  }

  return Array.from(byBranch.values())
    .map((row) => ({
      branch: row.branch,
      active_session_count: row.active_session_keys.size,
      recently_completed_count: row.recently_completed_keys.size,
      audit_session_count: row.audit_session_keys.size,
      active_total_tokens: row.active_total_tokens,
      audit_total_tokens: row.audit_total_tokens,
      active_known_cost_usd: row.active_known_cost_usd,
      audit_known_cost_usd: row.audit_known_cost_usd,
      active_cost_unknown_count: row.active_cost_unknown_count,
      audit_cost_unknown_count: row.audit_cost_unknown_count,
      active_total_cost_usd: row.active_cost_unknown_count > 0 ? null : row.active_known_cost_usd,
      audit_total_cost_usd: row.audit_cost_unknown_count > 0 ? null : row.audit_known_cost_usd,
      providers: Array.from(row.providers.values())
        .map((providerRow) => {
          const finalized = finalizeFactBreakdown(providerRow);
          const {
            active_session_keys,
            audit_session_keys,
            recently_completed_keys,
            ...payload
          } = finalized;
          return payload;
        })
        .sort((a, b) => a.provider.localeCompare(b.provider)),
      models: Array.from(row.models.values())
        .map((modelRow) => {
          const finalized = finalizeFactBreakdown(modelRow);
          const {
            active_session_keys,
            audit_session_keys,
            recently_completed_keys,
            ...payload
          } = finalized;
          return payload;
        })
        .sort((a, b) => a.model.localeCompare(b.model)),
      sessions: uniqueSortedSessions(row.sessions),
      newest_active_ms: row.newest_active_ms,
      newest_audit_ms: row.newest_audit_ms,
    }))
    .sort((a, b) => {
      const aHasActive = a.active_session_count > 0;
      const bHasActive = b.active_session_count > 0;
      if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
      if (a.newest_active_ms !== b.newest_active_ms) return b.newest_active_ms - a.newest_active_ms;
      if (a.newest_audit_ms !== b.newest_audit_ms) return b.newest_audit_ms - a.newest_audit_ms;
      return a.branch.localeCompare(b.branch);
    })
    .map(({ newest_active_ms, newest_audit_ms, ...row }) => row);
}

function buildBreakdowns(rows, activeRows) {
  const byProvider = new Map();
  const byModel = new Map();
  const byBranch = new Map();

  for (const row of rows) {
    const provider = text(row?.provider) || 'unknown';
    const model = safeModel(row?.model);
    const branch = safeBranch(row?.branch);
    const tokens = Number(row?.total_tokens || 0) || 0;
    const cost = sessionCost(row);
    const active = activeRows.includes(row);

    if (!byProvider.has(provider)) {
      byProvider.set(provider, {
        provider,
        session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      });
    }
    if (!byModel.has(model)) {
      byModel.set(model, {
        model,
        session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      });
    }
    if (!byBranch.has(branch)) {
      byBranch.set(branch, {
        branch,
        active_session_count: 0,
        recently_completed_count: 0,
        audit_session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
        providers: new Map(),
        models: new Map(),
        sessions: [],
      });
    }

    const p = byProvider.get(provider);
    p.session_count += 1;
    p.audit_total_tokens += tokens;
    p.audit_total_cost_usd += cost.total_cost_usd ?? 0;
    p.audit_known_cost_usd += cost.known_cost_usd;
    p.audit_cost_unknown_count += cost.unknown_count;
    if (active) p.active_total_tokens += tokens;
    if (active) p.active_total_cost_usd += cost.total_cost_usd ?? 0;
    if (active) p.active_known_cost_usd += cost.known_cost_usd;
    if (active) p.active_cost_unknown_count += cost.unknown_count;

    const m = byModel.get(model);
    m.session_count += 1;
    m.audit_total_tokens += tokens;
    m.audit_total_cost_usd += cost.total_cost_usd ?? 0;
    m.audit_known_cost_usd += cost.known_cost_usd;
    m.audit_cost_unknown_count += cost.unknown_count;
    if (active) m.active_total_tokens += tokens;
    if (active) m.active_total_cost_usd += cost.total_cost_usd ?? 0;
    if (active) m.active_known_cost_usd += cost.known_cost_usd;
    if (active) m.active_cost_unknown_count += cost.unknown_count;

    const b = byBranch.get(branch);
    b.audit_session_count += 1;
    b.audit_total_tokens += tokens;
    b.audit_total_cost_usd += cost.total_cost_usd ?? 0;
    b.audit_known_cost_usd += cost.known_cost_usd;
    b.audit_cost_unknown_count += cost.unknown_count;
    b.sessions.push(row);
    if (!b.providers.has(provider)) {
      b.providers.set(provider, {
        provider,
        session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      });
    }
    if (!b.models.has(model)) {
      b.models.set(model, {
        model,
        session_count: 0,
        active_total_tokens: 0,
        audit_total_tokens: 0,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 0,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 0,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      });
    }

    const bp = b.providers.get(provider);
    bp.session_count += 1;
    bp.audit_total_tokens += tokens;
    bp.audit_total_cost_usd += cost.total_cost_usd ?? 0;
    bp.audit_known_cost_usd += cost.known_cost_usd;
    bp.audit_cost_unknown_count += cost.unknown_count;

    const bm = b.models.get(model);
    bm.session_count += 1;
    bm.audit_total_tokens += tokens;
    bm.audit_total_cost_usd += cost.total_cost_usd ?? 0;
    bm.audit_known_cost_usd += cost.known_cost_usd;
    bm.audit_cost_unknown_count += cost.unknown_count;

    if (active) {
      b.active_session_count += 1;
      b.active_total_tokens += tokens;
      b.active_total_cost_usd += cost.total_cost_usd ?? 0;
      b.active_known_cost_usd += cost.known_cost_usd;
      b.active_cost_unknown_count += cost.unknown_count;
      bp.active_total_tokens += tokens;
      bp.active_total_cost_usd += cost.total_cost_usd ?? 0;
      bp.active_known_cost_usd += cost.known_cost_usd;
      bp.active_cost_unknown_count += cost.unknown_count;
      bm.active_total_tokens += tokens;
      bm.active_total_cost_usd += cost.total_cost_usd ?? 0;
      bm.active_known_cost_usd += cost.known_cost_usd;
      bm.active_cost_unknown_count += cost.unknown_count;
    } else if (isSessionEnded(row)) {
      b.recently_completed_count += 1;
    }
  }

  return {
    providers: Array.from(byProvider.values())
      .map((row) => ({
        ...row,
        active_total_cost_usd: row.active_cost_unknown_count > 0 ? null : row.active_known_cost_usd,
        audit_total_cost_usd: row.audit_cost_unknown_count > 0 ? null : row.audit_known_cost_usd,
      }))
      .sort((a, b) => a.provider.localeCompare(b.provider)),
    models: Array.from(byModel.values())
      .map((row) => ({
        ...row,
        active_total_cost_usd: row.active_cost_unknown_count > 0 ? null : row.active_known_cost_usd,
        audit_total_cost_usd: row.audit_cost_unknown_count > 0 ? null : row.audit_known_cost_usd,
      }))
      .sort((a, b) => a.model.localeCompare(b.model)),
    branch_groups: Array.from(byBranch.values())
      .map((row) => ({
        branch: row.branch,
        active_session_count: row.active_session_count,
        recently_completed_count: row.recently_completed_count,
        audit_session_count: row.audit_session_count,
        active_total_tokens: row.active_total_tokens,
        audit_total_tokens: row.audit_total_tokens,
        active_known_cost_usd: row.active_known_cost_usd,
        audit_known_cost_usd: row.audit_known_cost_usd,
        active_cost_unknown_count: row.active_cost_unknown_count,
        audit_cost_unknown_count: row.audit_cost_unknown_count,
        active_total_cost_usd: row.active_cost_unknown_count > 0 ? null : row.active_known_cost_usd,
        audit_total_cost_usd: row.audit_cost_unknown_count > 0 ? null : row.audit_known_cost_usd,
        providers: Array.from(row.providers.values())
          .map((providerRow) => ({
            ...providerRow,
            active_total_cost_usd: providerRow.active_cost_unknown_count > 0 ? null : providerRow.active_known_cost_usd,
            audit_total_cost_usd: providerRow.audit_cost_unknown_count > 0 ? null : providerRow.audit_known_cost_usd,
          }))
          .sort((a, b) => a.provider.localeCompare(b.provider)),
        models: Array.from(row.models.values())
          .map((modelRow) => ({
            ...modelRow,
            active_total_cost_usd: modelRow.active_cost_unknown_count > 0 ? null : modelRow.active_known_cost_usd,
            audit_total_cost_usd: modelRow.audit_cost_unknown_count > 0 ? null : modelRow.audit_known_cost_usd,
          }))
          .sort((a, b) => a.model.localeCompare(b.model)),
        sessions: row.sessions.sort(compareLiveRowsActiveFirst),
      }))
      .sort((a, b) => {
        const aHasActive = a.active_session_count > 0;
        const bHasActive = b.active_session_count > 0;
        if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
        const aNewestActive = aHasActive
          ? Math.max(...a.sessions.filter((row) => !isSessionEnded(row)).map((row) => toMs(liveSortIso(row)) || 0), 0)
          : 0;
        const bNewestActive = bHasActive
          ? Math.max(...b.sessions.filter((row) => !isSessionEnded(row)).map((row) => toMs(liveSortIso(row)) || 0), 0)
          : 0;
        if (aNewestActive !== bNewestActive) return bNewestActive - aNewestActive;
        const aNewestAudit = Math.max(...a.sessions.map((row) => toMs(liveSortIso(row)) || 0), 0);
        const bNewestAudit = Math.max(...b.sessions.map((row) => toMs(liveSortIso(row)) || 0), 0);
        if (aNewestAudit !== bNewestAudit) return bNewestAudit - aNewestAudit;
        return a.branch.localeCompare(b.branch);
      }),
  };
}

function buildLiveAuditRollups(rows, { now = new Date(), idleTimeoutMin, recentEndedMs, branchFacts = [] } = {}) {
  const enrichedRows = (Array.isArray(rows) ? rows : []).map((row) => withDisplayCost(row));
  const nowIso = now instanceof Date ? now.toISOString() : String(now);
  const nowMs = toMs(nowIso) ?? Date.now();
  const timeoutMin = getIdleTimeoutMin(idleTimeoutMin);
  const endedWindowMs = Number.isFinite(Number(recentEndedMs)) ? Number(recentEndedMs) : 60 * 60 * 1000;
  const recentCutoff = nowMs - endedWindowMs;
  const factsBySessionKey = buildFactsBySessionKey(branchFacts);

  const activeSessions = enrichedRows.filter((row) => isLiveEligibleSession(row, { now: nowIso, idleTimeoutMin: timeoutMin }));
  const recentSessions = enrichedRows.filter((row) => {
    if (!isSessionEnded(row)) return false;
    const endedMs = toMs(row?.ended_at);
    return Number.isFinite(endedMs) && endedMs >= recentCutoff;
  });

  const payloadSessions = [...new Map(
    [...activeSessions, ...recentSessions].map((row) => [`${text(row?.provider)}:${text(row?.session_id)}`, row]),
  ).values()].sort((a, b) => String(liveSortIso(b) || '').localeCompare(String(liveSortIso(a) || '')));

  const activeScopes = new Map();
  for (const row of activeSessions) {
    const scope = projectScopeKey(row);
    if (!activeScopes.has(scope.key)) activeScopes.set(scope.key, scope);
  }

  const workstreams = [];
  const auditRowsByScope = new Map();
  for (const row of enrichedRows) {
    const scope = projectScopeKey(row);
    if (!activeScopes.has(scope.key)) continue;
    if (!auditRowsByScope.has(scope.key)) auditRowsByScope.set(scope.key, []);
    auditRowsByScope.get(scope.key).push(row);
  }

  for (const [scopeKey, scope] of activeScopes.entries()) {
    const auditRows = auditRowsByScope.get(scopeKey) || [];
    const scopeActiveRows = auditRows.filter((row) => isLiveEligibleSession(row, { now: nowIso, idleTimeoutMin: timeoutMin }));
    const scopeRecentEnded = auditRows.filter((row) => {
      if (!isSessionEnded(row)) return false;
      const endedMs = toMs(row?.ended_at);
      return Number.isFinite(endedMs) && endedMs >= recentCutoff;
    });
    const scopePayloadRows = [...new Map(
      [...scopeActiveRows, ...scopeRecentEnded].map((row) => [sessionKey(row), row]),
    ).values()].sort((a, b) => String(liveSortIso(b) || '').localeCompare(String(liveSortIso(a) || '')));
    const activeTokens = scopeActiveRows.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0);
    const auditTokens = auditRows.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0);
    const activeCost = sumCost(scopeActiveRows);
    const auditCost = sumCost(auditRows);
    const breakdowns = buildBreakdowns(auditRows, scopeActiveRows);
    const activeSessionKeys = new Set(scopeActiveRows.map((row) => sessionKey(row)));
    const visibleSessionKeys = new Set(scopePayloadRows.map((row) => sessionKey(row)));
    const branchGroups = buildEffectiveBranchGroups(auditRows, factsBySessionKey, activeSessionKeys, visibleSessionKeys);
    const updatedMs = auditRows.reduce((max, row) => Math.max(max, toMs(liveSortIso(row)) || 0), 0);

    workstreams.push({
      id: `project:${stableHash(scopeKey)}`,
      audit_scope: scope.audit_scope,
      project_key: scope.project_key,
      project_ref: scope.project_ref,
      repo_root: scope.repo_root,
      cwd: scope.cwd,
      branches: Array.from(new Set(branchGroups.map((row) => row.branch))).sort((a, b) => a.localeCompare(b)),
      sessions: scopePayloadRows,
      primary_session: scopeActiveRows[0] || scopePayloadRows[0] || auditRows[0] || null,
      active_session_count: scopeActiveRows.length,
      recently_completed_count: scopeRecentEnded.length,
      audit_session_count: auditRows.length,
      active_total_tokens: activeTokens,
      active_total_cost_usd: activeCost.unknown_count > 0 ? null : activeCost.total_cost_usd,
      active_known_cost_usd: activeCost.known_cost_usd,
      active_cost_unknown_count: activeCost.unknown_count,
      audit_total_tokens: auditTokens,
      audit_total_cost_usd: auditCost.unknown_count > 0 ? null : auditCost.total_cost_usd,
      audit_known_cost_usd: auditCost.known_cost_usd,
      audit_cost_unknown_count: auditCost.unknown_count,
      providers: breakdowns.providers,
      models: breakdowns.models,
      branch_groups: branchGroups,
      updated_at: toIsoFromMs(updatedMs),
    });
  }

  workstreams.sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));

  const totals = workstreams.reduce((acc, row) => ({
    active_sessions: acc.active_sessions + row.active_session_count,
    active_projects: acc.active_projects + 1,
    active_tokens: acc.active_tokens + row.active_total_tokens,
    active_known_cost_usd: acc.active_known_cost_usd + row.active_known_cost_usd,
    active_cost_unknown_count: acc.active_cost_unknown_count + row.active_cost_unknown_count,
    audit_tokens: acc.audit_tokens + row.audit_total_tokens,
    audit_known_cost_usd: acc.audit_known_cost_usd + row.audit_known_cost_usd,
    audit_cost_unknown_count: acc.audit_cost_unknown_count + row.audit_cost_unknown_count,
  }), {
    active_sessions: 0,
    active_projects: 0,
    active_tokens: 0,
    active_known_cost_usd: 0,
    active_cost_unknown_count: 0,
    audit_tokens: 0,
    audit_known_cost_usd: 0,
    audit_cost_unknown_count: 0,
  });

  return {
    sessions: payloadSessions,
    active_sessions: activeSessions,
    recent_sessions: recentSessions,
    workstreams,
    totals: {
      ...totals,
      active_cost_usd: totals.active_cost_unknown_count > 0 ? null : totals.active_known_cost_usd,
      audit_cost_usd: totals.audit_cost_unknown_count > 0 ? null : totals.audit_known_cost_usd,
    },
  };
}

function readLiveAuditRollups(dbPath, options = {}) {
  reapOrphanedSessions(dbPath, { now: options.now, idleTimeoutMin: options.idleTimeoutMin });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT * FROM vibedeck_sessions').all();
    let branchFacts = [];
    try {
      const { readBranchUsageFactRows } = require('./branch-usage-facts');
      branchFacts = readBranchUsageFactRows(dbPath, { includeArchived: false, includeUnattributed: false });
    } catch {
      branchFacts = [];
    }
    return buildLiveAuditRollups(rows, { ...options, branchFacts });
  } finally {
    db.close();
  }
}

module.exports = {
  readLiveAuditRollups,
  buildLiveAuditRollups,
  projectScopeKey,
};
