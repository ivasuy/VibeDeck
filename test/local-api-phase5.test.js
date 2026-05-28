'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { createLocalApiHandler } = require('../src/lib/local-api');

async function call(handler, route, options = {}) {
  const chunks = [];
  const headers = {};
  let statusCode = 200;
  const url = new URL(`http://127.0.0.1${route}`);
  const req = {
    method: options.method || 'GET',
    url: url.pathname + url.search,
    headers: { host: '127.0.0.1', ...(options.headers || {}) },
  };
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-phase5-api-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  fs.writeFileSync(queuePath, '', 'utf8');
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, queuePath, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertFact(db, overrides = {}) {
  const now = overrides.last_observed_at || '2026-05-23T10:00:00.000Z';
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
    session_id: `s-${Math.random().toString(16).slice(2)}`,
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
    event_count: 1,
    total_tokens: 1000,
    input_tokens: 700,
    cached_input_tokens: 100,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    output_tokens: 200,
    reasoning_output_tokens: 0,
    conversation_count: 1,
    total_cost_usd: 1.25,
    cost_estimated: 0,
    cost_quality: 'stored',
    token_reconciled: 0,
    cost_reconciled: 0,
    created_at: now,
    updated_at: now,
    web_search_requests: 0,
    tool_call_count: 1,
    tools_json: '{}',
    activity_json: '{}',
    task_category: '{}',
    skills_json: '{}',
    fast_mode: 0,
    ...overrides,
  });
}

function withEnv(nextEnv, fn) {
  const previous = {};
  for (const key of Object.keys(nextEnv)) {
    previous[key] = process.env[key];
    process.env[key] = nextEnv[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(nextEnv)) {
      if (previous[key] == null) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('GET /functions/vibedeck-optimize/findings returns latest optimizer health and findings', async () => {
  const f = makeFixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    try {
      db.prepare(`INSERT INTO vibedeck_optimize_runs (
        run_id, observed_at, health_grade, score, finding_count,
        high_count, medium_count, low_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('opt-test', '2026-05-23T00:00:00.000Z', 'B', 82, 1, 0, 1, 0, '2026-05-23T00:00:00.000Z');
      db.prepare(`INSERT INTO vibedeck_optimize_findings (
        run_id, fingerprint, scope, scope_ref, provider, session_id,
        finding_kind, severity, title, detail, estimated_token_waste,
        estimated_cost_waste_usd, paste_fix, status, trend, observed_at,
        resolved_at, previous_finding_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          'opt-test',
          'fp-1',
          'session',
          '/tmp/repo',
          'claude',
          's1',
          'file_reread',
          'medium',
          'Repeated file reads',
          'Read was repeated.',
          4000,
          0.012,
          'Cache reads.',
          'open',
          'new',
          '2026-05-23T00:00:00.000Z',
          null,
          null,
          '2026-05-23T00:00:00.000Z',
          '2026-05-23T00:00:00.000Z',
        );
    } finally {
      db.close();
    }

    const payload = JSON.parse((await call(createLocalApiHandler({ queuePath: f.queuePath }), '/functions/vibedeck-optimize/findings')).body);
    assert.equal(payload.ok, true);
    assert.equal(payload.health.health_grade, 'B');
    assert.equal(payload.findings.length, 1);
    assert.equal(payload.findings[0].finding_kind, 'file_reread');
  } finally {
    f.cleanup();
  }
});

test('POST /functions/vibedeck-optimize/scan runs authenticated local optimizer scan', async () => {
  const f = makeFixture();
  try {
    const now = '2026-05-23T00:00:00.000Z';
    const db = new DatabaseSync(f.dbPath);
    try {
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason, cwd, repo_root,
          branch, branch_resolution_tier, confidence, model, total_tokens,
          input_tokens, cached_input_tokens, output_tokens, tools_json, activity_json,
          last_observed_at, created_at, updated_at
        ) VALUES (
          'claude', 'scan-target', @now, NULL, NULL, @cwd, @cwd,
          'main', 'A', 'high', 'claude-sonnet-4', 12000,
          10000, 0, 2000, @tools_json, @activity_json,
          @now, @now, @now
        )
      `).run({
        now,
        cwd: f.dir,
        tools_json: JSON.stringify({ Read: 10, Edit: 1 }),
        activity_json: JSON.stringify({ reading: 10, editing: 1 }),
      });
    } finally {
      db.close();
    }

    const handler = createLocalApiHandler({ queuePath: f.queuePath });
    const auth = JSON.parse((await call(handler, '/api/local-auth', {
      headers: { origin: 'http://127.0.0.1' },
    })).body);
    const scan = JSON.parse((await call(handler, '/functions/vibedeck-optimize/scan', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1',
        'x-vibedeck-local-auth': auth.token,
      },
    })).body);

    assert.equal(scan.ok, true);
    assert.equal(scan.inserted, 1);
    assert.equal(scan.health_grade, 'A');

    const findings = JSON.parse((await call(handler, '/functions/vibedeck-optimize/findings')).body);
    assert.equal(findings.findings.length, 1);
    assert.equal(findings.findings[0].session_id, 'scan-target');
  } finally {
    f.cleanup();
  }
});

test('GET /functions/vibedeck-plan labels Cursor as API-equivalent cost, not subscription owed', async () => {
  const f = makeFixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    try {
      insertFact(db, { total_cost_usd: 2.5 });
    } finally {
      db.close();
    }

    const payload = await withEnv({ VIBEDECK_PLAN: 'cursor-pro' }, async () =>
      JSON.parse((await call(createLocalApiHandler({ queuePath: f.queuePath }), '/functions/vibedeck-plan')).body));

    assert.equal(payload.plan, 'cursor-pro');
    assert.equal(payload.label, 'API-equivalent cost');
    assert.match(payload.label_detail, /not what you owe Cursor/);
  } finally {
    f.cleanup();
  }
});

test('GET /functions/vibedeck-plan labels Claude plans as Plan usage', async () => {
  const f = makeFixture();
  try {
    const payload = await withEnv({ VIBEDECK_PLAN: 'claude-pro' }, async () =>
      JSON.parse((await call(createLocalApiHandler({ queuePath: f.queuePath }), '/functions/vibedeck-plan')).body));

    assert.equal(payload.plan, 'claude-pro');
    assert.equal(payload.label, 'Plan usage');
  } finally {
    f.cleanup();
  }
});

test('GET /functions/vibedeck-forecast handles 90 daily fact rows in under 200ms', async () => {
  const f = makeFixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    try {
      for (let i = 0; i < 90; i += 1) {
        const day = new Date(Date.UTC(2026, 1, 23 + i)).toISOString().slice(0, 10);
        insertFact(db, {
          session_id: `s-${i}`,
          scope_key: `repo:/tmp/repo#${i}`,
          last_observed_at: `${day}T12:00:00.000Z`,
          first_observed_at: `${day}T12:00:00.000Z`,
          total_cost_usd: 1 + (i % 5),
        });
      }
    } finally {
      db.close();
    }

    const handler = createLocalApiHandler({ queuePath: f.queuePath });
    const start = performance.now();
    const payload = JSON.parse((await call(handler, '/functions/vibedeck-forecast?from=2026-02-23&to=2026-05-23')).body);
    const elapsed = performance.now() - start;

    assert.equal(payload.ok, true);
    assert.equal(payload.daily.length, 90);
    assert.ok(elapsed < 200, `forecast endpoint took ${elapsed}ms`);
  } finally {
    f.cleanup();
  }
});

