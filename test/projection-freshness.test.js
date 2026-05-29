'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');
const { upsertProjectionShard } = require('../src/lib/projection-shards');
const { readProjectionFreshnessPayload } = require('../src/lib/projection-freshness');

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-projection-freshness-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  fs.writeFileSync(queuePath, '', 'utf8');
  ensureSchema(dbPath);
  return {
    dir,
    queuePath,
    dbPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function call(handler, route) {
  const chunks = [];
  const headers = {};
  let statusCode = 200;
  const url = new URL(`http://127.0.0.1${route}`);
  const req = {
    method: 'GET',
    url: url.pathname + url.search,
    headers: { host: '127.0.0.1' },
  };
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    writeHead(code, nextHeaders = {}) {
      statusCode = code;
      for (const [name, value] of Object.entries(nextHeaders)) {
        headers[String(name).toLowerCase()] = value;
      }
    },
    write(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    },
    end(body) {
      if (body) chunks.push(Buffer.isBuffer(body) ? body.toString('utf8') : String(body));
    },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true, `${route} must be handled`);
  return { statusCode, headers, body: chunks.join('') };
}

function insertShard(dbPath, shard) {
  upsertProjectionShard({
    dbPath,
    shard: {
      provider: 'codex',
      source_group: 'codex-jsonl',
      created_at: '2026-05-29T01:00:00.000Z',
      updated_at: '2026-05-29T01:00:00.000Z',
      ...shard,
    },
  });
}

test('readProjectionFreshnessPayload reports empty mode when no projection shards exist', () => {
  const f = makeFixture();
  try {
    assert.deepEqual(readProjectionFreshnessPayload({ dbPath: f.dbPath }), {
      mode: 'empty',
      recent_ready: false,
      historical_ready: false,
      active_rebuild: false,
      complete_through: null,
      indexing_providers: [],
      failed_shards: [],
    });
  } finally {
    f.cleanup();
  }
});

test('readProjectionFreshnessPayload reports partial mode for incomplete projection shards', () => {
  const f = makeFixture();
  try {
    insertShard(f.dbPath, {
      shard_key: 'codex:recent',
      scope: 'recent',
      status: 'ready',
      finished_at: '2026-05-29T02:00:00.000Z',
    });
    insertShard(f.dbPath, {
      shard_key: 'codex:historical',
      scope: 'historical',
      status: 'building',
      started_at: '2026-05-29T02:05:00.000Z',
    });

    assert.deepEqual(readProjectionFreshnessPayload({ dbPath: f.dbPath }), {
      mode: 'partial',
      recent_ready: true,
      historical_ready: false,
      active_rebuild: true,
      complete_through: null,
      indexing_providers: ['codex'],
      failed_shards: [],
    });
  } finally {
    f.cleanup();
  }
});

test('readProjectionFreshnessPayload reports complete mode when recent and historical shards are ready', () => {
  const f = makeFixture();
  try {
    insertShard(f.dbPath, {
      shard_key: 'codex:recent',
      scope: 'recent',
      status: 'ready',
      watermark_json: JSON.stringify({ rebuilt_at: '2026-05-29T04:00:00.000Z' }),
      finished_at: '2026-05-29T04:00:00.000Z',
    });
    insertShard(f.dbPath, {
      shard_key: 'codex:historical',
      scope: 'historical',
      status: 'ready',
      watermark_json: JSON.stringify({ rebuilt_at: '2026-05-29T03:00:00.000Z' }),
      finished_at: '2026-05-29T03:00:00.000Z',
    });

    assert.deepEqual(readProjectionFreshnessPayload({ dbPath: f.dbPath }), {
      mode: 'complete',
      recent_ready: true,
      historical_ready: true,
      active_rebuild: false,
      complete_through: '2026-05-29T03:00:00.000Z',
      indexing_providers: [],
      failed_shards: [],
    });
  } finally {
    f.cleanup();
  }
});

test('readProjectionFreshnessPayload exposes failed shard metadata without mutating canonical facts', () => {
  const f = makeFixture();
  try {
    insertShard(f.dbPath, {
      shard_key: 'claude:recent',
      provider: 'claude',
      source_group: 'claude-jsonl',
      scope: 'recent',
      status: 'failed',
      last_error: 'bad json',
      updated_at: '2026-05-29T05:00:00.000Z',
    });

    const payload = readProjectionFreshnessPayload({ dbPath: f.dbPath });
    assert.equal(payload.mode, 'partial');
    assert.equal(payload.active_rebuild, false);
    assert.deepEqual(payload.failed_shards, [
      {
        shard_key: 'claude:recent',
        provider: 'claude',
        scope: 'recent',
        error: 'bad json',
        updated_at: '2026-05-29T05:00:00.000Z',
      },
    ]);

    const db = new DatabaseSync(f.dbPath, { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get().c, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS c FROM vibedeck_branch_usage_facts').get().c, 0);
    } finally {
      db.close();
    }
  } finally {
    f.cleanup();
  }
});

test('local usage summary attaches freshness so an empty DB does not look complete', async () => {
  const f = makeFixture();
  try {
    const payload = JSON.parse((await call(
      createLocalApiHandler({ queuePath: f.queuePath }),
      '/functions/vibedeck-usage-summary?from=2026-05-29&to=2026-05-29&tz=UTC',
    )).body);

    assert.equal(payload.totals.total_tokens, 0);
    assert.equal(payload.freshness.mode, 'empty');
    assert.equal(payload.freshness.recent_ready, false);
    assert.equal(payload.freshness.historical_ready, false);
  } finally {
    f.cleanup();
  }
});

test('local startup snapshot exposes projection freshness metadata additively', async () => {
  const f = makeFixture();
  try {
    insertShard(f.dbPath, {
      shard_key: 'codex:recent',
      scope: 'recent',
      status: 'ready',
      finished_at: '2026-05-29T02:00:00.000Z',
    });
    insertShard(f.dbPath, {
      shard_key: 'codex:historical',
      scope: 'historical',
      status: 'building',
      started_at: '2026-05-29T02:05:00.000Z',
    });

    const payload = JSON.parse((await call(
      createLocalApiHandler({ queuePath: f.queuePath }),
      '/functions/vibedeck-startup-snapshot',
    )).body);

    assert.equal(payload.ok, true);
    assert.equal(payload.source, 'snapshot');
    assert.equal(payload.freshness.mode, 'partial');
    assert.equal(payload.freshness.active_rebuild, true);
  } finally {
    f.cleanup();
  }
});

test('local startup snapshot preserves snapshot freshness mode when projection DB is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-projection-freshness-no-db-'));
  try {
    const queuePath = path.join(dir, 'queue.jsonl');
    fs.writeFileSync(queuePath, '', 'utf8');

    const payload = JSON.parse((await call(
      createLocalApiHandler({ queuePath }),
      '/functions/vibedeck-startup-snapshot',
    )).body);

    assert.equal(payload.ok, true);
    assert.equal(payload.source, 'snapshot');
    assert.equal(payload.freshness.mode, 'snapshot');
    assert.equal(payload.freshness.complete_through, null);
    assert.deepEqual(payload.freshness.indexing_providers, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
