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

test('vibedeck-sessions-live snapshot estimates active cost from split cache and numeric web search', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-api-enrichment-'));
  try {
    const now = new Date().toISOString();
    const trackerDir = path.join(root, 'tracker');
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    await fs.writeFile(queuePath, '', 'utf8');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
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
          'codex', 'split-cache-web', @now, NULL, NULL,
          '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
          'feature/enrichment', 'A', 'high', NULL,
          'gpt-5.4', 200003, NULL, @now,
          0, 0, 0,
          100000, 100000,
          0, 0,
          3, 0, '{"web_search":3}', '{"active":1}',
          1, 'token_buckets', @now, @now
        )
      `).run({ now });
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
      new URL('http://127.0.0.1/functions/vibedeck-sessions-live-snapshot'),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString('utf8'));
    const session = body.sessions.find((row) => row.session_id === 'split-cache-web');
    assert.ok(session);
    const expected = resolveUsageCost({
      source: 'codex',
      model: 'gpt-5.4',
      total_tokens: 200003,
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation_5m_input_tokens: 100000,
      cache_creation_1h_input_tokens: 100000,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      web_search_requests: 3,
    });
    assert.equal(session.cache_creation_5m_input_tokens, 100000);
    assert.equal(session.cache_creation_1h_input_tokens, 100000);
    assert.equal(session.web_search_requests, 3);
    assert.equal(session.estimated_total_cost_usd, expected.total_cost_usd);
    assert.equal(session.cost_quality, 'token_buckets');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
