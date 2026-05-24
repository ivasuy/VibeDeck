'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${actual} to be within ${epsilon} of ${expected}`);
}

function createRequest({ method = 'GET', headers = {} } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;
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

function insertFact(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_branch_usage_facts (
      provider, session_id,
      scope_key, project_state, project_key, project_ref,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, attribution_branch, branch_kind,
      branch_resolution_tier, confidence, model,
      first_observed_at, last_observed_at,
      event_count, total_tokens,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      conversation_count,
      total_cost_usd, cost_estimated, cost_quality,
      token_reconciled, cost_reconciled,
      created_at, updated_at
    ) VALUES (
      @provider, @session_id,
      @scope_key, @project_state, @project_key, @project_ref,
      @cwd, @repo_root, NULL, NULL,
      @branch, @attribution_branch, @branch_kind,
      @branch_resolution_tier, @confidence, @model,
      @first_observed_at, @last_observed_at,
      @event_count, @total_tokens,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @conversation_count,
      @total_cost_usd, @cost_estimated, @cost_quality,
      @token_reconciled, @cost_reconciled,
      @created_at, @updated_at
    )
  `).run({
    provider: 'codex',
    project_state: 'git_existing',
    project_key: 'repo',
    project_ref: row.repo_root,
    cwd: row.repo_root,
    branch: 'main',
    attribution_branch: 'main',
    branch_kind: 'known',
    branch_resolution_tier: 'A',
    confidence: 'high',
    model: 'gpt-5.4',
    event_count: 1,
    total_tokens: 0,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
    tool_call_count: 0,
    tools_json: null,
    activity_json: null,
    conversation_count: 1,
    total_cost_usd: 0,
    cost_estimated: 0,
    cost_quality: 'stored',
    token_reconciled: 1,
    cost_reconciled: 1,
    created_at: row.first_observed_at,
    updated_at: row.last_observed_at,
    ...row,
  });
}

test('vibedeck-branch-usage exposes fact enrichment on sessions, models, and date buckets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-branch-api-enrichment-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    const missingRoot = path.join(root, '.worktrees', 'gone');
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      insertFact(db, {
        provider: 'codex',
        session_id: 'enriched-a',
        scope_key: `git:${repoRoot}`,
        repo_root: repoRoot,
        project_ref: repoRoot,
        first_observed_at: '2026-05-10T01:00:00.000Z',
        last_observed_at: '2026-05-10T01:10:00.000Z',
        total_tokens: 100,
        cache_creation_5m_input_tokens: 10,
        cache_creation_1h_input_tokens: 20,
        web_search_requests: 2,
        tool_call_count: 3,
        tools_json: '{"Read":1,"WebSearch":2}',
        activity_json: '{"edit":1}',
        total_cost_usd: 0.4,
      });
      insertFact(db, {
        provider: 'codex',
        session_id: 'enriched-b',
        scope_key: `git:${repoRoot}`,
        repo_root: repoRoot,
        project_ref: repoRoot,
        first_observed_at: '2026-05-11T01:00:00.000Z',
        last_observed_at: '2026-05-11T01:10:00.000Z',
        total_tokens: 50,
        cache_creation_5m_input_tokens: 5,
        cache_creation_1h_input_tokens: 5,
        web_search_requests: 1,
        tool_call_count: 4,
        tools_json: '{"WebSearch":1,"Write":2}',
        activity_json: '{"edit":2,"review":1}',
        total_cost_usd: 0.3,
      });
      insertFact(db, {
        provider: 'codex',
        session_id: 'historical-unknown',
        scope_key: `missing:${missingRoot}`,
        project_state: 'git_missing',
        project_key: 'gone',
        project_ref: missingRoot,
        cwd: missingRoot,
        repo_root: null,
        branch: 'Historical unknown',
        attribution_branch: 'Historical unknown',
        branch_kind: 'historical_unknown',
        first_observed_at: '2026-05-12T01:00:00.000Z',
        last_observed_at: '2026-05-12T01:10:00.000Z',
        total_tokens: 25,
        web_search_requests: 1,
        total_cost_usd: 0.1,
      });
    } finally {
      db.close();
    }

    delete require.cache[require.resolve('../src/lib/local-api')];
    const { createLocalApiHandler } = require('../src/lib/local-api');
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest();
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL('http://127.0.0.1/functions/vibedeck-branch-usage?include_sessions=1&include_date_buckets=1&include_archived=1'),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    assert.equal(body.totals.total_tokens, 175);
    assertClose(body.totals.total_cost_usd, 0.8);

    const repo = body.repos.find((entry) => entry.project_ref === repoRoot);
    assert.ok(repo);
    const main = repo.branches.find((entry) => entry.branch === 'main');
    assert.ok(main);
    assert.equal(main.total_tokens, 150);
    assertClose(main.total_cost_usd, 0.7);
    assert.equal(main.cache_creation_5m_input_tokens, 15);
    assert.equal(main.cache_creation_1h_input_tokens, 25);
    assert.equal(main.web_search_requests, 3);
    assert.equal(main.tool_call_count, 7);
    assert.equal(main.tools_json, '{"Read":1,"WebSearch":3,"Write":2}');
    assert.equal(main.activity_json, '{"edit":3,"review":1}');

    assert.deepEqual(main.models, [{
      model: 'gpt-5.4',
      total_tokens: 150,
      total_cost_usd: main.models[0].total_cost_usd,
      cost_estimated: false,
      cost_quality: 'stored',
      session_count: 2,
      cache_creation_5m_input_tokens: 15,
      cache_creation_1h_input_tokens: 25,
      web_search_requests: 3,
      tool_call_count: 7,
      tools_json: '{"Read":1,"WebSearch":3,"Write":2}',
      activity_json: '{"edit":3,"review":1}',
    }]);
    assertClose(main.models[0].total_cost_usd, 0.7);

    const firstDate = main.date_buckets.find((bucket) => bucket.date === '2026-05-10');
    assert.ok(firstDate);
    assert.equal(firstDate.total_cost_usd, 0.4);
    assert.equal(firstDate.cache_creation_5m_input_tokens, 10);
    assert.equal(firstDate.cache_creation_1h_input_tokens, 20);
    assert.equal(firstDate.web_search_requests, 2);
    assert.equal(firstDate.tool_call_count, 3);
    assert.equal(firstDate.tools_json, '{"Read":1,"WebSearch":2}');
    assert.equal(firstDate.activity_json, '{"edit":1}');
    assert.equal(firstDate.models[0].web_search_requests, 2);

    const session = main.sessions.find((entry) => entry.session_id === 'enriched-a');
    assert.ok(session);
    assert.equal(session.cache_creation_5m_input_tokens, 10);
    assert.equal(session.cache_creation_1h_input_tokens, 20);
    assert.equal(session.web_search_requests, 2);
    assert.equal(session.tool_call_count, 3);
    assert.equal(session.tools_json, '{"Read":1,"WebSearch":2}');
    assert.equal(session.activity_json, '{"edit":1}');

    const historicalRepo = body.repos.find((entry) =>
      entry.branches.some((branch) => branch.branch === 'Historical unknown'),
    );
    assert.ok(historicalRepo);
    const historicalBranch = historicalRepo.branches.find((branch) => branch.branch === 'Historical unknown');
    assert.equal(historicalBranch.web_search_requests, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
