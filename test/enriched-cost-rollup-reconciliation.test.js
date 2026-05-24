'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { resolveUsageCost } = require('../src/lib/cost-estimation');

function assertClose(actual, expected, epsilon = 1e-12) {
  assert.ok(
    Math.abs(Number(actual) - Number(expected)) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function createRequest() {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { host: '127.0.0.1' };
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

async function callLocalApi(queuePath, pathname) {
  delete require.cache[require.resolve('../src/lib/local-api')];
  const { createLocalApiHandler } = require('../src/lib/local-api');
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest();
  const res = createResponse();
  const handled = await handler(req, res, new URL(`http://127.0.0.1${pathname}`));
  assert.equal(handled, true, `expected ${pathname} to be handled`);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body.toString('utf8'));
}

function expectedTokenBucketCost(row, overrides = {}) {
  const result = resolveUsageCost({
    source: row.provider,
    model: row.model,
    total_tokens: row.total_tokens,
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    cache_creation_5m_input_tokens: row.cache_creation_5m_input_tokens,
    cache_creation_1h_input_tokens: row.cache_creation_1h_input_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
    web_search_requests: row.web_search_requests,
    ...overrides,
  });
  assert.equal(result.cost_quality, 'token_buckets');
  assert.equal(result.total_cost_usd > 0, true);
  return result.total_cost_usd;
}

function pickParams(source, keys) {
  return Object.fromEntries(keys.map((key) => [key, source[key] === undefined ? null : source[key]]));
}

function insertSession(db, row) {
  const params = {
    provider: 'codex',
    started_at: row.first_observed_at,
    ended_at: null,
    end_reason: null,
    cwd: row.repo_root || row.cwd,
    repo_root: row.repo_root || null,
    repo_common_dir: null,
    parent_repo: row.repo_root || null,
    branch: row.branch,
    branch_resolution_tier: row.branch_resolution_tier || 'A',
    confidence: row.confidence || 'high',
    model: 'gpt-5.4',
    total_tokens: 0,
    total_cost_usd: null,
    last_observed_at: row.last_observed_at,
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
    cost_estimated: 0,
    cost_quality: 'stored',
    created_at: row.first_observed_at,
    updated_at: row.last_observed_at,
    ...row,
  };
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, @end_reason,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @cost_estimated, @cost_quality, @created_at, @updated_at
    )
  `).run(pickParams(params, [
    'provider', 'session_id', 'started_at', 'ended_at', 'end_reason',
    'cwd', 'repo_root', 'repo_common_dir', 'parent_repo',
    'branch', 'branch_resolution_tier', 'confidence', 'model',
    'total_tokens', 'total_cost_usd', 'last_observed_at',
    'input_tokens', 'cached_input_tokens', 'cache_creation_input_tokens',
    'cache_creation_5m_input_tokens', 'cache_creation_1h_input_tokens',
    'output_tokens', 'reasoning_output_tokens',
    'web_search_requests', 'tool_call_count', 'tools_json', 'activity_json',
    'cost_estimated', 'cost_quality', 'created_at', 'updated_at',
  ]));
}

function insertEvent(db, row) {
  const params = {
    event_key: `${row.session_id}:update`,
    observed_at: row.last_observed_at,
    started_at: row.first_observed_at,
    ended_at: row.ended_at || null,
    end_reason: row.end_reason || null,
    cwd: row.repo_root || row.cwd,
    parent_repo: row.repo_root || null,
    delta_tokens: row.total_tokens,
    created_at: row.last_observed_at,
    ...row,
  };
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at,
      started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, model,
      delta_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count, total_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      created_at
    ) VALUES (
      @provider, @session_id, @event_key, 'update', @observed_at,
      @started_at, @ended_at, @end_reason,
      @cwd, @repo_root, NULL, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, @model,
      @delta_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @conversation_count, @total_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @created_at
    )
  `).run(pickParams(params, [
    'provider', 'session_id', 'event_key', 'observed_at',
    'started_at', 'ended_at', 'end_reason',
    'cwd', 'repo_root', 'parent_repo',
    'branch', 'branch_resolution_tier', 'confidence', 'model',
    'delta_tokens', 'input_tokens', 'cached_input_tokens', 'cache_creation_input_tokens',
    'output_tokens', 'reasoning_output_tokens', 'conversation_count', 'total_tokens',
    'cache_creation_5m_input_tokens', 'cache_creation_1h_input_tokens',
    'web_search_requests', 'tool_call_count', 'tools_json', 'activity_json',
    'created_at',
  ]));
}

