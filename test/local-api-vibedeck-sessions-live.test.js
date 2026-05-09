const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { DatabaseSync } = require('node:sqlite');
const { getLiveBus } = require('../src/lib/sessions/live-bus');
const { createLocalApiHandler } = require('../src/lib/local-api');

async function startLocalApiServer({ queuePath }) {
  const handler = createLocalApiHandler({ queuePath });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await handler(req, res, url);
    if (handled) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : null;
  if (!port) throw new Error('failed to bind test server');
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, 'close');
    },
  };
}

function createSseClient(url) {
  const req = http.get(url, {
    headers: {
      Accept: 'text/event-stream',
    },
  });
  return req;
}

function parseSseEvents(buffer) {
  const out = [];
  const parts = buffer.split('\n\n');
  const keep = parts.pop() || '';
  for (const part of parts) {
    const lines = part.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        out.push(JSON.parse(line.slice('data: '.length)));
      }
    }
  }
  return { events: out, rest: keep };
}

test('vibedeck-sessions-live streams snapshot then deltas', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');

  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 's-live-1', '2026-05-09T00:00:00.000Z', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      NULL, 3, 0.0,
      '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z'
    );`,
  );
  db.close();

  const srv = await startLocalApiServer({ queuePath });
  try {
    const req = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    const res = await once(req, 'response').then(([r]) => r);
    assert.equal(res.statusCode, 200);

    let buf = '';
    const got = [];
    res.setEncoding('utf8');

    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for SSE events')), 3000);
      res.on('data', (chunk) => {
        buf += chunk;
        const parsed = parseSseEvents(buf);
        buf = parsed.rest;
        for (const e of parsed.events) {
          got.push(e);
          if (got.length >= 2) {
            clearTimeout(timeout);
            resolve();
          }
        }
      });
      res.on('error', reject);
    });

    const bus = getLiveBus();
    bus.emit('session:update', {
      provider: 'codex',
      session_id: 's-live-1',
      observed_at: '2026-05-09T00:01:00.000Z',
      total_tokens: 5,
    });

    await done;
    assert.equal(got[0].type, 'snapshot');
    assert.ok(Array.isArray(got[0].sessions));
    assert.equal(got[0].sessions.length, 1);
    assert.equal(got[0].sessions[0].session_id, 's-live-1');

    assert.equal(got[1].type, 'session:update');
    assert.equal(got[1].provider, 'codex');
    assert.equal(got[1].session_id, 's-live-1');
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live rejects 11th client with 503 + Retry-After', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-cap-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const srv = await startLocalApiServer({ queuePath });
  const clients = [];
  try {
    for (let i = 0; i < 10; i++) {
      const req = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
      const res = await once(req, 'response').then(([r]) => r);
      assert.equal(res.statusCode, 200);
      clients.push({ req, res });
    }

    const req11 = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    const res11 = await once(req11, 'response').then(([r]) => r);
    assert.equal(res11.statusCode, 503);
    assert.equal(res11.headers['retry-after'], '30');
    res11.resume();
    req11.destroy();
  } finally {
    for (const c of clients) {
      c.req.destroy();
      c.res.destroy();
    }
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live drops oldest events when client falls behind', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-backpressure-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const srv = await startLocalApiServer({ queuePath });
  try {
    const req = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    const res = await once(req, 'response').then(([r]) => r);
    assert.equal(res.statusCode, 200);

    // Intentionally do NOT drain the response; allow server-side backpressure to build.
    res.pause();

    const bus = getLiveBus();
    for (let i = 0; i < 1200; i++) {
      bus.emit('session:update', {
        provider: 'codex',
        session_id: 'slow-client',
        observed_at: `2026-05-09T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`,
        total_tokens: i,
      });
    }

    // Give the server a beat to enqueue and start dropping.
    await new Promise((r) => setTimeout(r, 50));

    // Resume briefly to read a couple events; at least one should report dropped.
    res.resume();
    res.setEncoding('utf8');

    let buf = '';
    let sawDrop = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for drop report')), 2000);
      res.on('data', (chunk) => {
        buf += chunk;
        const parsed = parseSseEvents(buf);
        buf = parsed.rest;
        for (const e of parsed.events) {
          if (typeof e.dropped === 'number' && e.dropped > 0) {
            sawDrop = true;
            clearTimeout(timeout);
            resolve();
            break;
          }
        }
      });
      res.on('error', reject);
    });

    assert.equal(sawDrop, true);
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live disconnects idle clients (test override)', { timeout: 30_000 }, async () => {
  process.env.VIBEDECK_SSE_IDLE_MS = '50';
  process.env.VIBEDECK_SSE_IDLE_SCAN_MS = '10';
  process.env.VIBEDECK_SSE_HEARTBEAT_MS = '1000000';

  delete require.cache[require.resolve('../src/lib/local-api')];
  const api = require('../src/lib/local-api');
  const { createLocalApiHandler: createHandler, resetLiveSseStateForTests } = api;
  assert.equal(api._debugSse.idleMs, 50);
  assert.equal(api._debugSse.idleScanMs, 10);
  resetLiveSseStateForTests();

  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-idle-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const handler = createHandler({ queuePath });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await handler(req, res, url);
    if (handled) return;
    res.writeHead(404);
    res.end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : null;
  assert.ok(port);

  try {
    const req = createSseClient(`http://127.0.0.1:${port}/functions/vibedeck-sessions-live`);
    const res = await once(req, 'response').then(([r]) => r);
    assert.equal(res.statusCode, 200);
    res.resume();

    // Wait for idle reaper to close the socket.
    await Promise.race([
      Promise.race([once(res, 'end'), once(res, 'close')]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('idle disconnect timeout')), 3000)),
    ]);
    req.destroy();
    res.destroy();
  } finally {
    resetLiveSseStateForTests();
    server.close();
    await once(server, 'close');
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.VIBEDECK_SSE_IDLE_MS;
    delete process.env.VIBEDECK_SSE_IDLE_SCAN_MS;
    delete process.env.VIBEDECK_SSE_HEARTBEAT_MS;
    delete require.cache[require.resolve('../src/lib/local-api')];
  }
});

