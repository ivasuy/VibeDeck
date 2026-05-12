'use strict';

const { DatabaseSync } = require('node:sqlite');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function checkpointGroupId(filePath) {
  const parts = normalizePath(filePath).split('/').filter(Boolean);
  if (parts.length >= 2 && /^[a-f0-9]{2}$/i.test(parts[0])) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 1) return parts[0];
  return 'unknown';
}

function checkpointIdFrom(metadata, metadataPath) {
  const explicit = typeof metadata?.checkpoint_id === 'string' ? metadata.checkpoint_id.trim() : '';
  if (explicit) return explicit;
  const fromPath = normalizePath(metadataPath).match(/[a-f0-9]{12}/i);
  return fromPath ? fromPath[0].toLowerCase() : '';
}

function agentToProvider(agent) {
  const normalized = String(agent || '').trim().toLowerCase();
  if (normalized === 'claude-code') return 'claude';
  return normalized || null;
}

function safeJsonArray(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function summarizeRows(rows) {
  const providerMap = new Map();
  const modelMap = new Map();
  let totalTokens = 0;
  let knownCostUsd = 0;
  let costUnknownCount = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = String(row?.provider || 'unknown').trim() || 'unknown';
    const model = String(row?.model || 'unknown').trim() || 'unknown';
    const tokens = Number(row?.total_tokens || 0) || 0;
    const costRaw = row?.total_cost_usd;
    const hasKnownCost = costRaw != null && Number.isFinite(Number(costRaw));
    const cost = hasKnownCost ? Number(costRaw) : null;

    totalTokens += tokens;
    if (hasKnownCost) knownCostUsd += cost;
    else costUnknownCount += 1;

    if (!providerMap.has(provider)) {
      providerMap.set(provider, {
        provider,
        total_tokens: 0,
        known_cost_usd: 0,
        cost_unknown_count: 0,
        session_count: 0,
      });
    }
    if (!modelMap.has(model)) {
      modelMap.set(model, {
        model,
        total_tokens: 0,
        known_cost_usd: 0,
        cost_unknown_count: 0,
        session_count: 0,
      });
    }

    const providerRow = providerMap.get(provider);
    providerRow.total_tokens += tokens;
    providerRow.session_count += 1;
    if (hasKnownCost) providerRow.known_cost_usd += cost;
    else providerRow.cost_unknown_count += 1;

    const modelRow = modelMap.get(model);
    modelRow.total_tokens += tokens;
    modelRow.session_count += 1;
    if (hasKnownCost) modelRow.known_cost_usd += cost;
    else modelRow.cost_unknown_count += 1;
  }

  const provider_breakdown = Array.from(providerMap.values())
    .map((row) => ({
      ...row,
      total_cost_usd: row.cost_unknown_count > 0 ? null : row.known_cost_usd,
    }))
    .sort((a, b) => a.provider.localeCompare(b.provider));
  const model_breakdown = Array.from(modelMap.values())
    .map((row) => ({
      ...row,
      total_cost_usd: row.cost_unknown_count > 0 ? null : row.known_cost_usd,
    }))
    .sort((a, b) => a.model.localeCompare(b.model));

  return {
    total_tokens: totalTokens,
    total_cost_usd: costUnknownCount > 0 ? null : knownCostUsd,
    known_cost_usd: knownCostUsd,
    cost_unknown_count: costUnknownCount,
    providers: provider_breakdown,
    models: model_breakdown,
    provider_breakdown,
    model_breakdown,
    session_count: Array.isArray(rows) ? rows.length : 0,
  };
}

function normalizeCheckpointMetadata(payload) {
  if (payload && typeof payload.parsed === 'object' && payload.parsed) return payload.parsed;
  return payload && typeof payload === 'object' ? payload : {};
}

function sessionsFromLinksByEntireSession(db, metadata) {
  const entireSessionId = String(metadata?.entire_session_id || '').trim();
  if (!entireSessionId) return [];
  return db
    .prepare(`
      SELECT DISTINCT s.provider, s.session_id, s.model, s.total_tokens, s.total_cost_usd
      FROM vibedeck_session_entire_links l
      JOIN vibedeck_sessions s
        ON s.provider = l.provider AND s.session_id = l.session_id
      WHERE l.entire_session_id = ?
    `)
    .all(entireSessionId);
}

