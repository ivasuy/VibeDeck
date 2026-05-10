'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');

function createRequest({ method = 'GET', headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;

  process.nextTick(() => {
    if (body != null) req.emit('data', Buffer.from(body));
    req.emit('end');
  });

  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @started_at, @started_at
    )
  `).run(row);
}

test('GET /functions/vibedeck-branch-usage aggregates sessions by repo and branch', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-usage-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:20:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.2',
        total_tokens: 100,
        total_cost_usd: 0.25,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 's2',
        started_at: '2026-05-10T01:00:00.000Z',
        ended_at: null,
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'feature/live',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'opus',
        total_tokens: 40,
        total_cost_usd: 0.1,
      });
    } finally {
      db.close();
    }

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1'),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.totals.total_tokens, 140);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].repo_root, '/repo');
    assert.equal(body.repos[0].branches.length, 2);
    assert.equal(body.repos[0].branches[0].sessions.length, 1);
    assert.deepEqual(
      Object.keys(body.repos[0].branches[0].confidence).sort(),
      ['high', 'low', 'medium', 'unattributed'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage returns empty shape when db is absent', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-empty-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(req, res, new URL('http://127.0.0.1/functions/vibedeck-branch-usage'));

    assert.deepEqual(JSON.parse(res.body.toString('utf8')), {
      repos: [],
      totals: { total_tokens: 0, total_cost_usd: 0, session_count: 0 },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage prefers branch windows when a session was split', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-windows-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'split',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T01:00:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.2',
        total_tokens: 100,
        total_cost_usd: 1.0,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows
          (provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd)
        VALUES
          ('codex', 'split', 'main', '2026-05-10T00:00:00.000Z', '2026-05-10T00:30:00.000Z', 60, 0.6),
          ('codex', 'split', 'feature', '2026-05-10T00:30:00.000Z', '2026-05-10T01:00:00.000Z', 40, 0.4)
      `).run();
    } finally {
      db.close();
    }

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1'),
    );

    const body = JSON.parse(res.body.toString('utf8'));
    const branches = body.repos[0].branches;
    assert.equal(branches.find((b) => b.branch === 'main').total_tokens, 60);
    assert.equal(branches.find((b) => b.branch === 'feature').total_tokens, 40);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

