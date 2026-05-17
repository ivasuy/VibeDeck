const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');
const { rebuildAllBranchUsageFacts } = require('../src/lib/sessions/branch-usage-facts');

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: 'GET',
    url: url.pathname + url.search,
    headers: { host: 'localhost' },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(''));
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, cost_estimated, cost_quality,
      created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @cost_estimated, @cost_quality,
      @started_at, @updated_at
    )
  `).run(row);
}

test('project usage returns a project umbrella with nested worktrees', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vd-project-worktrees-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const projectRoot = path.join(root, 'Projects', 'mono');
    const worktreeA = projectRoot;
    const worktreeB = path.join(root, 'Projects', 'mono-feature');
    const repoCommonDir = path.join(projectRoot, '.git');
    await fs.promises.mkdir(trackerDir, { recursive: true });
    await fs.promises.mkdir(worktreeA, { recursive: true });
    await fs.promises.mkdir(worktreeB, { recursive: true });
    await fs.promises.mkdir(repoCommonDir, { recursive: true });

    const queuePath = path.join(trackerDir, 'queue.jsonl');
    const projectQueuePath = path.join(trackerDir, 'project.queue.jsonl');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    await fs.promises.writeFile(queuePath, '', 'utf8');
    await fs.promises.writeFile(projectQueuePath, '', 'utf8');

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'wt-a',
        started_at: '2026-05-11T08:00:00.000Z',
        ended_at: '2026-05-11T08:30:00.000Z',
        cwd: worktreeA,
        repo_root: worktreeA,
        repo_common_dir: repoCommonDir,
        parent_repo: null,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'gpt-5.4',
        total_tokens: 120,
        total_cost_usd: 0.12,
        last_observed_at: '2026-05-11T08:25:00.000Z',
        input_tokens: 100,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 0,
        cost_estimated: 0,
        cost_quality: 'stored',
        updated_at: '2026-05-11T08:30:00.000Z',
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 'wt-b',
        started_at: '2026-05-11T09:00:00.000Z',
        ended_at: '2026-05-11T09:15:00.000Z',
        cwd: worktreeB,
        repo_root: worktreeB,
        repo_common_dir: repoCommonDir,
        parent_repo: null,
        branch: 'feature/refactor',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'claude-sonnet-4-6',
        total_tokens: 80,
        total_cost_usd: 0.4,
        last_observed_at: '2026-05-11T09:10:00.000Z',
        input_tokens: 60,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 0,
        cost_estimated: 0,
        cost_quality: 'stored',
        updated_at: '2026-05-11T09:15:00.000Z',
      });
    } finally {
      db.close();
    }
    rebuildAllBranchUsageFacts(dbPath);

    const body = await callEndpoint(
      queuePath,
      '/functions/vibedeck-project-usage-summary?from=2026-05-11&to=2026-05-11',
    );
    assert.equal(body.entries.length, 1);
    assert.equal(body.entries[0].repo_root, projectRoot);
    assert.equal(body.entries[0].worktree_count, 2);
    assert.equal(body.entries[0].total_tokens, '200');
    assert.equal(body.entries[0].worktrees.length, 2);
    assert.deepEqual(
      body.entries[0].worktrees.map((entry) => entry.repo_root).sort(),
      [worktreeA, worktreeB].sort(),
    );
    assert.deepEqual(
      body.entries[0].worktrees.map((entry) => entry.total_tokens),
      ['120', '80'],
    );
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
