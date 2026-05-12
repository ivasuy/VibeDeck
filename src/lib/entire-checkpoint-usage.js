'use strict';

const { DatabaseSync } = require('node:sqlite');
const { summarizeCanonicalUsageRows } = require('./canonical-cost-summary');
const { computeRowCost, lookupModelPricing } = require('./pricing');

function normalizePath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

function normalizeRelativePath(value) {
  return normalizePath(value).replace(/^\/+/, '');
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
  const compact = normalized.replace(/[_\s]+/g, '-');
  if (compact === 'claude-code' || compact === 'claude') return 'claude';
  return normalized || null;
}

function normalizeText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function toTokenCount(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.floor(numeric);
}

function isMetadataFilePath(filePath) {
  return normalizeRelativePath(filePath).toLowerCase().endsWith('/metadata.json');
}

function pathParts(filePath) {
  return normalizeRelativePath(filePath).split('/').filter(Boolean);
}

function isRootMetadataPath(filePath, groupId) {
  const parts = pathParts(filePath);
  return parts.length === 3 && parts[2]?.toLowerCase() === 'metadata.json' && checkpointGroupId(filePath) === groupId;
}

function isChildMetadataPath(filePath, groupId) {
  const parts = pathParts(filePath);
  return parts.length > 3 && parts.at(-1)?.toLowerCase() === 'metadata.json' && checkpointGroupId(filePath) === groupId;
}

