const assert = require('node:assert/strict');
const http = require('node:http');
const { EventEmitter, once } = require('node:events');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { afterEach, test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { DatabaseSync } = require('node:sqlite');
const { getLiveBus } = require('../src/lib/sessions/live-bus');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');
const { createLocalApiHandler } = require('../src/lib/local-api');

function resetLiveSseState() {
  try {
    require('../src/lib/local-api').resetLiveSseStateForTests();
  } catch {}
}

afterEach(() => {
  resetLiveSseState();
});

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

function connectSseClient(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {
      headers: {
        Accept: 'text/event-stream',
      },
    }, (res) => {
      resolve({ req, res });
    });
    req.on('error', reject);
  });
}

function createMockSseExchange() {
  const writes = [];
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: 'localhost' };
  req.destroy = () => {};

  const res = new EventEmitter();
  res.statusCode = null;
  res.headers = null;
  res.writeHead = (statusCode, headers) => {
    res.statusCode = statusCode;
    res.headers = headers;
  };
  res.write = (chunk) => {
    writes.push(String(chunk));
    return true;
  };
  res.end = () => {};

  return {
    req,
    res,
    readEvents() {
      return parseSseEvents(writes.join('')).events;
    },
    close() {
      res.emit('close');
    },
  };
}

async function flushAsyncEvents() {
  await new Promise((resolve) => setImmediate(resolve));
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

test('vibedeck-sessions-live streams snapshot then deltas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');

  ensureSchema(dbPath);
  const liveNow = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 's-live-1', '${liveNow}', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      NULL, 3, 0.0,
      '${liveNow}', '${liveNow}'
    );`,
  );
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);
    assert.equal(exchange.res.statusCode, 200);

    await flushAsyncEvents();
    const snapshotEvents = exchange.readEvents();
    assert.equal(snapshotEvents[0].type, 'snapshot');
    assert.ok(Array.isArray(snapshotEvents[0].sessions));
    assert.equal(snapshotEvents[0].sessions.length, 1);
    assert.equal(Array.isArray(snapshotEvents[0].workstreams), true);
    assert.equal(typeof snapshotEvents[0].totals, "object");
    assert.equal(snapshotEvents[0].totals.active_sessions, 1);
    assert.equal(snapshotEvents[0].sessions[0].session_id, 's-live-1');
    assert.equal(snapshotEvents[0].sessions[0].estimated_total_cost_usd, null);
    assert.equal(snapshotEvents[0].sessions[0].cost_estimated, true);
    assert.equal(snapshotEvents[0].sessions[0].cost_quality, 'pricing_missing');

    const bus = getLiveBus();
    bus.emit('session:update', {
      provider: 'codex',
      session_id: 's-live-1',
      observed_at: '2026-05-09T00:01:00.000Z',
      model: 'gpt-5.4',
      total_tokens: 5,
    });

    await flushAsyncEvents();
    const events = exchange.readEvents();
    assert.equal(events[1].type, 'session:update');
    assert.equal(events[1].provider, 'codex');
    assert.equal(events[1].session_id, 's-live-1');
    assert.ok(events[1].estimated_total_cost_usd > 0);
    assert.equal(events[1].cost_estimated, true);
    assert.equal(events[1].cost_quality, 'estimated_total_tokens');
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live snapshot estimates positive-token known-model rows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-estimated-cost-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');

  ensureSchema(dbPath);
  const liveNow = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 's-est-1', '${liveNow}', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      'gpt-5.4', 1000, NULL,
      '${liveNow}', '${liveNow}'
    );`,
  );
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);
    assert.equal(exchange.res.statusCode, 200);

    await flushAsyncEvents();
    const snapshot = exchange.readEvents().find((event) => event.type === 'snapshot');
    assert.ok(snapshot);

    const row = snapshot.sessions.find((session) => session.session_id === 's-est-1');
    assert.ok(row);
    assert.equal(row.total_cost_usd, null);
    assert.ok(row.estimated_total_cost_usd > 0);
    assert.equal(row.cost_estimated, true);
    assert.equal(row.cost_quality, 'estimated_total_tokens');
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live snapshot recalculates active cost from current tokens and model', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-active-cost-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');

  ensureSchema(dbPath);
  const liveNow = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 's-active-stale-cost', '${liveNow}', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      'gpt-5.3-codex-spark', 1000000, 999,
      '${liveNow}', '${liveNow}'
    );`,
  );
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);

    await flushAsyncEvents();
    const snapshot = exchange.readEvents().find((event) => event.type === 'snapshot');
    const row = snapshot.sessions.find((session) => session.session_id === 's-active-stale-cost');
    assert.ok(row);
    assert.equal(row.total_cost_usd, 999);
    assert.notEqual(row.estimated_total_cost_usd, 999);
    assert.ok(row.estimated_total_cost_usd > 0);
    assert.equal(row.cost_estimated, true);
    assert.equal(row.cost_quality, 'estimated_total_tokens');
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live snapshot prices active codex rows from token buckets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-active-buckets-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const sessionPath = path.join(root, 'rollout.jsonl');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  await fs.writeFile(
    sessionPath,
    [
      JSON.stringify({
        timestamp: '2026-05-11T01:01:00.000Z',
        payload: {
          type: 'token_count',
          info: {
            last_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 800,
              output_tokens: 50,
              reasoning_output_tokens: 0,
              total_tokens: 1050,
            },
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );

  ensureSchema(dbPath);
  const liveNow = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.prepare(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens,
      created_at, updated_at
    ) VALUES (?, ?, ?, NULL, NULL, '/tmp', NULL, NULL, NULL, NULL, 'D', 'unattributed', NULL, 'gpt-5.5', 777, NULL, 9000, 9000, 0, 9000, 0, ?, ?)`,
  ).run('codex', sessionPath, liveNow, liveNow, liveNow);
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);

    await flushAsyncEvents();
    const snapshot = exchange.readEvents().find((event) => event.type === 'snapshot');
    const row = snapshot.sessions.find((session) => session.session_id === sessionPath);
    assert.ok(row);
    assert.equal(row.total_tokens, 1050);
    assert.equal(row.input_tokens, 200);
    assert.equal(row.cached_input_tokens, 800);
    assert.equal(row.output_tokens, 50);
    assert.equal(row.estimated_total_cost_usd, 0.0029);
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live snapshot includes live workstreams with recent ended session breakdown', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-workstreams-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');

  ensureSchema(dbPath);
  const now = new Date();
  const startedMain = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
  const startedRelated = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  const endedRelated = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const updatedMain = new Date(now.getTime() - 30 * 1000).toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES
    (
      'codex', 'main-live', '${startedMain}', NULL, NULL,
      '${repoRoot}', '${repoRoot}', NULL, NULL,
      'publish-main', 'A', 'high', NULL,
      'gpt-5.5', 1000, 0.50,
      '${startedMain}', '${updatedMain}'
    ),
    (
      'codex', 'related-ended', '${startedRelated}', '${endedRelated}', 'complete',
      '${repoRoot}', '${repoRoot}', NULL, NULL,
      'dashboard', 'B', 'medium', NULL,
      'gpt-5.3-codex-spark', 500, 0.20,
      '${startedRelated}', '${endedRelated}'
    );`,
  );
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);

    await flushAsyncEvents();
    const snapshot = exchange.readEvents().find((event) => event.type === 'snapshot');
    assert.ok(snapshot);
    assert.equal(snapshot.sessions.length, 2);
    assert.ok(Array.isArray(snapshot.workstreams));
    assert.equal(snapshot.workstreams.length, 1);

    const workstream = snapshot.workstreams[0];
    assert.equal(workstream.repo_root, repoRoot);
    assert.deepEqual(workstream.branches.sort(), ['dashboard', 'publish-main']);
    assert.equal(workstream.active_session_count, 1);
    assert.equal(workstream.recently_completed_count, 1);
    assert.equal(workstream.active_total_tokens, 1000);
    assert.equal(workstream.audit_total_tokens, 1500);
    assert.equal(workstream.active_total_cost_usd, 0.5);
    assert.equal(workstream.audit_total_cost_usd, 0.7);
    assert.equal(workstream.primary_session.session_id, 'main-live');
    assert.equal(workstream.branch_groups.length, 2);
    const dashboardBranch = workstream.branch_groups.find((group) => group.branch === 'dashboard');
    assert.ok(dashboardBranch);
    assert.equal(dashboardBranch.audit_session_count, 1);
    assert.equal(dashboardBranch.active_session_count, 0);
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live keeps recent log_complete sessions active and streams updates', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-current-log-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const srv = await startLocalApiServer({ queuePath });
  try {
    const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
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
    const snapshotTimeout = setTimeout(() => resolveSnapshot(new Error('timeout waiting for snapshot')), 1000);
    const updateTimeout = setTimeout(() => resolveUpdate(new Error('timeout waiting for checkpoint update')), 3000);

    res.on('data', (chunk) => {
      buf += chunk;
      const parsed = parseSseEvents(buf);
      buf = parsed.rest;
      for (const e of parsed.events) {
        got.push(e);
        if (e.type === 'snapshot') resolveSnapshot();
        if (e.type === 'session:update' && e.session_id === 'current-session') resolveUpdate();
      }
    });

    const snapResult = await snapshotPromise;
    clearTimeout(snapshotTimeout);
    if (snapResult instanceof Error) throw snapResult;

    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const observed = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'current-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'current-session',
      observed_at: observed,
      delta_tokens: 1000,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'current-session',
      ended_at: observed,
      total_tokens: 1000,
      end_reason: 'log_complete',
      cwd: root,
      model: 'gpt-5.4',
    });

    const updateResult = await updatePromise;
    clearTimeout(updateTimeout);
    if (updateResult instanceof Error) throw updateResult;

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare('SELECT ended_at FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
      .get('codex', 'current-session');
    db.close();

    assert.equal(row?.ended_at, null);
    assert.ok(got.some((e) => e.type === 'session:update' && e.session_id === 'current-session'));
    assert.equal(got.some((e) => e.type === 'session:end' && e.session_id === 'current-session'), false);
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live emits rollup:update after canonical session update', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-rollup-update-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const srv = await startLocalApiServer({ queuePath });
  try {
    const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    assert.equal(res.statusCode, 200);
    res.setEncoding('utf8');
    res.resume();

    let buf = '';
    const events = [];
    let resolveSnapshot;
    let resolveSessionUpdate;
    let resolveRollupUpdate;
    const snapshotPromise = new Promise((resolve) => { resolveSnapshot = resolve; });
    const sessionUpdatePromise = new Promise((resolve) => { resolveSessionUpdate = resolve; });
    const rollupUpdatePromise = new Promise((resolve) => { resolveRollupUpdate = resolve; });
    const snapshotTimeout = setTimeout(() => resolveSnapshot(new Error('timeout waiting for snapshot')), 1000);
    const sessionUpdateTimeout = setTimeout(() => resolveSessionUpdate(new Error('timeout waiting for session:update')), 3000);
    const rollupUpdateTimeout = setTimeout(() => resolveRollupUpdate(new Error('timeout waiting for rollup:update')), 5000);

    res.on('data', (chunk) => {
      buf += chunk;
      const parsed = parseSseEvents(buf);
      buf = parsed.rest;
      for (const event of parsed.events) {
        events.push(event);
        if (event.type === 'snapshot') resolveSnapshot();
        if (event.type === 'session:update' && event.session_id === 'rollup-session') resolveSessionUpdate();
        if (event.type === 'rollup:update') resolveRollupUpdate();
      }
    });

    const snapResult = await snapshotPromise;
    clearTimeout(snapshotTimeout);
    if (snapResult instanceof Error) throw snapResult;

    const started = new Date(Date.now() - 30_000).toISOString();
    const observed = new Date().toISOString();
    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'rollup-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'rollup-session',
      observed_at: observed,
      delta_tokens: 1200,
      cwd: root,
      model: 'gpt-5.4',
    });

    const sessionUpdateResult = await sessionUpdatePromise;
    clearTimeout(sessionUpdateTimeout);
    if (sessionUpdateResult instanceof Error) throw sessionUpdateResult;

    const rollupUpdateResult = await rollupUpdatePromise;
    clearTimeout(rollupUpdateTimeout);
    if (rollupUpdateResult instanceof Error) throw rollupUpdateResult;

    const sessionUpdate = events.find((event) => event.type === 'session:update' && event.session_id === 'rollup-session');
    assert.ok(sessionUpdate);
    assert.equal(typeof sessionUpdate.cwd, 'string');
    assert.equal(sessionUpdate.repo_root, null);
    assert.equal(sessionUpdate.repo_common_dir, null);
    assert.equal(sessionUpdate.parent_repo, null);
    assert.equal(sessionUpdate.tier, 'D');
    assert.equal(sessionUpdate.branch_resolution_tier, 'D');
    assert.equal(sessionUpdate.confidence, 'unattributed');
    assert.equal(typeof sessionUpdate.started_at, 'string');
    assert.equal(typeof sessionUpdate.last_observed_at, 'string');
    assert.equal(typeof sessionUpdate.updated_at, 'string');

    const rollupUpdate = events.find((event) => event.type === 'rollup:update');
    assert.ok(rollupUpdate);
    assert.equal(Array.isArray(rollupUpdate.workstreams), true);
    assert.equal(typeof rollupUpdate.totals, 'object');
    assert.equal(rollupUpdate.totals.active_sessions, 1);
    assert.ok((rollupUpdate.totals.active_tokens || 0) >= 1200);
    assert.ok((rollupUpdate.totals.audit_tokens || 0) >= 1200);

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
      const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
      assert.equal(res.statusCode, 200);
      clients.push({ req, res });
    }

    const { req: req11, res: res11 } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
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
    const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
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
    const { req, res } = await connectSseClient(`http://127.0.0.1:${port}/functions/vibedeck-sessions-live`);
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
    const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
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

