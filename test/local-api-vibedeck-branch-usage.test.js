'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { lookupModelPricing } = require('../src/lib/pricing');

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

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickApproximateTokenRate(pricing) {
  if (!pricing || typeof pricing !== 'object') return null;
  const candidates = [pricing.input, pricing.output, pricing.cache_read, pricing.cache_write]
    .map((value) => toFiniteNumber(value))
    .filter((value) => value != null && value > 0);
  if (candidates.length === 0) {
    const zeroCandidate = [pricing.input, pricing.output, pricing.cache_read, pricing.cache_write]
      .map((value) => toFiniteNumber(value))
      .find((value) => value === 0);
    return zeroCandidate === 0 ? 0 : null;
  }
  return pricing.input > 0 ? pricing.input : candidates[0];
}

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
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
        model: 'claude-sonnet-4-6',
        total_tokens: 100000,
        total_cost_usd: null,
      });
      insertSession(db, {
        provider: 'codex',
        session_id: 's2',
        started_at: '2026-05-10T01:00:00.000Z',
        ended_at: '2026-05-10T01:15:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-4o-mini',
        total_tokens: 25000,
        total_cost_usd: null,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 's3',
        started_at: '2026-05-10T02:00:00.000Z',
        ended_at: null,
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'feature/live',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'unknown-model',
        total_tokens: 40,
        total_cost_usd: null,
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
    assert.equal(body.totals.total_tokens, 125040);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].repo_root, '/repo');
    assert.equal(body.repos[0].branches.length, 2);
    const mainBranch = body.repos[0].branches.find((entry) => entry.branch === 'main');
    const featureBranch = body.repos[0].branches.find((entry) => entry.branch === 'feature/live');
    assert.ok(mainBranch);
    assert.ok(featureBranch);
    assert.equal(mainBranch.sessions.length, 2);
    assert.ok(mainBranch.total_cost_usd > 0);
    assert.deepEqual(
      mainBranch.models.map((model) => model.model),
      ['claude-sonnet-4-6', 'gpt-4o-mini'],
    );
    assert.equal(mainBranch.models[0].total_tokens, 100000);
    assert.ok(mainBranch.models[0].total_cost_usd > 0);
    assert.equal(mainBranch.models[0].session_count, 1);
    assert.equal(featureBranch.total_cost_usd, null);
    assert.deepEqual(featureBranch.models, [
      {
        model: 'unknown-model',
        total_tokens: 40,
        total_cost_usd: null,
        cost_estimated: true,
        cost_quality: 'partial_unknown',
        session_count: 1,
      },
    ]);
    assert.deepEqual(
      Object.keys(mainBranch.confidence).sort(),
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
      totals: {
        total_tokens: 0,
        total_cost_usd: 0,
        cost_estimated: false,
        cost_quality: 'zero_tokens',
        session_count: 0,
      },
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

test('GET /functions/vibedeck-branch-usage estimates branch window cost when stored cost is null', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-window-null-cost-'));
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
        session_id: 'split-null-cost',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T01:00:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100000,
        total_cost_usd: null,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows
          (provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd)
        VALUES
          ('codex', 'split-null-cost', 'main', '2026-05-10T00:00:00.000Z', '2026-05-10T00:30:00.000Z', 60000, NULL),
          ('codex', 'split-null-cost', 'feature', '2026-05-10T00:30:00.000Z', '2026-05-10T01:00:00.000Z', 40000, NULL)
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
    const branch = body.repos[0].branches.find((entry) => entry.branch === 'main');
    const pricingMatch = lookupModelPricing('gpt-5.4');
    assert.equal(pricingMatch.hit, true);
    const approximateRate = pickApproximateTokenRate(pricingMatch.value);
    const expectedCostUsd = (60000 * approximateRate) / 1_000_000;

    assertClose(branch.total_cost_usd, expectedCostUsd);
    assertClose(branch.models[0].total_cost_usd, expectedCostUsd);
    assertClose(branch.sessions[0].total_cost_usd, expectedCostUsd);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage estimates stale zero branch window cost when source session cost is null', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-window-stale-zero-cost-'));
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
        session_id: 'split-stale-zero-cost',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T01:00:00.000Z',
        cwd: '/repo',
        repo_root: '/repo',
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100000,
        total_cost_usd: null,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows
          (provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd)
        VALUES
          ('codex', 'split-stale-zero-cost', 'main', '2026-05-10T00:00:00.000Z', '2026-05-10T00:30:00.000Z', 60000, 0),
          ('codex', 'split-stale-zero-cost', 'feature', '2026-05-10T00:30:00.000Z', '2026-05-10T01:00:00.000Z', 40000, 0)
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
    const branch = body.repos[0].branches.find((entry) => entry.branch === 'main');
    const pricingMatch = lookupModelPricing('gpt-5.4');
    assert.equal(pricingMatch.hit, true);
    const approximateRate = pickApproximateTokenRate(pricingMatch.value);
    const expectedCostUsd = (60000 * approximateRate) / 1_000_000;

    assertClose(branch.total_cost_usd, expectedCostUsd);
    assert.equal(branch.cost_estimated, true);
    assert.equal(branch.cost_quality, 'estimated_total_tokens');
    assertClose(branch.models[0].total_cost_usd, expectedCostUsd);
    assert.equal(branch.models[0].cost_estimated, true);
    assert.equal(branch.models[0].cost_quality, 'estimated_total_tokens');
    assertClose(branch.sessions[0].total_cost_usd, expectedCostUsd);
    assert.equal(branch.sessions[0].cost_estimated, true);
    assert.equal(branch.sessions[0].cost_quality, 'estimated_total_tokens');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
