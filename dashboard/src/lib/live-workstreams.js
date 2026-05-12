const NEARBY_MS = 60 * 60 * 1000;

export function liveSessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

export function isActiveLiveSession(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function parseTime(value) {
  if (!value) return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? time : null;
}

function sessionStart(row, now = Date.now()) {
  return parseTime(row?.started_at) ?? parseTime(row?.created_at) ?? now;
}

function sessionActivityAt(row) {
  return row?.last_observed_at || row?.observed_at || row?.ended_at || row?.started_at || row?.created_at || null;
}

function sessionEnd(row, now = Date.now()) {
  return parseTime(row?.ended_at)
    ?? parseTime(sessionActivityAt(row))
    ?? sessionStart(row, now);
}

function repoKey(row) {
  const repo = String(row?.repo_root || "").trim();
  if (repo) return `repo:${repo}`;
  const cwd = String(row?.cwd || "").trim();
  if (cwd) return `cwd:${cwd}`;
  return `session:${liveSessionKey(row) || "unknown"}`;
}

function repoRoot(row) {
  const repo = String(row?.repo_root || "").trim();
  return repo || null;
}

export function attributionBranchName(value) {
  return String(value || "").trim().replace(/~\d+$/, "");
}

function branchName(row) {
  return attributionBranchName(row?.attribution_branch || row?.branch) || "unattributed";
}

function overlapsNearby(group, start, end) {
  return start <= group.windowEnd + NEARBY_MS && end >= group.windowStart - NEARBY_MS;
}

export function liveSessionCost(row) {
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(String(row?.cost_quality || ""))) {
    return null;
  }
  const n = Number(row?.estimated_total_cost_usd ?? row?.total_cost_usd);
  return Number.isFinite(n) ? n : null;
}

function pickPrimarySession(sessions, now) {
  const active = sessions.filter(isActiveLiveSession);
  const candidates = active.length > 0 ? active : sessions;
  return [...candidates].sort((a, b) => {
    const startDelta = sessionStart(a, now) - sessionStart(b, now);
    if (startDelta !== 0) return startDelta;
    const durationDelta = (sessionEnd(b, now) - sessionStart(b, now)) - (sessionEnd(a, now) - sessionStart(a, now));
    if (durationDelta !== 0) return durationDelta;
    return (Number(b?.total_tokens || 0) || 0) - (Number(a?.total_tokens || 0) || 0);
  })[0] || null;
}

function workstreamId(group, index) {
  return `${group.key}:${group.windowStart}:${index}`;
}

function buildBranchGroups(sessions, now) {
  const byBranch = new Map();
  for (const row of sessions) {
    const branch = branchName(row);
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(row);
  }
  return Array.from(byBranch.entries())
    .map(([branch, rows]) => ({
      branch,
      active_session_count: rows.filter(isActiveLiveSession).length,
      recently_completed_count: rows.filter((row) => !isActiveLiveSession(row)).length,
      total_tokens: rows.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0),
      total_cost_usd: rows.reduce((sum, row) => sum + (liveSessionCost(row) ?? 0), 0),
      sessions: [...rows].sort((a, b) => sessionStart(a, now) - sessionStart(b, now)),
    }))
    .sort((a, b) => {
      if (b.active_session_count !== a.active_session_count) return b.active_session_count - a.active_session_count;
      return a.branch.localeCompare(b.branch);
    });
}

export function buildLiveWorkstreams(sessions, { now = Date.now() } = {}) {
  const rows = Array.isArray(sessions) ? sessions.filter(Boolean) : [];
  const groups = [];
  for (const row of [...rows].sort((a, b) => sessionStart(a, now) - sessionStart(b, now))) {
    const key = repoKey(row);
    const start = sessionStart(row, now);
    const end = sessionEnd(row, now);
    let group = groups.find((candidate) => candidate.key === key && overlapsNearby(candidate, start, end));
    if (!group) {
      group = { key, repo_root: repoRoot(row), sessions: [], windowStart: start, windowEnd: end };
      groups.push(group);
    }
    group.sessions.push(row);
    group.windowStart = Math.min(group.windowStart, start);
    group.windowEnd = Math.max(group.windowEnd, end);
    if (!group.repo_root) group.repo_root = repoRoot(row);
  }

  return groups.map((group, index) => {
    const branches = Array.from(new Set(group.sessions.map(branchName))).sort((a, b) => a.localeCompare(b));
    const activeCount = group.sessions.filter(isActiveLiveSession).length;
    const costValues = group.sessions.map(liveSessionCost);
    const costUnknownCount = costValues.filter((value) => value == null).length;
    const knownCost = costValues.reduce((sum, value) => sum + (value ?? 0), 0);
    return {
      id: workstreamId(group, index),
      repo_root: group.repo_root,
      cwd: group.repo_root ? null : String(group.sessions[0]?.cwd || "").trim() || null,
      branches,
      primary_session: pickPrimarySession(group.sessions, now),
      sessions: group.sessions,
      branch_groups: buildBranchGroups(group.sessions, now),
      active_session_count: activeCount,
      recently_completed_count: group.sessions.length - activeCount,
      total_tokens: group.sessions.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0),
      total_cost_usd: costUnknownCount > 0 ? null : knownCost,
      known_cost_usd: knownCost,
      cost_unknown_count: costUnknownCount,
      needs_attribution_count: group.sessions.filter((row) => !String(row?.repo_root || "").trim() || !String(row?.branch || "").trim()).length,
      started_at: new Date(group.windowStart).toISOString(),
      updated_at: new Date(group.windowEnd).toISOString(),
    };
  }).sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}