function insertBucket(db, row) {
  const params = {
    bucket_hour_start: `${row.first_observed_at.slice(0, 13)}:00:00.000Z`,
    ...row,
  };
  db.prepare(`
    INSERT INTO vibedeck_session_buckets (
      provider, session_id, bucket_provider, bucket_model, bucket_hour_start,
      proportion, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      conversation_count, total_tokens, total_cost_usd,
      cost_estimated, cost_quality, last_observed_at
    ) VALUES (
      @provider, @session_id, @provider, @model, @bucket_hour_start,
      1.0, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @conversation_count, @total_tokens, @total_cost_usd,
      @cost_estimated, @cost_quality, @last_observed_at
    )
  `).run(pickParams(params, [
    'provider', 'session_id', 'model', 'bucket_hour_start',
    'input_tokens', 'cached_input_tokens', 'cache_creation_input_tokens',
    'cache_creation_5m_input_tokens', 'cache_creation_1h_input_tokens',
    'output_tokens', 'reasoning_output_tokens',
    'web_search_requests', 'tool_call_count', 'tools_json', 'activity_json',
    'conversation_count', 'total_tokens', 'total_cost_usd',
    'cost_estimated', 'cost_quality', 'last_observed_at',
  ]));
}

function insertFact(db, row) {
  const params = {
    provider: 'codex',
    scope_key: `git:${row.repo_root || row.project_ref || row.cwd || row.session_id}`,
    project_state: 'git_existing',
    project_key: 'repo',
    project_ref: row.repo_root || row.cwd || null,
    cwd: row.repo_root || row.cwd || null,
    repo_root: row.repo_root || null,
    parent_repo: row.repo_root || null,
    attribution_branch: row.branch,
    branch_kind: 'known',
    branch_resolution_tier: 'A',
    confidence: 'high',
    model: 'gpt-5.4',
    event_count: 1,
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
    cost_estimated: 0,
    cost_quality: 'stored',
    cost_reconciled: row.total_cost_usd == null ? 0 : 1,
    created_at: row.first_observed_at,
    updated_at: row.last_observed_at,
    ...row,
  };
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
      @cwd, @repo_root, NULL, @parent_repo,
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
      1, @cost_reconciled,
      @created_at, @updated_at
    )
  `).run(pickParams(params, [
    'provider', 'session_id',
    'scope_key', 'project_state', 'project_key', 'project_ref',
    'cwd', 'repo_root', 'parent_repo',
    'branch', 'attribution_branch', 'branch_kind',
    'branch_resolution_tier', 'confidence', 'model',
    'first_observed_at', 'last_observed_at',
    'event_count', 'total_tokens',
    'input_tokens', 'cached_input_tokens', 'cache_creation_input_tokens',
    'cache_creation_5m_input_tokens', 'cache_creation_1h_input_tokens',
    'output_tokens', 'reasoning_output_tokens',
    'web_search_requests', 'tool_call_count', 'tools_json', 'activity_json',
    'conversation_count',
    'total_cost_usd', 'cost_estimated', 'cost_quality',
    'cost_reconciled',
    'created_at', 'updated_at',
  ]));
}

test('enriched costs reconcile across usage, dashboard live snapshot, and branch rollups without hiding unknown buckets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-enriched-reconcile-'));
  const previousIdleTimeoutMin = process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
  try {
    process.env.VIBEDECK_IDLE_TIMEOUT_MIN = '1000000';
    const trackerDir = path.join(root, 'tracker');
    const repoRoot = path.join(root, 'repo');
    const missingRoot = path.join(root, '.worktrees', 'missing');
    await fs.mkdir(trackerDir, { recursive: true });
    await fs.mkdir(repoRoot, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const baseMs = Date.UTC(2026, 4, 22, 12, 0, 0);
    const isoAt = (minutes) => new Date(baseMs + (minutes * 60 * 1000)).toISOString();
    const summaryDay = isoAt(0).slice(0, 10);

    const known = {
      provider: 'codex',
      session_id: 'known-split-cache',
      first_observed_at: isoAt(0),
      last_observed_at: isoAt(1),
      repo_root: repoRoot,
      branch: 'main',
      model: 'gpt-5.4',
      total_tokens: 156000,
      input_tokens: 100000,
      cached_input_tokens: 20000,
      cache_creation_input_tokens: 30000,
      cache_creation_5m_input_tokens: 10000,
      cache_creation_1h_input_tokens: 20000,
      output_tokens: 5000,
      reasoning_output_tokens: 1000,
      web_search_requests: 2,
      tool_call_count: 4,
      tools_json: '{"Read":2,"WebSearch":2}',
      activity_json: '{"edit":1,"inspect":2}',
      conversation_count: 1,
      cost_estimated: 0,
      cost_quality: 'token_buckets',
    };
    known.total_cost_usd = expectedTokenBucketCost(known);

    const webOnly = {
      provider: 'codex',
      session_id: 'zero-token-web-only',
      first_observed_at: isoAt(2),
      last_observed_at: isoAt(3),
      repo_root: repoRoot,
      branch: 'main',
      model: 'gpt-5.4',
      total_tokens: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m_input_tokens: 0,
      cache_creation_1h_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      web_search_requests: 3,
      tool_call_count: 1,
      tools_json: '{"WebSearch":3}',
      activity_json: '{"research":1}',
      conversation_count: 1,
      cost_estimated: 0,
      cost_quality: 'token_buckets',
    };
    webOnly.total_cost_usd = expectedTokenBucketCost(webOnly, { total_tokens: null });

    const historical = {
      provider: 'codex',
      session_id: 'historical-unknown-enriched',
      first_observed_at: isoAt(1),
      last_observed_at: isoAt(2),
      started_at: isoAt(1),
      ended_at: isoAt(2),
      end_reason: 'complete',
      cwd: missingRoot,
      repo_root: null,
      parent_repo: null,
      project_state: 'git_missing',
      project_key: 'missing',
      project_ref: missingRoot,
      scope_key: `missing:${missingRoot}`,
      branch: 'Historical unknown',
      attribution_branch: 'Historical unknown',
      branch_kind: 'historical_unknown',
      branch_resolution_tier: 'D',
      confidence: 'unattributed',
      model: 'gpt-5.4',
      total_tokens: 50,
      input_tokens: 30,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m_input_tokens: 0,
      cache_creation_1h_input_tokens: 0,
      output_tokens: 20,
      reasoning_output_tokens: 0,
      web_search_requests: 1,
      tool_call_count: 2,
      tools_json: '{"Shell":1,"WebSearch":1}',
      activity_json: '{"audit":1}',
      conversation_count: 1,
      total_cost_usd: 0.123456,
      cost_estimated: 0,
      cost_quality: 'stored',
    };

    const unknownFact = {
      provider: 'codex',
      session_id: 'unknown-branch-visible',
      first_observed_at: isoAt(2),
      last_observed_at: isoAt(3),
      cwd: path.join(root, 'unattributed'),
      repo_root: null,
      parent_repo: null,
      project_state: 'unattributed',
      project_key: 'unattributed',
      project_ref: null,
      scope_key: 'unattributed:unknown-branch-visible',
      branch: 'Unknown branch',
      attribution_branch: 'Unknown branch',
      branch_kind: 'unknown_git',
      branch_resolution_tier: 'D',
      confidence: 'unattributed',
      model: 'gpt-5.4',
      total_tokens: 25,
      input_tokens: 25,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m_input_tokens: 0,
      cache_creation_1h_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      web_search_requests: 0,
      tool_call_count: 1,
      tools_json: '{"WebSearch":9}',
      activity_json: '{"unattributed":1}',
      conversation_count: 1,
      total_cost_usd: null,
      cost_estimated: 1,
      cost_quality: 'partial_unknown',
      cost_reconciled: 0,
    };

    const sessionRows = [known, webOnly, historical];
    const factRows = [known, webOnly, historical, unknownFact];
    const db = new DatabaseSync(dbPath);
    try {
      for (const row of sessionRows) {
        insertSession(db, row);
        insertEvent(db, row);
        insertBucket(db, row);
      }
      for (const row of factRows) insertFact(db, row);
    } finally {
      db.close();
    }

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const counts = readDb.prepare(`
        SELECT
          (SELECT COUNT(*) FROM vibedeck_sessions) AS sessions,
          (SELECT COUNT(*) FROM vibedeck_session_events) AS events,
          (SELECT COUNT(*) FROM vibedeck_session_buckets) AS buckets,
          (SELECT SUM(total_tokens) FROM vibedeck_sessions) AS session_tokens,
          (SELECT SUM(total_tokens) FROM vibedeck_session_events) AS event_tokens,
          (SELECT SUM(total_tokens) FROM vibedeck_session_buckets) AS bucket_tokens
      `).get();
      assert.equal(counts.sessions, 3);
      assert.equal(counts.events, 3);
      assert.equal(counts.buckets, 3);
      assert.equal(counts.session_tokens, 156050);
      assert.equal(counts.event_tokens, 156050);
      assert.equal(counts.bucket_tokens, 156050);

      const costRows = readDb.prepare(`
        SELECT s.session_id, s.total_cost_usd AS session_cost, b.total_cost_usd AS bucket_cost, f.total_cost_usd AS fact_cost
        FROM vibedeck_sessions s
        JOIN vibedeck_session_buckets b ON b.provider = s.provider AND b.session_id = s.session_id
        JOIN vibedeck_branch_usage_facts f ON f.provider = s.provider AND f.session_id = s.session_id
        ORDER BY s.session_id
      `).all();
      assert.equal(costRows.length, 3);
      for (const row of costRows) {
        assertClose(row.session_cost, row.bucket_cost);
        assertClose(row.session_cost, row.fact_cost);
      }

      const qualities = Object.fromEntries(readDb.prepare(`
        SELECT cost_quality, COUNT(*) AS count
        FROM vibedeck_branch_usage_facts
        GROUP BY cost_quality
      `).all().map((row) => [row.cost_quality, row.count]));
      assert.deepEqual(qualities, {
        partial_unknown: 1,
        stored: 1,
        token_buckets: 2,
      });
    } finally {
      readDb.close();
    }

    const expectedKnownCost = known.total_cost_usd + webOnly.total_cost_usd;
    const expectedUsageCost = expectedKnownCost + historical.total_cost_usd;

    const usage = await callLocalApi(
      queuePath,
      `/functions/vibedeck-usage-summary?from=${summaryDay}&to=${summaryDay}&tz=UTC`,
    );
    assert.equal(usage.canonical.complete, true);
    assert.equal(usage.totals.total_tokens, 156050);
    assert.equal(usage.totals.conversation_count, 3);
    assertClose(Number(usage.totals.total_cost_usd), expectedUsageCost);

    const branches = await callLocalApi(
      queuePath,
      `/functions/vibedeck-branch-usage?include_sessions=1&include_date_buckets=1&repo=${encodeURIComponent(repoRoot)}`,
    );
    assert.equal(branches.totals.total_tokens, 156000);
    assertClose(branches.totals.total_cost_usd, expectedKnownCost);
    const mainRepo = branches.repos.find((repo) => repo.project_ref === repoRoot);
    assert.ok(mainRepo);
    const mainBranch = mainRepo.branches.find((branch) => branch.branch === 'main');
    assert.ok(mainBranch);
    assert.equal(mainBranch.total_tokens, 156000);
    assertClose(mainBranch.total_cost_usd, expectedKnownCost);
    assert.equal(mainBranch.cache_creation_5m_input_tokens, 10000);
    assert.equal(mainBranch.cache_creation_1h_input_tokens, 20000);
    assert.equal(mainBranch.web_search_requests, 5);
    assert.equal(mainBranch.tool_call_count, 5);
    assert.equal(mainBranch.tools_json, '{"Read":2,"WebSearch":5}');
    assert.equal(mainBranch.activity_json, '{"edit":1,"inspect":2,"research":1}');
    assert.equal(mainBranch.sessions.length, 2);
    assert.ok(mainBranch.sessions.some((row) => row.session_id === 'zero-token-web-only' && row.total_tokens === 0 && row.total_cost_usd > 0));
    assert.equal(mainBranch.models[0].web_search_requests, 5);
    assert.equal(mainBranch.models[0].cache_creation_5m_input_tokens, 10000);
    assert.equal(mainBranch.date_buckets[0].web_search_requests, 5);
    assert.equal(mainBranch.date_buckets[0].models[0].tool_call_count, 5);

    const live = await callLocalApi(queuePath, '/functions/vibedeck-sessions-live-snapshot');
    const liveWorkstream = live.workstreams.find((workstream) => workstream.project_ref === repoRoot);
    assert.ok(liveWorkstream);
    assert.equal(liveWorkstream.audit_total_tokens, 156000);
    assertClose(liveWorkstream.audit_total_cost_usd, expectedKnownCost);
    assertClose(liveWorkstream.active_total_cost_usd, expectedKnownCost);
    const liveMain = liveWorkstream.branch_groups.find((group) => group.branch === 'main');
    assert.ok(liveMain);
    assertClose(liveMain.audit_total_cost_usd, expectedKnownCost);
    assertClose(liveMain.active_total_cost_usd, expectedKnownCost);
    assert.equal(liveMain.web_search_requests, 5);
    assert.equal(liveMain.sessions.length, 2);
    assert.ok(live.sessions.some((row) => row.session_id === 'zero-token-web-only' && row.estimated_total_cost_usd === webOnly.total_cost_usd));

    const allBranches = await callLocalApi(
      queuePath,
      '/functions/vibedeck-branch-usage?include_sessions=1&include_date_buckets=1&include_archived=1&include_unattributed=1',
    );
    const visibleBranches = allBranches.repos.flatMap((repo) => repo.branches);
    const historicalBranch = visibleBranches.find((branch) => branch.branch === 'Historical unknown');
    assert.ok(historicalBranch);
    assert.equal(historicalBranch.branch_kind, 'historical_unknown');
    assert.equal(historicalBranch.web_search_requests, 1);
    assert.equal(historicalBranch.tool_call_count, 2);
    assert.equal(historicalBranch.tools_json, '{"Shell":1,"WebSearch":1}');
    assertClose(historicalBranch.total_cost_usd, historical.total_cost_usd);

    const unknownBranch = visibleBranches.find((branch) => branch.branch === 'Unknown branch');
    assert.ok(unknownBranch);
    assert.equal(unknownBranch.branch_kind, 'unknown_git');
    assert.equal(unknownBranch.cost_quality, 'partial_unknown');
    assert.equal(unknownBranch.total_cost_usd, null);
    assert.equal(unknownBranch.tool_call_count, 1);
    assert.equal(unknownBranch.tools_json, '{"WebSearch":9}');
    assert.equal(unknownBranch.activity_json, '{"unattributed":1}');
  } finally {
    if (previousIdleTimeoutMin === undefined) delete process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
    else process.env.VIBEDECK_IDLE_TIMEOUT_MIN = previousIdleTimeoutMin;
    await fs.rm(root, { recursive: true, force: true });
  }
});
