'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function readSessionGroupingMode(env = process.env) {
  const raw = text(env?.VIBEDECK_SESSION_GROUPING_V1).toLowerCase();
  if (raw === 'off' || raw === 'shadow' || raw === 'preview' || raw === 'on') return raw;
  return 'shadow';
}

function groupingVisible(mode = readSessionGroupingMode()) {
  return mode === 'preview' || mode === 'on';
}

function readFirstJsonLine(filePath) {
  if (!text(filePath) || !fs.existsSync(filePath)) return null;
  let raw = '';
  let fd = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const stat = fs.fstatSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    raw = buffer.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }
  return null;
}

function readJsonFile(filePath) {
  if (!text(filePath) || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function groupId(provider, rootSessionId) {
  return `${provider}:${rootSessionId}`;
}

function skip(provider, childSessionId, reason, extra = {}) {
  return {
    kind: 'skip',
    skip: {
      provider,
      child_session_id: childSessionId,
      skip_reason: reason,
      source_path: childSessionId,
      ...extra,
    },
  };
}

function deriveClaudeGroupEvidence(session) {
  const provider = text(session?.provider).toLowerCase();
  const childSessionId = text(session?.session_id);
  if (provider !== 'claude') return null;
  if (!childSessionId.includes(`${path.sep}subagents${path.sep}`) || !childSessionId.endsWith('.jsonl')) {
    return null;
  }

  const subagentsDir = path.dirname(childSessionId);
  const rootSessionDir = path.dirname(subagentsDir);
  const rootId = path.basename(rootSessionDir);
  const projectDir = path.dirname(rootSessionDir);
  const rootSessionId = path.join(projectDir, `${rootId}.jsonl`);
  if (!fs.existsSync(rootSessionId)) {
    return skip(provider, childSessionId, 'claude_root_session_missing');
  }

  const first = readFirstJsonLine(childSessionId) || {};
  const meta = readJsonFile(childSessionId.replace(/\.jsonl$/, '.meta.json')) || {};
  const agentId = text(first.agentId) || path.basename(childSessionId, '.jsonl').replace(/^agent-/, '') || null;
  const agentRole = text(meta.agentType) || text(first.attributionAgent) || null;
  const agentLabel = text(meta.description) || text(meta.agentType) || (agentId ? `agent-${agentId}` : 'Subagent');
  return {
    kind: 'edge',
    edge: {
      provider,
      session_group_id: groupId(provider, rootSessionId),
      root_session_id: rootSessionId,
      child_session_id: childSessionId,
      root_thread_id: rootId,
      child_thread_id: agentId,
      relation_proof: 'claude_subagent_path',
      depth: 1,
      agent_id: agentId,
      agent_label: agentLabel,
      agent_role: agentRole,
      source_path: childSessionId,
    },
  };
}

function resolveUniqueCodexRootSession(db, provider, parentThreadId, childSessionId) {
  const rows = db
    .prepare(`
      SELECT session_id
      FROM vibedeck_sessions
      WHERE provider = ?
        AND session_id <> ?
        AND (session_id = ? OR session_id LIKE ?)
      ORDER BY LENGTH(session_id) ASC, session_id ASC
    `)
    .all(provider, childSessionId, parentThreadId, `%${parentThreadId}%`);
  if (rows.length === 1) return { ok: true, session_id: rows[0].session_id };
  if (rows.length === 0) return { ok: false, reason: 'parent_session_missing' };
  return { ok: false, reason: 'parent_session_ambiguous' };
}

function deriveCodexGroupEvidence(dbPath, session) {
  const provider = text(session?.provider).toLowerCase();
  const childSessionId = text(session?.session_id);
  if (provider !== 'codex' && provider !== 'every-code') return null;
  if (!childSessionId.endsWith('.jsonl')) return null;
  const first = readFirstJsonLine(childSessionId);
  if (first?.type !== 'session_meta') return null;
  const payload = first?.payload && typeof first.payload === 'object' ? first.payload : {};
  const spawn = payload?.source?.subagent?.thread_spawn || {};
  const isSubagent = payload.thread_source === 'subagent' || !!payload?.source?.subagent;
  if (!isSubagent) return null;
  const childThreadId = text(payload.id) || null;
  const parentThreadId = text(spawn.parent_thread_id);
  if (!parentThreadId) {
    return skip(provider, childSessionId, 'missing_parent_thread_id', { child_thread_id: childThreadId });
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  let resolved;
  try {
    resolved = resolveUniqueCodexRootSession(db, provider, parentThreadId, childSessionId);
  } finally {
    db.close();
  }
  if (!resolved.ok) {
    return skip(provider, childSessionId, resolved.reason, { child_thread_id: childThreadId });
  }

  const depth = Number.isInteger(spawn.depth) && spawn.depth >= 0 ? spawn.depth : 1;
  const agentLabel = text(payload.agent_nickname) || text(spawn.agent_nickname) || null;
  const agentRole = text(payload.agent_role) || text(spawn.agent_role) || null;
  return {
    kind: 'edge',
    edge: {
      provider,
      session_group_id: groupId(provider, resolved.session_id),
      root_session_id: resolved.session_id,
      child_session_id: childSessionId,
      root_thread_id: parentThreadId,
      child_thread_id: childThreadId,
      relation_proof: 'codex_thread_spawn',
      depth,
      agent_id: childThreadId,
      agent_label: agentLabel,
      agent_role: agentRole,
      source_path: childSessionId,
    },
  };
}

function deriveGroupEvidence(dbPath, session) {
  const provider = text(session?.provider).toLowerCase();
  if (provider === 'claude') return deriveClaudeGroupEvidence(session);
  if (provider === 'codex' || provider === 'every-code') return deriveCodexGroupEvidence(dbPath, session);
  return null;
}

function rebuildSessionGroupProjection(dbPath, { mode = readSessionGroupingMode(), now = new Date().toISOString() } = {}) {
  if (mode === 'off') return { mode, scanned_sessions: 0, edges_written: 0, skips_written: 0 };
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    db.prepare("DELETE FROM vibedeck_session_group_edges WHERE provider IN ('claude', 'codex', 'every-code')").run();
    db.prepare("DELETE FROM vibedeck_session_group_skips WHERE provider IN ('claude', 'codex', 'every-code')").run();
    const sessions = db
      .prepare("SELECT provider, session_id FROM vibedeck_sessions WHERE provider IN ('claude', 'codex', 'every-code') ORDER BY provider, session_id")
      .all();
    const insertEdge = db.prepare(`
      INSERT INTO vibedeck_session_group_edges (
        provider, session_group_id, root_session_id, child_session_id,
        root_thread_id, child_thread_id, relation_proof, depth,
        agent_id, agent_label, agent_role, source_path, created_at, updated_at
      ) VALUES (
        @provider, @session_group_id, @root_session_id, @child_session_id,
        @root_thread_id, @child_thread_id, @relation_proof, @depth,
        @agent_id, @agent_label, @agent_role, @source_path, @created_at, @updated_at
      )
    `);
    const insertSkip = db.prepare(`
      INSERT INTO vibedeck_session_group_skips (
        provider, child_session_id, child_thread_id, skip_reason,
        source_path, observed_at, created_at, updated_at
      ) VALUES (
        @provider, @child_session_id, @child_thread_id, @skip_reason,
        @source_path, @observed_at, @created_at, @updated_at
      )
    `);
    let edgesWritten = 0;
    let skipsWritten = 0;
    for (const session of sessions) {
      const evidence = deriveGroupEvidence(dbPath, session);
      if (!evidence) continue;
      if (evidence.kind === 'edge') {
        insertEdge.run({ ...evidence.edge, created_at: now, updated_at: now });
        edgesWritten += 1;
      } else if (evidence.kind === 'skip') {
        insertSkip.run({ ...evidence.skip, observed_at: now, created_at: now, updated_at: now });
        skipsWritten += 1;
      }
    }
    db.exec('COMMIT');
    return { mode, scanned_sessions: sessions.length, edges_written: edgesWritten, skips_written: skipsWritten };
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  } finally {
    db.close();
  }
}

function readSessionGroupDiagnostics(dbPath) {
  if (!fs.existsSync(dbPath)) {
    return { grouped_child_sessions: 0, skipped_edges: 0, groups_by_provider: {}, skips_by_reason: {} };
  }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const grouped = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_group_edges').get().n || 0;
    const skipped = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_group_skips').get().n || 0;
    const groupsByProvider = {};
    for (const row of db.prepare('SELECT provider, COUNT(DISTINCT session_group_id) AS n FROM vibedeck_session_group_edges GROUP BY provider').all()) {
      groupsByProvider[row.provider] = row.n;
    }
    const skipsByReason = {};
    for (const row of db.prepare('SELECT skip_reason, COUNT(*) AS n FROM vibedeck_session_group_skips GROUP BY skip_reason').all()) {
      skipsByReason[row.skip_reason] = row.n;
    }
    return {
      grouped_child_sessions: grouped,
      skipped_edges: skipped,
      groups_by_provider: groupsByProvider,
      skips_by_reason: skipsByReason,
    };
  } finally {
    db.close();
  }
}

function readGroupEdges(dbPath) {
  if (!fs.existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM vibedeck_session_group_edges ORDER BY provider, session_group_id, child_session_id').all();
  } finally {
    db.close();
  }
}

function sessionKey(row) {
  return `${text(row?.provider).toLowerCase()}:${text(row?.session_id)}`;
}

function numberOrNull(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function minIso(values) {
  const valid = values.map(text).filter(Boolean).sort();
  return valid[0] || null;
}

function maxIso(values) {
  const valid = values.map(text).filter(Boolean).sort();
  return valid.length > 0 ? valid[valid.length - 1] : null;
}

function stableCost(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 1e12) / 1e12;
}

function summarizeGroup(sessionGroupId, root, members, { includeMembers = true } = {}) {
  const tokenTotal = members.reduce((sum, row) => sum + (numberOrNull(row.total_tokens) || 0), 0);
  let knownCostUsd = 0;
  let costUnknownCount = 0;
  const modelMap = new Map();

  for (const row of members) {
    const cost = numberOrNull(row.total_cost_usd);
    if (cost == null) costUnknownCount += 1;
    else knownCostUsd += cost;

    const modelKey = `${text(row.provider).toLowerCase()}:${text(row.model) || 'unknown'}`;
    const model = modelMap.get(modelKey) || {
      provider: text(row.provider).toLowerCase(),
      model: text(row.model) || 'unknown',
      total_tokens: 0,
      total_cost_usd: 0,
      cost_unknown_count: 0,
    };
    model.total_tokens += numberOrNull(row.total_tokens) || 0;
    if (cost == null) model.cost_unknown_count += 1;
    else model.total_cost_usd += cost;
    modelMap.set(modelKey, model);
  }

  const models = Array.from(modelMap.values()).map((model) => ({
    ...model,
    total_cost_usd: model.cost_unknown_count > 0 ? null : stableCost(model.total_cost_usd),
  }));
  const rootSessionId = text(root?.session_id) || text(members[0]?.session_id);

  return {
    session_group_id: sessionGroupId,
    provider: text(root?.provider || members[0]?.provider).toLowerCase(),
    root_session_id: rootSessionId,
    member_count: members.length,
    active_member_count: members.filter((row) => text(row.state).toLowerCase() === 'live' || !text(row.ended_at)).length,
    total_tokens: tokenTotal,
    total_cost_usd: costUnknownCount > 0 ? null : stableCost(knownCostUsd),
    known_cost_usd: stableCost(knownCostUsd),
    cost_unknown_count: costUnknownCount,
    cost_estimated: members.some((row) => Boolean(row.cost_estimated)),
    cost_quality: costUnknownCount > 0 ? 'unknown' : 'stored',
    started_at: minIso(members.map((row) => row.started_at || row.first_observed_at)),
    ended_at: maxIso(members.map((row) => row.ended_at || row.last_observed_at)),
    models,
    members: includeMembers ? members : undefined,
  };
}

function buildSessionGroupsForRows(rows, edges, { includeMembers = true } = {}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const childToEdge = new Map();
  const rootToEdges = new Map();
  for (const edge of Array.isArray(edges) ? edges : []) {
    const childKey = `${text(edge.provider).toLowerCase()}:${text(edge.child_session_id)}`;
    const rootKey = `${text(edge.provider).toLowerCase()}:${text(edge.root_session_id)}`;
    childToEdge.set(childKey, edge);
    if (!rootToEdges.has(rootKey)) rootToEdges.set(rootKey, []);
    rootToEdges.get(rootKey).push(edge);
  }

  const annotated = rowList.map((row) => {
    const key = sessionKey(row);
    const childEdge = childToEdge.get(key);
    if (childEdge) {
      return {
        ...row,
        session_group_id: childEdge.session_group_id,
        group_role: 'child',
        group_depth: childEdge.depth,
        agent_id: childEdge.agent_id,
        agent_label: childEdge.agent_label,
        agent_role: childEdge.agent_role,
        relation_proof: childEdge.relation_proof,
      };
    }
    const hasChildren = rootToEdges.has(key);
    return {
      ...row,
      session_group_id: hasChildren ? rootToEdges.get(key)[0].session_group_id : null,
      group_role: hasChildren ? 'root' : 'ungrouped',
      group_depth: hasChildren ? 0 : null,
      agent_label: hasChildren ? 'Main session' : null,
    };
  });

  const byAnnotatedKey = new Map(annotated.map((row) => [sessionKey(row), row]));
  const groups = [];
  for (const [rootKey, groupEdges] of rootToEdges.entries()) {
    const root = byAnnotatedKey.get(rootKey);
    const members = [];
    if (root) members.push(root);
    for (const edge of groupEdges) {
      const child = byAnnotatedKey.get(`${text(edge.provider).toLowerCase()}:${text(edge.child_session_id)}`);
      if (child) members.push(child);
    }
    if (members.length < 2) continue;
    groups.push(summarizeGroup(groupEdges[0].session_group_id, root || members[0], members, { includeMembers }));
  }

  return { sessions: annotated, session_groups: groups };
}

module.exports = {
  readSessionGroupingMode,
  groupingVisible,
  deriveClaudeGroupEvidence,
  deriveCodexGroupEvidence,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
  readGroupEdges,
  buildSessionGroupsForRows,
};