test('cursor-style update event without cwd includes last_observed_at', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-cursor-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const srv = await startLocalApiServer({ queuePath });
  try {
    const req = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    const res = await once(req, 'response').then(([r]) => r);
    assert.equal(res.statusCode, 200);
    res.setEncoding('utf8');
    res.resume();

    let buf = '';
    const got = [];
    let resolveSnapshot;
    let resolveUpdate;
    const snapshotPromise = new Promise((resolve) => {
      resolveSnapshot = resolve;
    });
    const updatePromise = new Promise((resolve) => {
      resolveUpdate = resolve;
    });
    const timeout = setTimeout(() => resolveUpdate(new Error('timeout waiting for cursor update')), 3000);
    const snapshotTimeout = setTimeout(() => resolveSnapshot(new Error('timeout waiting for snapshot')), 1000);

    res.on('data', (chunk) => {
      buf += chunk;
      const parsed = parseSseEvents(buf);
      buf = parsed.rest;
      for (const e of parsed.events) {
        got.push(e);
        if (e.type === 'snapshot') resolveSnapshot();
        if (e.type === 'session:update') resolveUpdate();
      }
    });

    // Ensure the server wrote the snapshot (and is actively streaming) before emitting.
    const snapResult = await snapshotPromise;
    clearTimeout(snapshotTimeout);
    if (snapResult instanceof Error) throw snapResult;

    const bus = getLiveBus();
    bus.emit('session:update', {
      provider: 'cursor',
      session_id: 'cursor-1',
      cwd: null,
      observed_at: '2026-05-09T00:02:00.000Z',
      total_tokens: 10,
    });

    const updateResult = await updatePromise;
    clearTimeout(timeout);
    if (updateResult instanceof Error) throw updateResult;
    const update = got.find((e) => e.type === 'session:update');
    assert.equal(update.provider, 'cursor');
    assert.equal(update.session_id, 'cursor-1');
    assert.equal(update.cwd, null);
    assert.equal(update.last_observed_at, '2026-05-09T00:02:00.000Z');
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('claude-code style sessions appear in snapshot with totals', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-claude-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'claude', 'claude-live-1', '2026-05-09T00:00:00.000Z', NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      'claude-3-7-sonnet', 123, 0.0,
      '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z'
    );`,
  );
  db.close();

  const srv = await startLocalApiServer({ queuePath });
  try {
    const req = createSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    const res = await once(req, 'response').then(([r]) => r);
    assert.equal(res.statusCode, 200);
    res.setEncoding('utf8');

    let buf = '';
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for snapshot')), 3000);
      res.on('data', (chunk) => {
        buf += chunk;
        const parsed = parseSseEvents(buf);
        buf = parsed.rest;
        const snap = parsed.events.find((e) => e.type === 'snapshot');
        if (snap) {
          clearTimeout(timeout);
          resolve(snap);
        }
      });
      res.on('error', reject);
    });

    const row = snapshot.sessions.find((s) => s.session_id === 'claude-live-1');
    assert.ok(row);
    assert.equal(row.provider, 'claude');
    assert.equal(row.total_tokens, 123);
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
