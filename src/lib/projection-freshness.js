'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function emptyProjectionFreshness(mode = 'empty') {
  return {
    mode,
    recent_ready: false,
    historical_ready: false,
    active_rebuild: false,
    complete_through: null,
    indexing_providers: [],
    failed_shards: [],
  };
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function normalizeString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readWatermarkTimestamp(row) {
  const raw = normalizeString(row?.watermark_json);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const fromWatermark =
        normalizeIsoTimestamp(parsed?.complete_through) ||
        normalizeIsoTimestamp(parsed?.rebuilt_at) ||
        normalizeIsoTimestamp(parsed?.as_of);
      if (fromWatermark) return fromWatermark;
    } catch {}
  }
  return normalizeIsoTimestamp(row?.finished_at) || normalizeIsoTimestamp(row?.updated_at);
}

function tableExists(db) {
  return Boolean(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_projection_shards'")
      .get(),
  );
}

function scopeIsReady(rows, scope) {
  const scoped = rows.filter((row) => row.scope === scope);
  return scoped.length > 0 && scoped.every((row) => row.status === 'ready');
}

function completeThroughForRows(rows) {
  const timestamps = rows
    .filter((row) => row.status === 'ready')
    .map(readWatermarkTimestamp)
    .filter(Boolean)
    .sort();
  return timestamps.length > 0 ? timestamps[0] : null;
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function readProjectionFreshnessPayload({ dbPath } = {}) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || !fs.existsSync(dbPath)) {
    return emptyProjectionFreshness();
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    if (!tableExists(db)) return emptyProjectionFreshness();
    const rows = db
      .prepare(`
        SELECT
          shard_key,
          provider,
          scope,
          status,
          watermark_json,
          finished_at,
          updated_at,
          last_error
        FROM vibedeck_projection_shards
        WHERE scope IN ('recent', 'historical')
        ORDER BY provider ASC, scope ASC, shard_key ASC
      `)
      .all();

    if (rows.length === 0) return emptyProjectionFreshness();

    const recentReady = scopeIsReady(rows, 'recent');
    const historicalReady = scopeIsReady(rows, 'historical');
    const activeRows = rows.filter((row) => row.status === 'pending' || row.status === 'building');
    const complete = recentReady && historicalReady;

    return {
      mode: complete ? 'complete' : 'partial',
      recent_ready: recentReady,
      historical_ready: historicalReady,
      active_rebuild: activeRows.length > 0,
      complete_through: complete ? completeThroughForRows(rows) : null,
      indexing_providers: uniqueSorted(activeRows.map((row) => normalizeString(row.provider))),
      failed_shards: rows
        .filter((row) => row.status === 'failed')
        .map((row) => ({
          shard_key: normalizeString(row.shard_key) || '',
          provider: normalizeString(row.provider) || 'unknown',
          scope: normalizeString(row.scope) || 'unknown',
          error: normalizeString(row.last_error),
          updated_at: normalizeIsoTimestamp(row.updated_at),
        })),
    };
  } catch {
    return emptyProjectionFreshness();
  } finally {
    db.close();
  }
}

module.exports = {
  emptyProjectionFreshness,
  readProjectionFreshnessPayload,
};