function sessionsFromLinksByCheckpointId(db, checkpointId) {
  if (!checkpointId) return [];
  return db
    .prepare(`
      SELECT DISTINCT s.provider, s.session_id, s.model, s.total_tokens, s.total_cost_usd
      FROM vibedeck_session_entire_links l
      JOIN vibedeck_sessions s
        ON s.provider = l.provider AND s.session_id = l.session_id
      WHERE EXISTS (
        SELECT 1
        FROM json_each(l.entire_checkpoint_ids)
        WHERE LOWER(TRIM(json_each.value)) = LOWER(?)
      )
    `)
    .all(checkpointId);
}

function sessionsFromOverlap(db, metadata) {
  const provider = agentToProvider(metadata?.agent);
  const startedAt = String(metadata?.started_at || '').trim();
  const endedAt = String(metadata?.ended_at || '').trim();
  if (!provider || !startedAt || !endedAt) return [];
  return db
    .prepare(`
      SELECT s.provider, s.session_id, s.model, s.total_tokens, s.total_cost_usd
      FROM vibedeck_sessions s
      WHERE LOWER(s.provider) = LOWER(?)
        AND COALESCE(s.started_at, '') <= ?
        AND COALESCE(s.ended_at, s.last_observed_at, s.updated_at, s.started_at, '') >= ?
    `)
    .all(provider, endedAt, startedAt);
}

function buildCheckpointUsage(dbPath, payload, context = {}) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const metadata = normalizeCheckpointMetadata(payload);
    const checkpointId = checkpointIdFrom(metadata, context.metadataPath || payload?.path || '');
    const metadataPath = normalizePath(context.metadataPath || payload?.path || '');
    const groupId = checkpointGroupId(context.groupId || metadataPath);
    let rows = sessionsFromLinksByEntireSession(db, metadata);
    let confidence = 'linked';
    if (rows.length === 0 && checkpointId) rows = sessionsFromLinksByCheckpointId(db, checkpointId);
    if (rows.length === 0) {
      rows = sessionsFromOverlap(db, metadata);
      confidence = rows.length > 0 ? 'overlap' : 'linked';
    }
    if (rows.length === 0) return null;
    const summary = summarizeRows(rows);
    return {
      checkpoint_id: checkpointId || null,
      metadata_path: metadataPath || null,
      checkpoint_group_id: groupId,
      agent: typeof metadata?.agent === 'string' ? metadata.agent : null,
      branch: typeof metadata?.branch === 'string' ? metadata.branch : null,
      total_tokens: summary.total_tokens,
      total_cost_usd: summary.total_cost_usd,
      known_cost_usd: summary.known_cost_usd,
      cost_unknown_count: summary.cost_unknown_count,
      providers: summary.providers,
      models: summary.models,
      provider_breakdown: summary.provider_breakdown,
      model_breakdown: summary.model_breakdown,
      session_count: summary.session_count,
      confidence,
    };
  } finally {
    db.close();
  }
}

async function buildCheckpointUsageIndex({ dbPath, listResult, readCheckpoint }) {
  const files = Array.isArray(listResult?.files) ? listResult.files : [];
  const groups = new Map();
  for (const filePath of files) {
    const id = checkpointGroupId(filePath);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(String(filePath));
  }
  const usage = {};
  for (const [groupId, groupFiles] of groups.entries()) {
    const metadataPath = groupFiles.find((filePath) => normalizePath(filePath).endsWith('/metadata.json'))
      || groupFiles.find((filePath) => normalizePath(filePath).endsWith('.json'));
    if (!metadataPath || typeof readCheckpoint !== 'function') continue;
    let metadata;
    try {
      metadata = await readCheckpoint(metadataPath);
    } catch {
      continue;
    }
    const summary = buildCheckpointUsage(dbPath, metadata, { metadataPath, groupId });
    if (summary) usage[groupId] = summary;
  }
  return usage;
}

module.exports = {
  checkpointGroupId,
  buildCheckpointUsage,
  buildCheckpointUsageIndex,
  safeJsonArray,
};