test('GET /functions/vibedeck-export keeps USD costs unchanged when a display currency is requested', async () => {
  const f = makeFixture();
  try {
    const db = new DatabaseSync(f.dbPath);
    try {
      insertFact(db, { total_cost_usd: 12.34 });
    } finally {
      db.close();
    }

    const payload = JSON.parse((await call(
      createLocalApiHandler({ queuePath: f.queuePath }),
      '/functions/vibedeck-export?format=json&currency=EUR',
    )).body);

    assert.equal(payload.totals.total_cost_usd, '12.3400');
    assert.equal(payload.rows[0].cost_usd, '12.3400');
    assert.equal(Object.prototype.hasOwnProperty.call(payload.rows[0], 'cost_eur'), false);
  } finally {
    f.cleanup();
  }
});

test('GET /functions/vibedeck-usage-heatmap includes per-day cost for widget best-day dollars', async () => {
  const f = makeFixture();
  try {
    fs.writeFileSync(f.queuePath, `${JSON.stringify({
      source: 'codex',
      model: 'gpt-5.5',
      hour_start: '2026-05-20T12:00:00.000Z',
      total_tokens: 5000,
      billable_total_tokens: 5000,
      total_cost_usd: 4.2,
      cost_estimated: false,
    })}\n`, 'utf8');

    const payload = JSON.parse((await call(
      createLocalApiHandler({ queuePath: f.queuePath }),
      '/functions/vibedeck-usage-heatmap?weeks=2&tz=UTC',
    )).body);
    const cells = payload.weeks.flat();
    const day = cells.find((cell) => cell.day === '2026-05-20');

    assert.equal(day.total_tokens, 5000);
    assert.equal(day.total_cost_usd, 4.2);
  } finally {
    f.cleanup();
  }
});
