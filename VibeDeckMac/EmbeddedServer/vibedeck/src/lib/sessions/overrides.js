'use strict';

const { DatabaseSync } = require('node:sqlite');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function normalizeNullableString(v) {
  if (v == null) return null;
  if (typeof v !== 'string') throw new TypeError('branch must be a string or null');
  const s = v.trim();
  return s === '' ? null : s;
}

function upsertOverride(dbPath, { provider, session_id, branch, set_by } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('upsertOverride: dbPath must be a non-empty string');
  if (!isNonEmptyString(provider)) throw new TypeError('upsertOverride: provider must be a non-empty string');
  if (!isNonEmptyString(session_id)) throw new TypeError('upsertOverride: session_id must be a non-empty string');
  if (!isNonEmptyString(set_by)) throw new TypeError('upsertOverride: set_by must be a non-empty string');

  const row = {
    provider: provider.trim(),
    session_id: session_id.trim(),
    branch: normalizeNullableString(branch),
    set_by: set_by.trim(),
    set_at: new Date().toISOString(),
  };

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO vibedeck_attribution_overrides (provider, session_id, branch, set_by, set_at)
       VALUES (@provider, @session_id, @branch, @set_by, @set_at)
       ON CONFLICT(provider, session_id) DO UPDATE SET
         branch = excluded.branch,
         set_by = excluded.set_by,
         set_at = excluded.set_at`,
    ).run(row);
  } finally {
    db.close();
  }
}

function getOverride(dbPath, { provider, session_id } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('getOverride: dbPath must be a non-empty string');
  if (!isNonEmptyString(provider)) throw new TypeError('getOverride: provider must be a non-empty string');
  if (!isNonEmptyString(session_id)) throw new TypeError('getOverride: session_id must be a non-empty string');

  const db = new DatabaseSync(dbPath);
  try {
    return (
      db
        .prepare('SELECT * FROM vibedeck_attribution_overrides WHERE provider = ? AND session_id = ?')
        .get(provider.trim(), session_id.trim()) || null
    );
  } finally {
    db.close();
  }
}

function clearOverride(dbPath, { provider, session_id } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('clearOverride: dbPath must be a non-empty string');
  if (!isNonEmptyString(provider)) throw new TypeError('clearOverride: provider must be a non-empty string');
  if (!isNonEmptyString(session_id)) throw new TypeError('clearOverride: session_id must be a non-empty string');

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare('DELETE FROM vibedeck_attribution_overrides WHERE provider = ? AND session_id = ?').run(
      provider.trim(),
      session_id.trim(),
    );
  } finally {
    db.close();
  }
}

module.exports = {
  upsertOverride,
  getOverride,
  clearOverride,
};

