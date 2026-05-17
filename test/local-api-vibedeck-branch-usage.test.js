'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { lookupModelPricing } = require('../src/lib/pricing');
const { rebuildAllBranchUsageFacts } = require('../src/lib/sessions/branch-usage-facts');
const { recordTransition } = require('../src/lib/sessions/head-history');

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

function insertEvent(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at,
      started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence,
      model, delta_tokens, input_tokens, cached_input_tokens,
      cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
      conversation_count, total_tokens, created_at
    ) VALUES (
      @provider, @session_id, @event_key, 'update', @observed_at,
      NULL, NULL, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence,
      @model, @delta_tokens, @input_tokens, 0,
      0, @output_tokens, 0,
      1, @total_tokens, @observed_at
    )
  `).run({
    branch: null,
    branch_resolution_tier: null,
    confidence: null,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: null,
    delta_tokens: null,
    ...row,
  });
}

function initGitRepo(repoRoot, branches = ['main']) {
  fssync.mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init', '-b', branches[0]], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repoRoot, stdio: 'ignore' });
  fssync.writeFileSync(path.join(repoRoot, 'README.md'), 'test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });
  for (const branch of branches.slice(1)) {
    execFileSync('git', ['branch', branch], { cwd: repoRoot, stdio: 'ignore' });
  }
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
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['feature/live', 'main', 'release']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    recordTransition(dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T00:00:00.000Z',
    });
    recordTransition(dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'feature/live',
      transitioned_at: '2026-05-10T01:30:00.000Z',
    });

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:20:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
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
        cwd: repoRoot,
        repo_root: repoRoot,
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
        cwd: repoRoot,
        repo_root: repoRoot,
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
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1&include_git_branches=1'),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    const expectedRepoRoot = fssync.realpathSync(repoRoot);
    assert.equal(body.totals.total_tokens, 125040);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].repo_root, expectedRepoRoot);
    assert.equal(body.repos[0].project_state, 'git_existing');
    assert.equal(body.repos[0].project_ref, expectedRepoRoot);
    assert.equal(body.repos[0].project_key, path.basename(repoRoot));
    assert.equal(body.repos[0].git_branch_count, 3);
    assert.deepEqual(body.repos[0].git_branches, ['feature/live', 'main', 'release']);
    assert.equal(body.repos[0].branches.length, 2);
    const mainBranch = body.repos[0].branches.find((entry) => entry.branch === 'main');
    const featureBranch = body.repos[0].branches.find((entry) => entry.branch === 'feature/live');
    assert.ok(mainBranch);
    assert.ok(featureBranch);
    assert.equal(mainBranch.branch_kind, 'known');
    assert.equal(featureBranch.branch_kind, 'known');
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

test('branch usage summary does not shell out to git branches by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-no-git-hot-path-'));
  const cp = require('node:child_process');
  const originalExecFileSync = cp.execFileSync;
  try {
    const repoRoot = path.join(root, 'repo');
    initGitRepo(repoRoot, ['main', 'feature-unused']);
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'tracked-main',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-4o',
        total_tokens: 100,
        total_cost_usd: 0.1,
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    let gitBranchCalls = 0;
    cp.execFileSync = (cmd, args, ...rest) => {
      if (cmd === 'git' && Array.isArray(args) && args.includes('branch')) gitBranchCalls += 1;
      return originalExecFileSync(cmd, args, ...rest);
    };
    delete require.cache[require.resolve('../src/lib/branch-usage')];
    const { queryBranchUsage } = require('../src/lib/branch-usage');

    const payload = queryBranchUsage(dbPath, { includeSessions: false, includeArchived: true });
    assert.equal(gitBranchCalls, 0);
    assert.deepEqual(payload.repos[0].git_branches, []);
    assert.equal(payload.repos[0].git_branch_count, 0);
    assert.deepEqual(payload.repos[0].branches.map((row) => row.branch), ['main']);
  } finally {
    cp.execFileSync = originalExecFileSync;
    delete require.cache[require.resolve('../src/lib/branch-usage')];
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage folds deleted worktree cwd rows under their parent project', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-fold-worktree-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'project-starter');
    const deletedWorktree = path.join(repoRoot, '.worktrees', 'codex-org-12345678', 'P1-T1-parser-module');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['main']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'deleted-worktree-session',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:10:00.000Z',
        cwd: deletedWorktree,
        repo_root: null,
        branch: null,
        branch_resolution_tier: 'D',
        confidence: 'low',
        model: 'gpt-5.5',
        total_tokens: 777,
        total_cost_usd: 0.77,
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_archived=1&include_sessions=1'),
    );

    const body = JSON.parse(res.body.toString('utf8'));
    const expectedRepoRoot = fssync.realpathSync(repoRoot);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].project_ref, expectedRepoRoot);
    assert.equal(body.repos[0].repo_root, expectedRepoRoot);
    assert.equal(body.repos[0].project_key, 'project-starter');
    assert.equal(body.repos[0].project_state, 'git_existing');
    assert.equal(body.repos[0].archived, false);
    assert.equal(body.repos[0].branches.length, 1);
    assert.equal(body.repos[0].branches[0].branch, 'P1-T1-parser-module');
    assert.equal(body.repos[0].branches[0].branch_kind, 'historical_worktree');
    assert.equal(body.repos[0].branches[0].historical_worktree, true);
    assert.equal(body.repos[0].branches[0].sessions[0].session_id, 'deleted-worktree-session');

    const filteredReq = createRequest({ method: 'GET' });
    const filteredRes = createResponse();
    const filteredUrl = new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_archived=1&include_sessions=1');
    filteredUrl.searchParams.set('repo', expectedRepoRoot);
    filteredUrl.searchParams.set('branch', 'P1-T1-parser-module');
    await handler(filteredReq, filteredRes, filteredUrl);
    const filteredBody = JSON.parse(filteredRes.body.toString('utf8'));
    assert.equal(filteredBody.repos.length, 1);
    assert.equal(filteredBody.repos[0].repo_root, expectedRepoRoot);
    assert.equal(filteredBody.repos[0].branches[0].branch, 'P1-T1-parser-module');
    assert.equal(filteredBody.repos[0].branches[0].sessions[0].session_id, 'deleted-worktree-session');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage returns date buckets and filters sessions by selected date', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-date-buckets-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['main']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'new-day',
        started_at: '2026-05-11T01:00:00.000Z',
        ended_at: '2026-05-11T01:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.5',
        total_tokens: 100,
        total_cost_usd: 1,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 'old-day',
        started_at: '2026-05-10T01:00:00.000Z',
        ended_at: '2026-05-10T01:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'claude-opus-4-7',
        total_tokens: 200,
        total_cost_usd: 2,
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1&include_date_buckets=1&session_date=latest'),
    );

    const body = JSON.parse(res.body.toString('utf8'));
    const branch = body.repos[0].branches[0];
    assert.equal(branch.selected_date, '2026-05-11');
    assert.deepEqual(branch.sessions.map((session) => session.session_id), ['new-day']);
    assert.deepEqual(branch.date_buckets.map((bucket) => bucket.date), ['2026-05-11', '2026-05-10']);
    assert.equal(branch.date_buckets[0].session_count, 1);
    assert.equal(branch.date_buckets[0].models[0].model, 'gpt-5.5');
    assert.equal(branch.date_buckets[1].models[0].model, 'claude-opus-4-7');

    const oldReq = createRequest({ method: 'GET' });
    const oldRes = createResponse();
    await handler(
      oldReq,
      oldRes,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1&include_date_buckets=1&session_date=2026-05-10'),
    );
    const oldBody = JSON.parse(oldRes.body.toString('utf8'));
    const oldBranch = oldBody.repos[0].branches[0];
    assert.equal(oldBranch.selected_date, '2026-05-10');
    assert.deepEqual(oldBranch.sessions.map((session) => session.session_id), ['old-day']);
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

test('GET /functions/vibedeck-branch-usage does not undercount when more than 100 sessions match', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-limit-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['main']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      for (let i = 0; i < 150; i += 1) {
        insertSession(db, {
          provider: 'codex',
          session_id: `s-${i}`,
          started_at: `2026-05-10T${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}:00.000Z`,
          ended_at: `2026-05-10T${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10 + 5).padStart(2, '0')}:00.000Z`,
          cwd: repoRoot,
          repo_root: repoRoot,
          branch: 'main',
          branch_resolution_tier: 'A',
          confidence: 'high',
          model: 'gpt-4o-mini',
          total_tokens: 1,
          total_cost_usd: 0.001,
        });
      }
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(req, res, new URL('http://127.0.0.1/functions/vibedeck-branch-usage'));

    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.totals.total_tokens, 150);
    assert.equal(body.repos[0].branches[0].total_tokens, 150);
    assert.equal(body.repos[0].branches[0].session_count, 150);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage reads branch facts rather than branch windows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-windows-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['main', 'feature']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    recordTransition(dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T00:00:00.000Z',
    });
    recordTransition(dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'feature',
      transitioned_at: '2026-05-10T00:30:00.000Z',
    });

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'split',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T01:00:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.2',
        total_tokens: 100,
        total_cost_usd: 1.0,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'split',
        event_key: 'main-usage',
        observed_at: '2026-05-10T00:05:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.2',
        delta_tokens: 90,
        input_tokens: 80,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'split',
        event_key: 'feature-usage',
        observed_at: '2026-05-10T00:40:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.2',
        delta_tokens: 10,
        input_tokens: 8,
        output_tokens: 2,
      });
      db.prepare(`
        INSERT INTO vibedeck_session_branch_windows
          (provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd)
        VALUES
          ('codex', 'split', 'main', '2026-05-10T00:00:00.000Z', '2026-05-10T00:30:00.000Z', 50, 0.5),
          ('codex', 'split', 'feature', '2026-05-10T00:30:00.000Z', '2026-05-10T01:00:00.000Z', 50, 0.5)
      `).run();
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

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
    assert.equal(branches.find((b) => b.branch === 'main').total_tokens, 90);
    assert.equal(branches.find((b) => b.branch === 'feature').total_tokens, 10);
    assert.equal(body.totals.total_tokens, 100);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage includes non-git folders and hides archived rows by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-stale-repo-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const liveRepo = path.join(root, 'live-repo');
    const nonGitFolder = path.join(root, 'notes-app');
    const deletedRepo = path.join(root, 'deleted-repo');
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(liveRepo, { recursive: true });
    await fs.mkdir(nonGitFolder, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'live',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:20:00.000Z',
        cwd: liveRepo,
        repo_root: liveRepo,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.4',
        total_tokens: 100,
        total_cost_usd: null,
      });
      insertSession(db, {
        provider: 'codex',
        session_id: 'deleted',
        started_at: '2026-05-10T01:00:00.000Z',
        ended_at: '2026-05-10T01:20:00.000Z',
        cwd: deletedRepo,
        repo_root: deletedRepo,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.4',
        total_tokens: 900,
        total_cost_usd: null,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 'non-git',
        started_at: '2026-05-10T02:00:00.000Z',
        ended_at: '2026-05-10T02:20:00.000Z',
        cwd: nonGitFolder,
        repo_root: null,
        branch: null,
        branch_resolution_tier: 'D',
        confidence: 'low',
        model: 'claude-sonnet-4',
        total_tokens: 25,
        total_cost_usd: 0.25,
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: 'GET' });
    const res = createResponse();
    await handler(req, res, new URL('http://127.0.0.1/functions/vibedeck-branch-usage'));

    const body = JSON.parse(res.body.toString('utf8'));
    const expectedLiveRepo = fssync.realpathSync(liveRepo);
    const expectedNonGitFolder = fssync.realpathSync(nonGitFolder);
    assert.deepEqual(body.repos.map((repo) => repo.project_ref).sort(), [expectedLiveRepo, expectedNonGitFolder].sort());
    assert.equal(body.totals.total_tokens, 125);

    const nonGit = body.repos.find((repo) => repo.project_ref === expectedNonGitFolder);
    assert.ok(nonGit);
    assert.equal(nonGit.repo_root, null);
    assert.equal(nonGit.project_state, 'non_git_existing');
    assert.deepEqual(nonGit.git_branches, []);
    assert.equal(nonGit.git_branch_count, 0);
    assert.equal(nonGit.branches[0].branch, 'No branch');
    assert.equal(nonGit.branches[0].branch_kind, 'no_git');

    const archivedReq = createRequest({ method: 'GET' });
    const archivedRes = createResponse();
    await handler(
      archivedReq,
      archivedRes,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_archived=1'),
    );
    const archivedBody = JSON.parse(archivedRes.body.toString('utf8'));
    const archivedRepo = archivedBody.repos.find((repo) => repo.project_ref === deletedRepo);
    assert.ok(archivedRepo);
    assert.equal(archivedRepo.archived, true);
    assert.equal(archivedRepo.project_state, 'git_missing');
    assert.deepEqual(archivedRepo.git_branches, []);
    assert.equal(archivedRepo.git_branch_count, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage uses branch fact cost when stored cost is null', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-window-null-cost-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
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
        cwd: repoRoot,
        repo_root: repoRoot,
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
    rebuildAllBranchUsageFacts(dbPath);

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
    const expectedCostUsd = (100000 * approximateRate) / 1_000_000;

    assertClose(branch.total_cost_usd, expectedCostUsd);
    assertClose(branch.models[0].total_cost_usd, expectedCostUsd);
    assertClose(branch.sessions[0].total_cost_usd, expectedCostUsd);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage ignores stale zero branch window cost', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-window-stale-zero-cost-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
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
        cwd: repoRoot,
        repo_root: repoRoot,
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
    rebuildAllBranchUsageFacts(dbPath);

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
    const expectedCostUsd = (100000 * approximateRate) / 1_000_000;

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

test('GET /functions/vibedeck-branch-usage uses last_observed_at for open-session branch rows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-open-observed-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    await fs.mkdir(trackerDir, { recursive: true });
    initGitRepo(repoRoot, ['feature/live', 'main']);
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');

    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    recordTransition(dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'feature/live',
      transitioned_at: '2026-05-12T01:00:00.000Z',
    });

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES (
          @provider, @session_id, @started_at, @ended_at, NULL,
          @cwd, @repo_root, NULL, @parent_repo,
          @branch, @branch_resolution_tier, @confidence, NULL,
          @model, @total_tokens, @total_cost_usd, @last_observed_at,
          @cost_estimated, @cost_quality, @created_at, @updated_at
        )
      `).run({
        provider: 'claude',
        session_id: 'open-branch',
        started_at: '2026-05-12T01:00:00.000Z',
        ended_at: null,
        cwd: repoRoot,
        repo_root: repoRoot,
        parent_repo: repoRoot,
        branch: 'feature/live',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'claude-sonnet-4',
        total_tokens: 2000,
        total_cost_usd: 2.5,
        last_observed_at: '2026-05-12T01:15:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
        created_at: '2026-05-12T01:00:00.000Z',
        updated_at: '2026-05-12T01:16:00.000Z',
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

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

    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body.toString('utf8'));
    const repo = payload.repos.find((row) => row.repo_root === fssync.realpathSync(repoRoot));
    assert.ok(repo);
    const branch = repo.branches.find((row) => row.branch === 'feature/live');
    assert.ok(branch);
    assert.equal(branch.total_tokens, 2000);
    assert.equal(branch.total_cost_usd, 2.5);
    assert.equal(branch.last_seen_at, '2026-05-12T01:15:00.000Z');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('GET /functions/vibedeck-branch-usage passes include_unattributed to branch facts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-unattributed-'));
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
        provider: 'cursor',
        session_id: 'unattributed',
        started_at: '2026-05-10T00:00:00.000Z',
        ended_at: '2026-05-10T00:05:00.000Z',
        cwd: null,
        repo_root: null,
        branch: null,
        branch_resolution_tier: 'D',
        confidence: 'unattributed',
        model: 'gpt-4o',
        total_tokens: 12,
        total_cost_usd: null,
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });

    const defaultReq = createRequest({ method: 'GET' });
    const defaultRes = createResponse();
    await handler(defaultReq, defaultRes, new URL('http://127.0.0.1/functions/vibedeck-branch-usage'));
    assert.deepEqual(JSON.parse(defaultRes.body.toString('utf8')).repos, []);

    const includedReq = createRequest({ method: 'GET' });
    const includedRes = createResponse();
    await handler(
      includedReq,
      includedRes,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_unattributed=1'),
    );

    const body = JSON.parse(includedRes.body.toString('utf8'));
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].project_state, 'unattributed');
    assert.equal(body.repos[0].project_key, 'Unattributed');
    assert.equal(body.repos[0].branches[0].branch, 'Unattributed');
    assert.equal(body.repos[0].branches[0].branch_kind, 'unattributed');
    assert.equal(body.totals.total_tokens, 12);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
