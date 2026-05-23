const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');

function makeTracker() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-live-groups-'));
  const trackerDir = path.join(dir, '.vibedeck', 'tracker');
  fs.mkdirSync(trackerDir, { recursive: true });
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const queuePath = path.join(trackerDir, 'usage.jsonl');
  fs.writeFileSync(queuePath, '');
  ensureSchema(dbPath);
  return { dir, trackerDir, dbPath, queuePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, cwd, repo_root, branch, model, started_at, ended_at,
      branch_resolution_tier, confidence,
      total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens,
      total_cost_usd, cost_estimated, cost_quality, last_observed_at, updated_at, created_at
    ) VALUES (
      @provider, @session_id, '/repo', '/repo', @branch, @model, @started_at, @ended_at,
      'PROVIDER_LOG', 'high',
      @total_tokens, 0, 0, 0,
      @total_tokens, 0,
      @total_cost_usd, 0, 'stored', @updated_at, @updated_at, @started_at
    )
  `).run({
    branch: 'release/0.1.3',
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: null,
    total_tokens: 100,
    total_cost_usd: 0.01,
    updated_at: '2026-05-23T10:10:00.000Z',
    ...row,
  });
}

function insertEdge(db) {
  db.prepare(`
    INSERT INTO vibedeck_session_group_edges (
      provider, session_group_id, root_session_id, child_session_id,
      relation_proof, depth, agent_label, agent_role, created_at, updated_at
    ) VALUES (
      'codex', 'codex:root', 'root', 'child',
      'codex_thread_spawn', 1, 'Curie', 'reviewer',
      '2026-05-23T10:00:00.000Z', '2026-05-23T10:00:00.000Z'
    )
  `).run();
}

async function callSnapshot(queuePath) {
  const handler = createLocalApiHandler({ queuePath, syncEnabled: false });
  const url = new URL('http://localhost/functions/vibedeck-sessions-live-snapshot');
  const req = { method: 'GET', url: url.pathname, headers: { host: 'localhost' } };
  const chunks = [];
  const res = {
    setHeader() {},
    writeHead() {},
    write(chunk) { chunks.push(String(chunk)); },
    end(body) { if (body) chunks.push(String(body)); },
  };
  const handled = await handler(req, res, url);
  assert.equal(handled, true);
  return JSON.parse(chunks.join(''));
}

test('live snapshot exposes additive session groups in preview mode', async () => {
  const tmp = makeTracker();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'preview';
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10, ended_at: '2026-05-23T10:05:00.000Z' });
    insertSession(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05, ended_at: null });
    insertEdge(db);
    db.close();

    const body = await callSnapshot(tmp.queuePath);
    assert.equal(body.sessions.length, 2);
    assert.equal(body.session_groups.length, 1);
    assert.equal(body.session_groups[0].member_count, 2);
    assert.equal(body.session_groups[0].active_member_count, 1);
    assert.equal(body.session_groups[0].total_tokens, 150);
    assert.equal(body.session_group_diagnostics.grouped_child_sessions, 1);
    assert.equal(body.sessions.find((row) => row.session_id === 'root').group_role, 'root');
    assert.equal(body.sessions.find((row) => row.session_id === 'child').group_role, 'child');
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});

test('live snapshot hides group cards in shadow mode while keeping raw sessions', async () => {
  const tmp = makeTracker();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'shadow';
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10 });
    insertSession(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05 });
    insertEdge(db);
    db.close();

    const body = await callSnapshot(tmp.queuePath);
    assert.equal(body.sessions.length, 2);
    assert.equal(body.session_groups, undefined);
    assert.equal(body.session_group_diagnostics.grouped_child_sessions, 1);
    assert.equal(body.sessions.some((row) => row.group_role), false);
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});

test('live snapshot propagates session groups into active workstreams in preview mode', async () => {
  const tmp = makeTracker();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'preview';
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10, ended_at: null });
    insertSession(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05, ended_at: null });
    insertEdge(db);
    db.close();

    const body = await callSnapshot(tmp.queuePath);
    assert.equal(body.workstreams.length, 1);
    assert.equal(body.workstreams[0].session_groups.length, 1);
    assert.equal(body.workstreams[0].session_groups[0].member_count, 2);
    assert.equal(body.workstreams[0].sessions.find((row) => row.session_id === 'root').group_role, 'root');
    assert.equal(body.workstreams[0].sessions.find((row) => row.session_id === 'child').group_role, 'child');
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});
