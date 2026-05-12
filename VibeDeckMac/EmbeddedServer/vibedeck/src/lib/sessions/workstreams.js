'use strict';

const DEFAULT_NEARBY_MS = 60 * 60 * 1000;
const {
  isSessionEnded,
  sessionActivityIso,
  liveSortIso,
} = require('./activity-state');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseTime(value) {
  if (!isNonEmptyString(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function sessionKey(row) {
  if (!row || !isNonEmptyString(row.provider) || !isNonEmptyString(row.session_id)) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function isActiveSession(row) {
  return !isSessionEnded(row);
}

function attributionBranchName(value) {
  return String(value || '').trim().replace(/~\d+$/, '');
}

function branchName(row) {
  return attributionBranchName(row?.attribution_branch || row?.branch) || 'unattributed';
}

function repoKey(row) {
  const repo = String(row?.repo_root || '').trim();
  if (repo) return `repo:${repo}`;
  const cwd = String(row?.cwd || '').trim();
  if (cwd) return `cwd:${cwd}`;
  return `session:${sessionKey(row) || 'unknown'}`;
}

function repoRoot(row) {
  const repo = String(row?.repo_root || '').trim();
  return repo || null;
}

function sessionStart(row, fallbackNow) {
  return parseTime(row?.started_at) ?? parseTime(row?.created_at) ?? fallbackNow;
}

function sessionEnd(row, fallbackNow) {
  return parseTime(row?.ended_at)
    ?? parseTime(sessionActivityIso(row))
    ?? sessionStart(row, fallbackNow);
}

function overlapsNearby(group, start, end, nearbyMs) {
  return start <= group.window_end + nearbyMs && end >= group.window_start - nearbyMs;
}

function costValue(row) {
  if (['pricing_missing', 'missing_tokens', 'partial_unknown'].includes(String(row?.cost_quality || ''))) return null;
  const n = Number(row?.estimated_total_cost_usd ?? row?.total_cost_usd);
  return Number.isFinite(n) ? n : null;
}

function pickPrimarySession(sessions, fallbackNow) {
  const rows = [...sessions];
  const active = rows.filter(isActiveSession);
  const candidates = active.length > 0 ? active : rows;
  candidates.sort((a, b) => {
    const startDelta = sessionStart(a, fallbackNow) - sessionStart(b, fallbackNow);
    if (startDelta !== 0) return startDelta;
    const durationB = sessionEnd(b, fallbackNow) - sessionStart(b, fallbackNow);
    const durationA = sessionEnd(a, fallbackNow) - sessionStart(a, fallbackNow);
    if (durationB !== durationA) return durationB - durationA;
    return (Number(b?.total_tokens || 0) || 0) - (Number(a?.total_tokens || 0) || 0);
  });
  return candidates[0] || null;
}

function summarizeConfidence(sessions) {
  const keys = sessions.map((row) => String(row?.confidence || '').toLowerCase());
  if (keys.includes('unattributed')) return 'unattributed';
  if (keys.includes('low')) return 'low';
  if (keys.includes('medium')) return 'medium';
  if (keys.includes('high')) return 'high';
  return 'unattributed';
}

function relationshipConfidence(group, branches) {
  if (!group.repo_root) return 'low';
  if (group.sessions.length <= 1) return 'high';
  return branches.length <= 1 ? 'medium' : 'medium';
}

function buildBranchGroups(sessions, fallbackNow) {
  const byBranch = new Map();
  for (const row of sessions) {
    const branch = branchName(row);
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(row);
  }
  return Array.from(byBranch.entries())
    .map(([branch, rows]) => ({
      branch,
      active_session_count: rows.filter(isActiveSession).length,
      recently_completed_count: rows.filter((row) => !isActiveSession(row)).length,
      total_tokens: rows.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0),
      total_cost_usd: rows.reduce((sum, row) => sum + (costValue(row) ?? 0), 0),
      sessions: rows.sort((a, b) => sessionStart(a, fallbackNow) - sessionStart(b, fallbackNow)),
    }))
    .sort((a, b) => {
      if (b.active_session_count !== a.active_session_count) return b.active_session_count - a.active_session_count;
      return a.branch.localeCompare(b.branch);
    });
}

function buildLiveWorkstreams(sessions, options = {}) {
  const rows = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  const nearbyMs = Number.isFinite(Number(options.nearbyMs)) ? Number(options.nearbyMs) : DEFAULT_NEARBY_MS;
  const fallbackNow = parseTime(options.now) ?? Date.now();
  const groups = [];

  for (const row of [...rows].sort((a, b) => sessionStart(a, fallbackNow) - sessionStart(b, fallbackNow))) {
    const key = repoKey(row);
    const start = sessionStart(row, fallbackNow);
    const end = sessionEnd(row, fallbackNow);
    let group = groups.find((candidate) => candidate.key === key && overlapsNearby(candidate, start, end, nearbyMs));
    if (!group) {
      group = {
        key,
        repo_root: repoRoot(row),
        sessions: [],
        window_start: start,
        window_end: end,
      };
      groups.push(group);
    }
    group.sessions.push(row);
    group.window_start = Math.min(group.window_start, start);
    group.window_end = Math.max(group.window_end, end);
    if (!group.repo_root) group.repo_root = repoRoot(row);
  }

  return groups.map((group, index) => {
    const branches = Array.from(new Set(group.sessions.map(branchName))).sort((a, b) => a.localeCompare(b));
    const primary = pickPrimarySession(group.sessions, fallbackNow);
    const activeCount = group.sessions.filter(isActiveSession).length;
    const recentlyCompletedCount = group.sessions.length - activeCount;
    const costValues = group.sessions.map(costValue);
    const unknownCostCount = costValues.filter((value) => value == null).length;
    const knownCost = costValues.reduce((sum, value) => sum + (value ?? 0), 0);
    return {
      id: `ws_${cryptoSafeHash(`${group.key}:${group.window_start}:${index}`)}`,
      repo_root: group.repo_root,
      cwd: group.repo_root ? null : String(group.sessions[0]?.cwd || '').trim() || null,
      branches,
      primary_session: primary,
      sessions: group.sessions,
      branch_groups: buildBranchGroups(group.sessions, fallbackNow),
      active_session_count: activeCount,
      recently_completed_count: recentlyCompletedCount,
      total_tokens: group.sessions.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0),
      total_cost_usd: unknownCostCount > 0 ? null : knownCost,
      known_cost_usd: knownCost,
      cost_unknown_count: unknownCostCount,
      needs_attribution_count: group.sessions.filter((row) => !String(row?.repo_root || '').trim() || !String(row?.branch || '').trim()).length,
      confidence: summarizeConfidence(group.sessions),
      relationship_confidence: relationshipConfidence(group, branches),
      started_at: new Date(group.window_start).toISOString(),
      updated_at: new Date(group.window_end).toISOString(),
    };
  }).sort((a, b) => String(liveSortIso(b.primary_session) || b.updated_at || '').localeCompare(
    String(liveSortIso(a.primary_session) || a.updated_at || ''),
  ));
}

function cryptoSafeHash(value) {
  let hash = 0;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

module.exports = {
  buildLiveWorkstreams,
  isActiveSession,
  branchName,
};
