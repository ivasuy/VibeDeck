'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');

async function call(handler, route) {
  const chunks = [];
  const headers = {};
  let statusCode = 200;
  const url = new URL(`http://127.0.0.1${route}`);
  const req = { method: 'GET', url: url.pathname + url.search, headers: { host: '127.0.0.1' } };
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

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-api-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  fs.writeFileSync(queuePath, '', 'utf8');
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  const now = '2026-05-23T10:00:00.000Z';
  db.prepare(`INSERT INTO vibedeck_branch_usage_facts (
    provider, session_id, scope_key, project_state, project_key, project_ref, cwd, repo_root,
    branch, branch_kind, confidence, model, first_observed_at, last_observed_at,
    event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
    cache_creation_5m_input_tokens, cache_creation_1h_input_tokens, output_tokens,
    reasoning_output_tokens, conversation_count, total_cost_usd, cost_estimated, cost_quality,
    token_reconciled, cost_reconciled, created_at, updated_at, web_search_requests,
    tool_call_count, tools_json, activity_json, task_category, skills_json, fast_mode
  ) VALUES (
    @provider, @session_id, @scope_key, @project_state, @project_key, @project_ref, @cwd, @repo_root,
    @branch, @branch_kind, @confidence, @model, @first_observed_at, @last_observed_at,
    @event_count, @total_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
    @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens, @output_tokens,
    @reasoning_output_tokens, @conversation_count, @total_cost_usd, @cost_estimated, @cost_quality,
    @token_reconciled, @cost_reconciled, @created_at, @updated_at, @web_search_requests,
    @tool_call_count, @tools_json, @activity_json, @task_category, @skills_json, @fast_mode
  )`).run({
    provider: 'claude',
    session_id: 's1',
    scope_key: 'repo:/tmp/repo',
    project_state: 'git_existing',
    project_key: '/tmp/repo',
    project_ref: '/tmp/repo',
    cwd: '/tmp/repo',
    repo_root: '/tmp/repo',
    branch: 'main',
    branch_kind: 'known',
    confidence: 'high',
    model: 'claude-sonnet-4',
    first_observed_at: now,
    last_observed_at: now,
    event_count: 2,
    total_tokens: 1000,
    input_tokens: 700,
    cached_input_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 20,
    cache_creation_1h_input_tokens: 30,
    output_tokens: 250,
    reasoning_output_tokens: 0,
    conversation_count: 1,
    total_cost_usd: 0.25,
    cost_estimated: 0,
    cost_quality: 'stored',
    token_reconciled: 0,
    cost_reconciled: 0,
    created_at: now,
    updated_at: now,
    web_search_requests: 0,
    tool_call_count: 3,
    tools_json: JSON.stringify({ Read: 1, Edit: 1, 'mcp__repo__search': 1 }),
    activity_json: JSON.stringify({ editing: 1, reading: 1 }),
    task_category: JSON.stringify({ Coding: 1 }),
    skills_json: JSON.stringify({ planner: 1 }),
    fast_mode: 1,
  });
  db.prepare(`INSERT INTO vibedeck_session_events (
    event_key, provider, session_id, kind, observed_at, model, input_tokens, output_tokens,
    delta_tokens, tools_json, activity_json, task_category, tools_sequence_json, skills_json,
    fast_mode, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'ev1',
      'claude',
      's1',
      'update',
      now,
      'claude-sonnet-4',
      700,
      250,
      1000,
      JSON.stringify({ Read: 1, Edit: 1 }),
      JSON.stringify({ editing: 1 }),
      JSON.stringify({ Coding: 1 }),
      JSON.stringify(['Read', 'Edit']),
      JSON.stringify({ planner: 1 }),
      1,
      now,
    );
  db.close();
  return { dir, queuePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('Codeburn parity endpoints expose read-side metrics without changing totals', async () => {
  const f = makeFixture();
  try {
    const handler = createLocalApiHandler({ queuePath: f.queuePath });
    const compare = JSON.parse((await call(handler, '/functions/vibedeck-compare?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(compare.ok, true);
    assert.equal(compare.totals.total_tokens, 1000);
    assert.equal(compare.metrics.cost_per_call_usd, '0.0833');
    assert.equal(compare.metrics.cost_per_edit_usd, '0.2500');
    assert.equal(compare.metrics.cache_hit_percent, '11.76');

    const models = JSON.parse((await call(handler, '/functions/vibedeck-models?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(models.models[0].model, 'claude-sonnet-4');
    assert.equal(models.models[0].task_categories.Coding, 1);

    const status = JSON.parse((await call(handler, '/functions/vibedeck-status')).body);
    assert.equal(status.ok, true);
    assert.ok(status.one_liner.includes('sessions'));
    assert.equal(status.totals.total_tokens, 1000);

    const jsonExport = JSON.parse((await call(handler, '/functions/vibedeck-export?format=json&from=2026-05-23&to=2026-05-23')).body);
    assert.equal(jsonExport.totals.total_tokens, 1000);
    assert.equal(jsonExport.rows.length, 1);

    const csvResponse = await call(handler, '/functions/vibedeck-export?format=csv&from=2026-05-23&to=2026-05-23');
    assert.equal(csvResponse.headers['content-type'], 'text/csv; charset=utf-8');
    assert.equal(csvResponse.headers['content-disposition'], 'attachment; filename="vibedeck-export.csv"');
    assert.match(csvResponse.body, /provider,session_id,branch,model,total_tokens,cost_usd/);
    assert.match(csvResponse.body, /claude,s1,main,claude-sonnet-4,1000,0.2500/);

    const yieldBody = JSON.parse((await call(handler, '/functions/vibedeck-yield?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(yieldBody.branches[0].branch, 'main');
    assert.ok(['productive', 'abandoned', 'reverted', 'unknown'].includes(yieldBody.branches[0].yield_state));

    const detect = JSON.parse((await call(handler, '/functions/vibedeck-optimize/auto-detect')).body);
    assert.equal(detect.ok, true);
    assert.ok(Array.isArray(detect.providers));
  } finally {
    f.cleanup();
  }
});

test('compare rates are calculated at session grain across multiple branch fact rows', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-api-session-grain-'));
  try {
    const queuePath = path.join(dir, 'queue.jsonl');
    fs.writeFileSync(queuePath, '', 'utf8');
    const dbPath = path.join(dir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    const now = '2026-05-23T10:00:00.000Z';
    const insert = db.prepare(`INSERT INTO vibedeck_branch_usage_facts (
      provider, session_id, scope_key, project_state, project_key, project_ref, cwd, repo_root,
      branch, branch_kind, confidence, model, first_observed_at, last_observed_at,
      event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens, output_tokens,
      reasoning_output_tokens, conversation_count, total_cost_usd, cost_estimated, cost_quality,
      token_reconciled, cost_reconciled, created_at, updated_at, web_search_requests,
      tool_call_count, tools_json, activity_json, task_category, skills_json, fast_mode
    ) VALUES (
      @provider, @session_id, @scope_key, @project_state, @project_key, @project_ref, @cwd, @repo_root,
      @branch, @branch_kind, @confidence, @model, @first_observed_at, @last_observed_at,
      @event_count, @total_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens, @output_tokens,
      @reasoning_output_tokens, @conversation_count, @total_cost_usd, @cost_estimated, @cost_quality,
      @token_reconciled, @cost_reconciled, @created_at, @updated_at, @web_search_requests,
      @tool_call_count, @tools_json, @activity_json, @task_category, @skills_json, @fast_mode
    )`);
    const base = {
      provider: 'claude',
      session_id: 's-rate',
      project_state: 'git_existing',
      project_key: '/tmp/repo',
      project_ref: '/tmp/repo',
      cwd: '/tmp/repo',
      repo_root: '/tmp/repo',
      branch_kind: 'known',
      confidence: 'high',
      model: 'claude-sonnet-4',
      first_observed_at: now,
      last_observed_at: now,
      event_count: 1,
      total_tokens: 100,
      input_tokens: 50,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m_input_tokens: 0,
      cache_creation_1h_input_tokens: 0,
      output_tokens: 50,
      reasoning_output_tokens: 0,
      conversation_count: 1,
      total_cost_usd: 0.01,
      cost_estimated: 0,
      cost_quality: 'stored',
      token_reconciled: 0,
      cost_reconciled: 0,
      created_at: now,
      updated_at: now,
      web_search_requests: 0,
      tool_call_count: 2,
      tools_json: JSON.stringify({ Bash: 1, Edit: 1 }),
      activity_json: JSON.stringify({ editing: 2 }),
      task_category: JSON.stringify({ Coding: 1 }),
      skills_json: JSON.stringify({ planner: 1 }),
      fast_mode: 0,
    };
    insert.run({ ...base, scope_key: 'repo:/tmp/repo#a', branch: 'main' });
    insert.run({ ...base, scope_key: 'repo:/tmp/repo#b', branch: 'feature/session-split' });
    db.close();

    const handler = createLocalApiHandler({ queuePath });
    const compare = JSON.parse((await call(handler, '/functions/vibedeck-compare?from=2026-05-23&to=2026-05-23')).body);
    assert.equal(compare.totals.session_count, 1);
    assert.equal(compare.metrics.one_shot_rate, '100.00');
    assert.equal(compare.metrics.retry_rate, '100.00');
    assert.equal(compare.metrics.self_correction_rate, '100.00');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty Codeburn parity endpoints render stable zero data', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-api-empty-'));
  try {
    const queuePath = path.join(dir, 'queue.jsonl');
    fs.writeFileSync(queuePath, '', 'utf8');
    ensureSchema(path.join(dir, 'vibedeck.sqlite3'));
    const handler = createLocalApiHandler({ queuePath });
    for (const route of ['/functions/vibedeck-compare', '/functions/vibedeck-models', '/functions/vibedeck-yield', '/functions/vibedeck-status', '/functions/vibedeck-export?format=json']) {
      const response = await call(handler, route);
      const body = JSON.parse(response.body);
      assert.equal(body.ok, true, `${route} should return ok`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