function uniquePaths(paths) {
  const seen = new Set();
  const out = [];
  for (const value of paths) {
    const normalized = normalizeRelativePath(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
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

function normalizeCheckpointMetadata(payload) {
  if (payload && typeof payload.parsed === 'object' && payload.parsed) return payload.parsed;
  return payload && typeof payload === 'object' ? payload : {};
}

function buildTokenUsageRow(metadata, metadataPath, groupId) {
  const tokenUsage = metadata?.token_usage;
  if (!tokenUsage || typeof tokenUsage !== 'object' || Array.isArray(tokenUsage)) return null;

  const model = normalizeText(metadata?.model);
  if (!model) return null;

  const provider = agentToProvider(metadata?.agent) || normalizeText(metadata?.provider) || 'unknown';
  const inputTokens = toTokenCount(tokenUsage.input_tokens);
  const cacheCreationTokens = toTokenCount(tokenUsage.cache_creation_tokens);
  const cacheReadTokens = toTokenCount(tokenUsage.cache_read_tokens ?? tokenUsage.cached_input_tokens);
  const outputTokens = toTokenCount(tokenUsage.output_tokens);
  const reasoningTokens = toTokenCount(tokenUsage.reasoning_output_tokens);
  const explicitTotal = toTokenCount(tokenUsage.total_tokens);
  const totalTokens = inputTokens + cacheCreationTokens + cacheReadTokens + outputTokens + reasoningTokens;
  const safeTotalTokens = totalTokens || explicitTotal;
  if (safeTotalTokens <= 0) return null;

  const pricing = lookupModelPricing(model);
  const totalCostUsd = pricing.hit
    ? computeRowCost({
      source: provider,
      model,
      input_tokens: inputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cached_input_tokens: cacheReadTokens,
      output_tokens: outputTokens,
      reasoning_output_tokens: reasoningTokens,
    })
    : null;

  return {
    checkpoint_id: checkpointIdFrom(metadata, metadataPath) || null,
    metadata_path: metadataPath || null,
    checkpoint_group_id: groupId,
    agent: normalizeText(metadata?.agent),
    provider,
    model,
    branch: normalizeText(metadata?.branch),
    session_id: normalizeText(metadata?.session_id),
    turn_id: normalizeText(metadata?.turn_id),
    input_tokens: inputTokens,
    cache_creation_tokens: cacheCreationTokens,
    cache_read_tokens: cacheReadTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningTokens,
    api_call_count: toTokenCount(tokenUsage.api_call_count),
    total_tokens: safeTotalTokens,
    total_cost_usd: totalCostUsd,
    cost_quality: totalCostUsd == null ? 'unknown' : 'checkpoint_metadata',
  };
}

function sortBreakdownRows(rows, key) {
  return [...rows].sort((left, right) => {
    const tokenDelta = Number(right?.total_tokens || 0) - Number(left?.total_tokens || 0);
    if (tokenDelta !== 0) return tokenDelta;
    return String(left?.[key] || '').localeCompare(String(right?.[key] || ''));
  });
}

function usageFromMetadataRows({ rows, checkpointId, metadataPath, groupId, metadata, status = 'metadata' }) {
  const summary = summarizeCanonicalUsageRows(rows);
  const providers = sortBreakdownRows(summary.providers, 'provider');
  const models = sortBreakdownRows(summary.models, 'model');
  const firstRow = rows[0] || {};
  const firstProvider = providers[0]?.provider || firstRow.provider || null;
  const firstModel = models[0]?.model || firstRow.model || null;
  return {
    checkpoint_id: checkpointId || firstRow.checkpoint_id || null,
    metadata_path: metadataPath || firstRow.metadata_path || null,
    checkpoint_group_id: groupId,
    agent: normalizeText(metadata?.agent) || firstRow.agent || null,
    provider: firstProvider,
    model: firstModel,
    branch: normalizeText(metadata?.branch) || firstRow.branch || null,
    total_tokens: summary.total_tokens,
    total_cost_usd: summary.total_cost_usd,
    known_cost_usd: summary.known_cost_usd,
    cost_unknown_count: summary.cost_unknown_count,
    cost_quality: summary.cost_quality,
    providers,
    models,
    provider_breakdown: providers,
    model_breakdown: models,
    session_count: rows.length,
    status,
    confidence: status,
    reason: null,
  };
}

function usageFromCheckpointMetadata(payload, context = {}) {
  const metadata = normalizeCheckpointMetadata(payload);
  const metadataPath = normalizeRelativePath(context.metadataPath || payload?.path || '');
  const groupId = checkpointGroupId(context.groupId || metadataPath);
  const row = buildTokenUsageRow(metadata, metadataPath, groupId);
  if (!row) return null;
  return {
    ...usageFromMetadataRows({
      rows: [row],
      checkpointId: row.checkpoint_id,
      metadataPath,
      groupId,
      metadata,
    }),
    session_id: row.session_id,
    turn_id: row.turn_id,
    input_tokens: row.input_tokens,
    cache_creation_tokens: row.cache_creation_tokens,
    cache_read_tokens: row.cache_read_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
    api_call_count: row.api_call_count,
  };
}

function childMetadataPathsFromRoot(metadata, groupId, groupFiles) {
  const sessionRefs = Array.isArray(metadata?.sessions)
    ? metadata.sessions.map((session) => session?.metadata).filter(Boolean)
    : [];
  const fromSessions = uniquePaths(sessionRefs)
    .filter((filePath) => isMetadataFilePath(filePath) && checkpointGroupId(filePath) === groupId);
  if (fromSessions.length > 0) return fromSessions;

  return uniquePaths(groupFiles)
    .filter((filePath) => isChildMetadataPath(filePath, groupId));
}

async function buildMetadataGroupUsage({ groupId, groupFiles, readCheckpoint }) {
  if (typeof readCheckpoint !== 'function') return null;

  const normalizedFiles = uniquePaths(groupFiles);
  const rootMetadataPath = normalizedFiles.find((filePath) => isRootMetadataPath(filePath, groupId));
  let rootMetadata = {};
  if (rootMetadataPath) {
    try {
      rootMetadata = normalizeCheckpointMetadata(await readCheckpoint(rootMetadataPath));
    } catch {
      rootMetadata = {};
    }
  }

  const childMetadataPaths = childMetadataPathsFromRoot(rootMetadata, groupId, normalizedFiles);
  if (childMetadataPaths.length === 0) return null;

  const rows = [];
  const metadataFiles = [];
  for (const metadataPath of childMetadataPaths) {
    let payload;
    try {
      payload = await readCheckpoint(metadataPath);
    } catch {
      continue;
    }
    const metadata = normalizeCheckpointMetadata(payload);
    const row = buildTokenUsageRow(metadata, metadataPath, groupId);
    if (!row) continue;
    rows.push(row);
    metadataFiles.push(usageFromCheckpointMetadata(payload, { metadataPath, groupId }));
  }
  if (rows.length === 0) return null;

  return {
    ...usageFromMetadataRows({
      rows,
      checkpointId: checkpointIdFrom(rootMetadata, rootMetadataPath || childMetadataPaths[0]),
      metadataPath: rootMetadataPath || childMetadataPaths[0],
      groupId,
      metadata: rootMetadata,
    }),
    metadata_files: metadataFiles.filter(Boolean),
  };
}

function matchRowByRepoGroup(db, repoRoot, checkpointGroupIdValue) {
  if (!repoRoot || !checkpointGroupIdValue) return null;
  return db
    .prepare(`
      SELECT *
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `)
    .get(repoRoot, checkpointGroupIdValue);
}

function sessionByProviderAndId(db, provider, sessionId) {
  if (!provider || !sessionId) return [];
  return db
    .prepare(`
      SELECT provider, session_id, model, total_tokens, total_cost_usd, cost_quality
      FROM vibedeck_sessions
      WHERE LOWER(provider) = LOWER(?) AND session_id = ?
      LIMIT 1
    `)
    .all(provider, sessionId);
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

function statusUsageShell({
  status,
  confidence,
  reason,
  checkpointId,
  metadataPath,
  groupId,
  metadata,
  matchRow,
}) {
  return {
    checkpoint_id: checkpointId || null,
    metadata_path: metadataPath || null,
    checkpoint_group_id: groupId,
    agent: typeof metadata?.agent === 'string' ? metadata.agent : (matchRow?.agent || null),
    provider: matchRow?.provider || agentToProvider(metadata?.agent),
    model: matchRow?.model || (typeof metadata?.model === 'string' ? metadata.model : null),
    branch: matchRow?.branch || (typeof metadata?.branch === 'string' ? metadata.branch : null),
    total_tokens: null,
    total_cost_usd: null,
    known_cost_usd: 0,
    cost_unknown_count: 0,
    cost_quality: 'unknown',
    providers: [],
    models: [],
    provider_breakdown: [],
    model_breakdown: [],
    session_count: 0,
    status,
    confidence,
    reason: reason || null,
  };
}

function usageFromRows({
  rows,
  checkpointId,
  metadataPath,
  groupId,
  metadata,
  status,
  confidence,
  reason,
  matchRow,
}) {
  const summary = summarizeCanonicalUsageRows(rows);
  const firstProvider = Array.isArray(summary.providers) && summary.providers.length > 0
    ? summary.providers[0].provider
    : null;
  const firstModel = Array.isArray(summary.models) && summary.models.length > 0
    ? summary.models[0].model
    : null;
  return {
    checkpoint_id: checkpointId || null,
    metadata_path: metadataPath || null,
    checkpoint_group_id: groupId,
    agent: typeof metadata?.agent === 'string' ? metadata.agent : null,
    provider: matchRow?.provider || firstProvider || agentToProvider(metadata?.agent),
    model: matchRow?.model || firstModel || (typeof metadata?.model === 'string' ? metadata.model : null),
    branch: typeof metadata?.branch === 'string' ? metadata.branch : null,
    total_tokens: summary.total_tokens,
    total_cost_usd: summary.total_cost_usd,
    known_cost_usd: summary.known_cost_usd,
    cost_unknown_count: summary.cost_unknown_count,
    cost_quality: summary.cost_quality,
    providers: summary.providers,
    models: summary.models,
    provider_breakdown: summary.provider_breakdown,
    model_breakdown: summary.model_breakdown,
    session_count: summary.session_count,
    status,
    confidence,
    reason: reason || null,
  };
}

function buildCheckpointUsage(dbPath, payload, context = {}) {
  const metadata = normalizeCheckpointMetadata(payload);
  const metadataPath = normalizeRelativePath(context.metadataPath || payload?.path || '');
  const groupId = checkpointGroupId(context.groupId || metadataPath);
  const directUsage = usageFromCheckpointMetadata(payload, { ...context, metadataPath, groupId });
  if (directUsage) return directUsage;

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    return null;
  }
  try {
    const checkpointId = checkpointIdFrom(metadata, metadataPath);
    const repoRoot = typeof context.repoRoot === 'string' ? context.repoRoot : '';
    const allowOverlapFallback = context.allowOverlapFallback === true;
    const allowCanonicalFallback = context.allowCanonicalFallback === true;
    const rootAggregateOnly = Array.isArray(metadata?.sessions) && !normalizeText(metadata?.model);
    const matchRow = matchRowByRepoGroup(db, repoRoot, groupId);

    if (matchRow && String(matchRow.match_status || '').trim()) {
      const status = String(matchRow.match_status || '').trim();
      const confidence = String(matchRow.match_confidence || status || 'unknown').trim();
      const reason = matchRow.reason || null;
      if (status === 'linked') {
        if (allowCanonicalFallback || !rootAggregateOnly) {
          let rows = sessionByProviderAndId(db, matchRow.session_provider, matchRow.session_id);
          if (rows.length === 0) rows = sessionsFromLinksByEntireSession(db, metadata);
          if (rows.length === 0 && checkpointId) rows = sessionsFromLinksByCheckpointId(db, checkpointId);
          if (rows.length > 0) {
            return usageFromRows({
              rows,
              checkpointId,
              metadataPath,
              groupId,
              metadata,
              status,
              confidence,
              reason,
              matchRow,
            });
          }
        }
      }
      if (status === 'ambiguous' || status === 'unmatched') {
        return statusUsageShell({
          status,
          confidence,
          reason,
          checkpointId,
          metadataPath,
          groupId,
          metadata,
          matchRow,
        });
      }
    }

    if (rootAggregateOnly && !allowCanonicalFallback) return null;

    let rows = sessionsFromLinksByEntireSession(db, metadata);
    let confidence = 'linked';
    if (rows.length === 0 && checkpointId) rows = sessionsFromLinksByCheckpointId(db, checkpointId);
    if (rows.length === 0 && allowOverlapFallback) {
      rows = sessionsFromOverlap(db, metadata);
      confidence = rows.length > 0 ? 'overlap' : 'linked';
    }
    if (rows.length === 0) return null;
    return usageFromRows({
      rows,
      checkpointId,
      metadataPath,
      groupId,
      metadata,
      status: 'linked',
      confidence,
      reason: null,
      matchRow: null,
    });
  } finally {
    db.close();
  }
}

async function buildCheckpointUsageIndex({ dbPath, listResult, readCheckpoint, repoRoot }) {
  const files = Array.isArray(listResult?.files) ? listResult.files.map(normalizeRelativePath).filter(Boolean) : [];
  const groups = new Map();
  for (const filePath of files) {
    const id = checkpointGroupId(filePath);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(String(filePath));
  }
  const usage = {};
  for (const [groupId, groupFiles] of groups.entries()) {
    const metadataSummary = await buildMetadataGroupUsage({ groupId, groupFiles, readCheckpoint });
    if (metadataSummary) {
      usage[groupId] = metadataSummary;
      continue;
    }

    const metadataPath = groupFiles.find((filePath) => isMetadataFilePath(filePath));
    if (!metadataPath || typeof readCheckpoint !== 'function') continue;
    let metadata;
    try {
      metadata = await readCheckpoint(metadataPath);
    } catch {
      continue;
    }
    const summary = buildCheckpointUsage(dbPath, metadata, {
      metadataPath,
      groupId,
      repoRoot,
    });
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
