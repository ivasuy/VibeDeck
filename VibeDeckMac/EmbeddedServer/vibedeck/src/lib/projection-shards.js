'use strict';

const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('./db');

const VALID_SCOPES = new Set(['active', 'recent', 'historical']);
const VALID_STATUSES = new Set(['pending', 'building', 'ready', 'stale', 'failed']);

function isoFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function assertDbPath(dbPath, caller) {
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new TypeError(`${caller}: dbPath must be a non-empty string`);
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function requiredString(value, field) {
  if (!nonEmptyString(value)) {
    throw new TypeError(`upsertProjectionShard: ${field} must be a non-empty string`);
  }
  return value.trim();
}

function valueOrExistingString(shard, existing, field) {
  if (hasOwn(shard, field)) return requiredString(shard[field], field);
  if (existing) return existing[field];
  return requiredString(undefined, field);
}

function valueOrExistingEnum(shard, existing, field, validValues) {
  const value = valueOrExistingString(shard, existing, field);
  if (!validValues.has(value)) {
    throw new RangeError(`upsertProjectionShard: ${field} must be one of ${Array.from(validValues).join(', ')}`);
  }
  return value;
}

function normalizeShardForUpsert(shard, existing = null) {
  if (!shard || typeof shard !== 'object' || Array.isArray(shard)) {
    throw new TypeError('upsertProjectionShard: shard must be an object');
  }
  if (!nonEmptyString(shard.shard_key)) {
    throw new TypeError('upsertProjectionShard: shard.shard_key must be a non-empty string');
  }

  const now = isoFromDate(shard.updated_at || new Date());
  const createdAt = existing?.created_at || (nonEmptyString(shard.created_at) ? shard.created_at : now);
  return {
    shard_key: shard.shard_key.trim(),
    provider: valueOrExistingString(shard, existing, 'provider'),
    source_group: valueOrExistingString(shard, existing, 'source_group'),
    scope: valueOrExistingEnum(shard, existing, 'scope', VALID_SCOPES),
    status: valueOrExistingEnum(shard, existing, 'status', VALID_STATUSES),
    watermark_json: hasOwn(shard, 'watermark_json')
      ? shard.watermark_json
      : existing?.watermark_json || null,
    file_count: hasOwn(shard, 'file_count')
      ? normalizeCount(shard.file_count)
      : normalizeCount(existing?.file_count),
    event_count: hasOwn(shard, 'event_count')
      ? normalizeCount(shard.event_count)
      : normalizeCount(existing?.event_count),
    session_count: hasOwn(shard, 'session_count')
      ? normalizeCount(shard.session_count)
      : normalizeCount(existing?.session_count),
    fact_count: hasOwn(shard, 'fact_count')
      ? normalizeCount(shard.fact_count)
      : normalizeCount(existing?.fact_count),
    started_at: hasOwn(shard, 'started_at') ? shard.started_at : existing?.started_at || null,
    finished_at: hasOwn(shard, 'finished_at') ? shard.finished_at : existing?.finished_at || null,
    last_error: hasOwn(shard, 'last_error') ? shard.last_error : existing?.last_error || null,
    created_at: createdAt,
    updated_at: nonEmptyString(shard.updated_at) ? shard.updated_at : now,
  };
}

function upsertProjectionShard({ dbPath, shard } = {}) {
  assertDbPath(dbPath, 'upsertProjectionShard');
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const existing = nonEmptyString(shard?.shard_key)
      ? db.prepare('SELECT * FROM vibedeck_projection_shards WHERE shard_key = ?').get(shard.shard_key.trim())
      : null;
    const row = normalizeShardForUpsert(shard, existing);
    db.prepare(`
      INSERT INTO vibedeck_projection_shards (
        shard_key, provider, source_group, scope, status, watermark_json,
        file_count, event_count, session_count, fact_count,
        started_at, finished_at, last_error, created_at, updated_at
      ) VALUES (
        @shard_key, @provider, @source_group, @scope, @status, @watermark_json,
        @file_count, @event_count, @session_count, @fact_count,
        @started_at, @finished_at, @last_error, @created_at, @updated_at
      )
      ON CONFLICT(shard_key) DO UPDATE SET
        provider = excluded.provider,
        source_group = excluded.source_group,
        scope = excluded.scope,
        status = excluded.status,
        watermark_json = excluded.watermark_json,
        file_count = excluded.file_count,
        event_count = excluded.event_count,
        session_count = excluded.session_count,
        fact_count = excluded.fact_count,
        started_at = excluded.started_at,
        finished_at = excluded.finished_at,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `).run(row);
    return row;
  } finally {
    db.close();
  }
}

function assertShardKey(shardKey, caller) {
  if (!nonEmptyString(shardKey)) {
    throw new TypeError(`${caller}: shardKey must be a non-empty string`);
  }
}

function requireExistingShard(dbPath, shardKey, caller) {
  ensureSchema(dbPath);
  const key = shardKey.trim();
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT shard_key FROM vibedeck_projection_shards WHERE shard_key = ?').get(key);
    if (!row) throw new Error(`${caller}: projection shard not found: ${key}`);
  } finally {
    db.close();
  }
}

function markProjectionShardReady({ dbPath, shardKey, counts = {}, now = new Date() } = {}) {
  assertDbPath(dbPath, 'markProjectionShardReady');
  assertShardKey(shardKey, 'markProjectionShardReady');
  requireExistingShard(dbPath, shardKey, 'markProjectionShardReady');
  const timestamp = isoFromDate(now);
  return upsertProjectionShard({
    dbPath,
    shard: {
      shard_key: shardKey,
      status: 'ready',
      file_count: counts.file_count,
      event_count: counts.event_count,
      session_count: counts.session_count,
      fact_count: counts.fact_count,
      finished_at: timestamp,
      last_error: null,
      updated_at: timestamp,
    },
  });
}

function errorMessage(error) {
  if (error instanceof Error && nonEmptyString(error.message)) return error.message;
  if (nonEmptyString(error)) return error.trim();
  return 'projection shard failed';
}

function markProjectionShardFailed({ dbPath, shardKey, error, now = new Date() } = {}) {
  assertDbPath(dbPath, 'markProjectionShardFailed');
  assertShardKey(shardKey, 'markProjectionShardFailed');
  requireExistingShard(dbPath, shardKey, 'markProjectionShardFailed');
  const timestamp = isoFromDate(now);
  return upsertProjectionShard({
    dbPath,
    shard: {
      shard_key: shardKey,
      status: 'failed',
      finished_at: timestamp,
      last_error: errorMessage(error),
      updated_at: timestamp,
    },
  });
}

function readProjectionFreshness({ dbPath, now = new Date() } = {}) {
  assertDbPath(dbPath, 'readProjectionFreshness');
  void now;
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(`
        SELECT
          scope,
          COUNT(*) AS shard_count,
          SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_count
        FROM vibedeck_projection_shards
        WHERE scope IN ('recent', 'historical')
        GROUP BY scope
      `)
      .all();
    const ready = new Map(rows.map((row) => [
      row.scope,
      row.shard_count > 0 && row.ready_count === row.shard_count,
    ]));
    return {
      recent_ready: ready.get('recent') === true,
      historical_ready: ready.get('historical') === true,
    };
  } finally {
    db.close();
  }
}

module.exports = {
  upsertProjectionShard,
  markProjectionShardReady,
  markProjectionShardFailed,
  readProjectionFreshness,
};