test('claude-code style sessions appear in snapshot with totals', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-claude-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const queuePath = path.join(trackerDir, 'queue.jsonl');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  ensureSchema(dbPath);

  const liveNow = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'claude', 'claude-live-1', '${liveNow}', NULL, NULL,
      NULL, NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      'claude-3-7-sonnet', 123, 0.0,
      '${liveNow}', '${liveNow}'
    );`,
  );
  db.close();

  try {
    const exchange = createMockSseExchange();
    const handler = createLocalApiHandler({ queuePath });
    const handled = await handler(exchange.req, exchange.res, new URL('http://localhost/functions/vibedeck-sessions-live'));
    assert.equal(handled, true);
    assert.equal(exchange.res.statusCode, 200);

    await flushAsyncEvents();
    const snapshot = exchange.readEvents().find((event) => event.type === 'snapshot');
    assert.ok(snapshot);

    const row = snapshot.sessions.find((s) => s.session_id === 'claude-live-1');
    assert.ok(row);
    assert.equal(row.provider, 'claude');
    assert.equal(row.total_tokens, 123);
    exchange.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('vibedeck-sessions-live snapshot reaps stale open rows before streaming', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sse-reap-'));
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
      'codex', 'stale-open', '2026-05-09T00:00:00.000Z', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      NULL, 3, 0.0,
      '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z'
    );`,
  );
  db.close();

  const srv = await startLocalApiServer({ queuePath });
  try {
    const { req, res } = await connectSseClient(`${srv.baseUrl}/functions/vibedeck-sessions-live`);
    assert.equal(res.statusCode, 200);
    res.setEncoding('utf8');

    let buf = '';
    const snapshot = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout waiting for snapshot')), 3000);
      res.on('data', (chunk) => {
        buf += chunk;
        const parsed = parseSseEvents(buf);
        buf = parsed.rest;
        const snap = parsed.events.find((event) => event.type === 'snapshot');
        if (snap) {
          clearTimeout(timeout);
          resolve(snap);
        }
      });
      res.on('error', reject);
    });

    assert.equal(snapshot.sessions.some((row) => row.session_id === 'stale-open'), false);

    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    const row = verifyDb
      .prepare('SELECT ended_at, end_reason FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
      .get('codex', 'stale-open');
    verifyDb.close();

    assert.ok(row?.ended_at);
    assert.equal(row?.end_reason, 'orphan_reaped');
    req.destroy();
    res.destroy();
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
