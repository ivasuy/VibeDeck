'use strict';

const { DatabaseSync } = require('node:sqlite');
const { checkpointGroupId } = require('../entire-checkpoint-usage');
const { upsertEntireLink } = require('./entire-links');

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePath(value) {
  return normalizeText(value).replace(/\\/g, '/');
}

function normalizeProvider(agent) {
  const normalized = normalizeText(agent).toLowerCase();
  if (!normalized) return '';
  if (normalized === 'claude-code') return 'claude';
  return normalized;
}

function normalizeBranch(branch) {
  return normalizeText(branch).replace(/~\d+$/, '');
}

function extractCheckpointId(metadata, metadataPath) {
  const explicit = normalizeText(metadata?.checkpoint_id);
  if (explicit) return explicit;
  const found = normalizePath(metadataPath).match(/[a-f0-9]{12}/i);
  return found ? found[0].toLowerCase() : '';
}

function metadataFromPayload(payload) {
  if (payload && typeof payload.parsed === 'object' && payload.parsed) return payload.parsed;
  return payload && typeof payload === 'object' ? payload : {};
}

function selectMetadataPath(groupFiles) {
  const paths = Array.isArray(groupFiles) ? groupFiles.map((entry) => normalizePath(entry)).filter(Boolean) : [];
  return paths.find((entry) => entry.endsWith('/metadata.json')) || '';
}

function findCandidates(db, { repoRoot, provider, startedAt, endedAt }) {
  if (!repoRoot || !startedAt || !endedAt) return [];
  let sql = `
    SELECT
      provider,
      session_id,
      branch,
      model,
      started_at,
      COALESCE(ended_at, last_observed_at, updated_at, started_at) AS effective_end_at
    FROM vibedeck_sessions
    WHERE repo_root = ?
      AND COALESCE(started_at, '') <= ?
      AND COALESCE(ended_at, last_observed_at, updated_at, started_at, '') >= ?
  `;
  const params = [repoRoot, endedAt, startedAt];
  if (provider) {
    sql += ' AND LOWER(provider) = LOWER(?)';
    params.push(provider);
  }
  return db.prepare(sql).all(...params);
}

function findCandidatesByRuntimeSessionId(db, { repoRoot, provider, runtimeSessionId }) {
  const runtimeId = normalizeText(runtimeSessionId);
  if (!repoRoot || !runtimeId) return [];
  let sql = `
    SELECT
      provider,
      session_id,
      branch,
      model,
      started_at,
      COALESCE(ended_at, last_observed_at, updated_at, started_at) AS effective_end_at
    FROM vibedeck_sessions
    WHERE repo_root = ?
      AND (
        session_id = ?
        OR session_id LIKE ?
      )
  `;
  const params = [repoRoot, runtimeId, `%${runtimeId}%`];
  if (provider) {
    sql += ' AND LOWER(provider) = LOWER(?)';
    params.push(provider);
  }
  return db.prepare(sql).all(...params);
}

function classifyRuntimeSessionIdMatch(candidates) {
  const plausible = Array.isArray(candidates) ? candidates : [];
  if (plausible.length === 0) {
    return { status: 'unmatched', confidence: 'unmatched', reason: 'no_matching_session', candidate_count: 0, session: null };
  }
  if (plausible.length === 1) {
    return {
      status: 'linked',
      confidence: 'exact',
      reason: null,
      candidate_count: 1,
      session: plausible[0],
    };
  }
  return {
    status: 'ambiguous',
    confidence: 'ambiguous',
    reason: 'multiple_candidates',
    candidate_count: plausible.length,
    session: null,
  };
}

function classifyMatch(candidates, metadata) {
  let plausible = Array.isArray(candidates) ? candidates : [];
  if (plausible.length === 0) {
    return { status: 'unmatched', confidence: 'unmatched', reason: 'no_matching_session', candidate_count: 0, session: null };
  }

  const metadataModel = normalizeText(metadata?.model);
  const metadataBranch = normalizeText(metadata?.branch);
  const normalizedMetadataBranch = normalizeBranch(metadataBranch);

  if (metadataModel) {
    plausible = plausible.filter((row) => normalizeText(row?.model) === metadataModel);
    if (plausible.length === 0) {
      return { status: 'unmatched', confidence: 'unmatched', reason: 'no_strict_match', candidate_count: 0, session: null };
    }
  }

  if (metadataBranch) {
    plausible = plausible.filter((row) => {
      const rowBranch = normalizeText(row?.branch);
      return rowBranch === metadataBranch || normalizeBranch(rowBranch) === normalizedMetadataBranch;
    });
    if (plausible.length === 0) {
      return { status: 'unmatched', confidence: 'unmatched', reason: 'no_strict_match', candidate_count: 0, session: null };
    }
  }

  if (plausible.length === 1) {
    const confidence = metadataModel && metadataBranch ? 'exact' : 'overlap';
    return {
      status: 'linked',
      confidence,
      reason: null,
      candidate_count: 1,
      session: plausible[0],
    };
  }

  return {
    status: 'ambiguous',
    confidence: 'ambiguous',
    reason: 'multiple_candidates',
    candidate_count: plausible.length,
    session: null,
  };
}

