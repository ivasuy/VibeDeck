'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const {
  markProjectionShardFailed,
  markProjectionShardReady,
  readProjectionFreshness,
  upsertProjectionShard,
} = require('../src/lib/projection-shards');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-projection-shards-'));
  return {
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function openDb(dbPath, options) {
  return new DatabaseSync(dbPath, options);
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
}

test('migration 016 creates additive projection shard metadata table', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    ensureSchema(tmp.dbPath);

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const columns = tableColumns(db, 'vibedeck_projection_shards');
      assert.deepEqual(columns, [
        'shard_key',
        'provider',
        'source_group',
        'scope',
        'status',
        'watermark_json',
        'file_count',
        'event_count',
        'session_count',
        'fact_count',
        'started_at',
        'finished_at',
        'last_error',
        'created_at',
        'updated_at',
      ]);

      const canonicalColumns = tableColumns(db, 'vibedeck_sessions');
      assert.ok(canonicalColumns.includes('session_id'));
      assert.ok(!canonicalColumns.includes('shard_key'));
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('upsertProjectionShard inserts and updates shard metadata', () => {
  const tmp = makeDb();
  try {
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'codex:recent',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'recent',
        status: 'building',
        watermark_json: JSON.stringify({ since: '2026-05-29T00:00:00.000Z' }),
        file_count: 2,
        event_count: 10,
        started_at: '2026-05-29T01:00:00.000Z',
        created_at: '2026-05-29T01:00:00.000Z',
        updated_at: '2026-05-29T01:00:00.000Z',
      },
    });
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'codex:recent',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'recent',
        status: 'stale',
        event_count: 12,
        updated_at: '2026-05-29T01:05:00.000Z',
      },
    });

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const row = db.prepare('SELECT * FROM vibedeck_projection_shards WHERE shard_key = ?').get('codex:recent');
      assert.equal(row.provider, 'codex');
      assert.equal(row.source_group, 'codex-jsonl');
      assert.equal(row.scope, 'recent');
      assert.equal(row.status, 'stale');
      assert.equal(row.watermark_json, '{"since":"2026-05-29T00:00:00.000Z"}');
      assert.equal(row.file_count, 2);
      assert.equal(row.event_count, 12);
      assert.equal(row.session_count, 0);
      assert.equal(row.fact_count, 0);
      assert.equal(row.created_at, '2026-05-29T01:00:00.000Z');
      assert.equal(row.updated_at, '2026-05-29T01:05:00.000Z');

      const sessionCount = db.prepare('SELECT COUNT(*) AS count FROM vibedeck_sessions').get().count;
      const factCount = db.prepare('SELECT COUNT(*) AS count FROM vibedeck_branch_usage_facts').get().count;
      assert.equal(sessionCount, 0);
      assert.equal(factCount, 0);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('upsertProjectionShard rejects new shards without required metadata', () => {
  const tmp = makeDb();
  try {
    assert.throws(
      () => upsertProjectionShard({
        dbPath: tmp.dbPath,
        shard: {
          shard_key: 'codex:recent',
          status: 'pending',
        },
      }),
      /provider must be a non-empty string/,
    );

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM vibedeck_projection_shards').get().count;
      assert.equal(count, 0);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('markProjectionShardReady records counts and clears failure state', () => {
  const tmp = makeDb();
  try {
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'claude:historical',
        provider: 'claude',
        source_group: 'claude-jsonl',
        scope: 'historical',
        status: 'failed',
        last_error: 'previous failure',
        created_at: '2026-05-29T01:00:00.000Z',
        updated_at: '2026-05-29T01:00:00.000Z',
      },
    });

    const row = markProjectionShardReady({
      dbPath: tmp.dbPath,
      shardKey: 'claude:historical',
      counts: {
        file_count: 4,
        event_count: 40,
        session_count: 3,
        fact_count: 6,
      },
      now: new Date('2026-05-29T02:00:00.000Z'),
    });

    assert.equal(row.status, 'ready');
    assert.equal(row.last_error, null);
    assert.equal(row.finished_at, '2026-05-29T02:00:00.000Z');

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const stored = db
        .prepare('SELECT status, file_count, event_count, session_count, fact_count, finished_at, last_error, updated_at FROM vibedeck_projection_shards WHERE shard_key = ?')
        .get('claude:historical');
      assert.deepEqual({ ...stored }, {
        status: 'ready',
        file_count: 4,
        event_count: 40,
        session_count: 3,
        fact_count: 6,
        finished_at: '2026-05-29T02:00:00.000Z',
        last_error: null,
        updated_at: '2026-05-29T02:00:00.000Z',
      });
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('markProjectionShardReady rejects missing shards instead of creating unknown metadata', () => {
  const tmp = makeDb();
  try {
    assert.throws(
      () => markProjectionShardReady({
        dbPath: tmp.dbPath,
        shardKey: 'typo:recent',
        now: new Date('2026-05-29T02:00:00.000Z'),
      }),
      /projection shard not found: typo:recent/,
    );

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM vibedeck_projection_shards').get().count;
      assert.equal(count, 0);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('markProjectionShardFailed records failure status and error text', () => {
  const tmp = makeDb();
  try {
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'cursor:recent',
        provider: 'cursor',
        source_group: 'cursor-account',
        scope: 'recent',
        status: 'building',
        created_at: '2026-05-29T01:00:00.000Z',
        updated_at: '2026-05-29T01:00:00.000Z',
      },
    });

    const row = markProjectionShardFailed({
      dbPath: tmp.dbPath,
      shardKey: 'cursor:recent',
      error: new Error('cursor source unavailable'),
      now: new Date('2026-05-29T02:30:00.000Z'),
    });

    assert.equal(row.status, 'failed');
    assert.equal(row.last_error, 'cursor source unavailable');

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const stored = db
        .prepare('SELECT status, finished_at, last_error, updated_at FROM vibedeck_projection_shards WHERE shard_key = ?')
        .get('cursor:recent');
      assert.deepEqual({ ...stored }, {
        status: 'failed',
        finished_at: '2026-05-29T02:30:00.000Z',
        last_error: 'cursor source unavailable',
        updated_at: '2026-05-29T02:30:00.000Z',
      });
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('markProjectionShardFailed rejects missing shards instead of creating unknown metadata', () => {
  const tmp = makeDb();
  try {
    assert.throws(
      () => markProjectionShardFailed({
        dbPath: tmp.dbPath,
        shardKey: 'typo:recent',
        error: 'no source',
        now: new Date('2026-05-29T02:30:00.000Z'),
      }),
      /projection shard not found: typo:recent/,
    );

    const db = openDb(tmp.dbPath, { readOnly: true });
    try {
      const count = db.prepare('SELECT COUNT(*) AS count FROM vibedeck_projection_shards').get().count;
      assert.equal(count, 0);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('readProjectionFreshness reports recent and historical readiness from shard status', () => {
  const tmp = makeDb();
  try {
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'codex:recent',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'recent',
        status: 'ready',
        created_at: '2026-05-29T01:00:00.000Z',
        updated_at: '2026-05-29T01:00:00.000Z',
      },
    });
    upsertProjectionShard({
      dbPath: tmp.dbPath,
      shard: {
        shard_key: 'codex:historical',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'historical',
        status: 'failed',
        created_at: '2026-05-29T01:00:00.000Z',
        updated_at: '2026-05-29T01:00:00.000Z',
      },
    });

    assert.deepEqual(readProjectionFreshness({ dbPath: tmp.dbPath }), {
      recent_ready: true,
      historical_ready: false,
    });

    markProjectionShardReady({
      dbPath: tmp.dbPath,
      shardKey: 'codex:historical',
      now: new Date('2026-05-29T03:00:00.000Z'),
    });

    assert.deepEqual(readProjectionFreshness({ dbPath: tmp.dbPath }), {
      recent_ready: true,
      historical_ready: true,
    });
  } finally {
    tmp.cleanup();
  }
});

test('readProjectionFreshness requires every shard in a scope to be ready', () => {
  const tmp = makeDb();
  try {
    for (const shard of [
      {
        shard_key: 'codex:recent',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'recent',
        status: 'ready',
      },
      {
        shard_key: 'claude:recent',
        provider: 'claude',
        source_group: 'claude-jsonl',
        scope: 'recent',
        status: 'failed',
      },
      {
        shard_key: 'codex:historical',
        provider: 'codex',
        source_group: 'codex-jsonl',
        scope: 'historical',
        status: 'ready',
      },
      {
        shard_key: 'claude:historical',
        provider: 'claude',
        source_group: 'claude-jsonl',
        scope: 'historical',
        status: 'stale',
      },
    ]) {
      upsertProjectionShard({
        dbPath: tmp.dbPath,
        shard: {
          ...shard,
          created_at: '2026-05-29T01:00:00.000Z',
          updated_at: '2026-05-29T01:00:00.000Z',
        },
      });
    }

    assert.deepEqual(readProjectionFreshness({ dbPath: tmp.dbPath }), {
      recent_ready: false,
      historical_ready: false,
    });
  } finally {
    tmp.cleanup();
  }
});
