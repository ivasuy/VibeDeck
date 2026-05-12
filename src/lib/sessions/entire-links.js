'use strict';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeCheckpointIds(checkpointIds) {
  if (!Array.isArray(checkpointIds)) return [];
  return checkpointIds
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value) => value !== '');
}

function upsertEntireLink(db, {
  provider,
  session_id,
  entire_session_id,
  checkpoint_ids = [],
  match_confidence = 'high',
} = {}) {
  if (!db) return false;
  if (!nonEmpty(provider) || !nonEmpty(session_id) || !nonEmpty(entire_session_id)) return false;
  const idsJson = JSON.stringify(normalizeCheckpointIds(checkpoint_ids));
  db.prepare(
    `
    INSERT INTO vibedeck_session_entire_links (
      provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_id, entire_session_id)
    DO UPDATE SET
      entire_checkpoint_ids = excluded.entire_checkpoint_ids,
      match_confidence = excluded.match_confidence
    `,
  ).run(
    provider.trim(),
    session_id.trim(),
    entire_session_id.trim(),
    idsJson,
    nonEmpty(match_confidence) ? match_confidence.trim() : 'high',
  );
  return true;
}

module.exports = { upsertEntireLink };