function upsertMatchRow(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_entire_checkpoint_matches (
      repo_root,
      checkpoint_group_id,
      checkpoint_id,
      metadata_path,
      checkpoint_tip,
      entire_session_id,
      agent,
      provider,
      model,
      branch,
      started_at,
      ended_at,
      session_provider,
      session_id,
      match_status,
      match_confidence,
      reason,
      candidate_count,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_root, checkpoint_group_id)
    DO UPDATE SET
      checkpoint_id = excluded.checkpoint_id,
      metadata_path = excluded.metadata_path,
      checkpoint_tip = excluded.checkpoint_tip,
      entire_session_id = excluded.entire_session_id,
      agent = excluded.agent,
      provider = excluded.provider,
      model = excluded.model,
      branch = excluded.branch,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      session_provider = excluded.session_provider,
      session_id = excluded.session_id,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      reason = excluded.reason,
      candidate_count = excluded.candidate_count,
      updated_at = excluded.updated_at
  `).run(
    row.repo_root,
    row.checkpoint_group_id,
    row.checkpoint_id || null,
    row.metadata_path,
    row.checkpoint_tip || null,
    row.entire_session_id || null,
    row.agent || null,
    row.provider || null,
    row.model || null,
    row.branch || null,
    row.started_at || null,
    row.ended_at || null,
    row.session_provider || null,
    row.session_id || null,
    row.match_status,
    row.match_confidence,
    row.reason || null,
    row.candidate_count,
    row.created_at,
    row.updated_at,
  );
}

async function backfillEntireCheckpointLinks({
  dbPath,
  repoRoot,
  checkpointTip = null,
  listCheckpointsCached,
  readCheckpoint,
  now = () => new Date(),
} = {}) {
  const summary = { scanned: 0, linked: 0, ambiguous: 0, unmatched: 0, skipped: 0 };
  if (!normalizeText(dbPath) || !normalizeText(repoRoot)) return summary;
  if (typeof listCheckpointsCached !== 'function' || typeof readCheckpoint !== 'function') return summary;

  const listResult = await listCheckpointsCached(repoRoot);
  const files = Array.isArray(listResult?.files) ? listResult.files : [];
  const groups = new Map();
  for (const filePath of files) {
    const normalized = normalizePath(filePath);
    if (!normalized) continue;
    const groupId = checkpointGroupId(normalized);
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(normalized);
  }

  const db = new DatabaseSync(dbPath);
  try {
    for (const [groupId, groupFiles] of groups.entries()) {
      const metadataPath = selectMetadataPath(groupFiles);
      if (!metadataPath) {
        summary.skipped += 1;
        continue;
      }

      let payload;
      try {
        payload = await readCheckpoint(metadataPath);
      } catch {
        summary.skipped += 1;
        continue;
      }

      const metadata = metadataFromPayload(payload);
      const startedAt = normalizeText(metadata?.started_at);
      const endedAt = normalizeText(metadata?.ended_at);
      const provider = normalizeProvider(metadata?.agent);
      const metadataRuntimeSessionId = normalizeText(metadata?.session_id);
      const checkpointId = extractCheckpointId(metadata, metadataPath);
      const entireSessionId = normalizeText(metadata?.entire_session_id);
      summary.scanned += 1;

      let candidates = findCandidatesByRuntimeSessionId(db, {
        repoRoot,
        provider,
        runtimeSessionId: metadataRuntimeSessionId,
      });
      let match = metadataRuntimeSessionId
        ? classifyRuntimeSessionIdMatch(candidates)
        : classifyMatch(candidates, metadata);
      if (match.status === 'unmatched' && match.reason === 'no_matching_session') {
        candidates = findCandidates(db, { repoRoot, provider, startedAt, endedAt });
        match = classifyMatch(candidates, metadata);
      }
      const timestamp = now().toISOString();

      upsertMatchRow(db, {
        repo_root: repoRoot,
        checkpoint_group_id: groupId,
        checkpoint_id: checkpointId,
        metadata_path: metadataPath,
        checkpoint_tip: checkpointTip,
        entire_session_id: entireSessionId,
        agent: normalizeText(metadata?.agent),
        provider,
        model: normalizeText(metadata?.model),
        branch: normalizeText(metadata?.branch),
        started_at: startedAt,
        ended_at: endedAt,
        session_provider: match.session ? normalizeText(match.session.provider) : null,
        session_id: match.session ? normalizeText(match.session.session_id) : null,
        match_status: match.status,
        match_confidence: match.confidence,
        reason: match.reason,
        candidate_count: match.candidate_count,
        created_at: timestamp,
        updated_at: timestamp,
      });

      if (match.status === 'linked') {
        summary.linked += 1;
        if (match.session && entireSessionId) {
          upsertEntireLink(db, {
            provider: match.session.provider,
            session_id: match.session.session_id,
            entire_session_id: entireSessionId,
            checkpoint_ids: checkpointId ? [checkpointId] : [],
            match_confidence: match.confidence,
          });
        }
      } else if (match.status === 'ambiguous') {
        summary.ambiguous += 1;
      } else {
        summary.unmatched += 1;
      }
    }
  } finally {
    db.close();
  }

  return summary;
}

module.exports = {
  backfillEntireCheckpointLinks,
};
