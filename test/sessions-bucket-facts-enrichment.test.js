const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const pricing = require('../src/lib/pricing');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');

test('session bucket facts accumulate enrichment fields and price split cache plus numeric web search', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bucket-facts-enriched-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'claude',
      session_id: 's1',
      started_at: '2026-05-18T09:00:00.000Z',
      cwd: dir,
      model: 'claude-opus-4-7',
    }, { deferBranchFactRebuild: true });

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'claude',
      session_id: 's1',
      observed_at: '2026-05-18T09:01:00.000Z',
      delta_tokens: 260,
      input_tokens: 100,
      cached_input_tokens: 20,
      cache_creation_input_tokens: 90,
      cache_creation_5m_input_tokens: 30,
      cache_creation_1h_input_tokens: 60,
      output_tokens: 50,
      reasoning_output_tokens: 0,
      conversation_count: 1,
      web_search_requests: 1,
      tool_call_count: 2,
      tools_json: JSON.stringify({ Read: 1, WebSearch: 1 }),
      activity_json: JSON.stringify({ reading: 1, research: 1 }),
      cwd: dir,
      model: 'claude-opus-4-7',
    }, { deferBranchFactRebuild: true });

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'claude',
      session_id: 's1',
      observed_at: '2026-05-18T09:02:00.000Z',
      delta_tokens: 0,
      web_search_requests: 2,
      tool_call_count: 1,
      tools_json: JSON.stringify({ WebSearch: 2 }),
      activity_json: JSON.stringify({ research: 2 }),
      cwd: dir,
      model: 'claude-opus-4-7',
    }, { deferBranchFactRebuild: true });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const bucket = db
      .prepare(`
        SELECT *
        FROM vibedeck_session_buckets
        WHERE provider = 'claude' AND session_id = 's1'
      `)
      .get();
    db.close();

    assert.equal(bucket.total_tokens, 260);
    assert.equal(bucket.cache_creation_input_tokens, 90);
    assert.equal(bucket.cache_creation_5m_input_tokens, 30);
    assert.equal(bucket.cache_creation_1h_input_tokens, 60);
    assert.equal(bucket.web_search_requests, 3);
    assert.equal(bucket.tool_call_count, 3);
    assert.deepEqual(JSON.parse(bucket.tools_json), { Read: 1, WebSearch: 3 });
    assert.deepEqual(JSON.parse(bucket.activity_json), { reading: 1, research: 3 });
    assert.equal(bucket.cost_quality, 'token_buckets');
    assert.equal(bucket.cost_estimated, 0);
    assert.equal(bucket.total_cost_usd, pricing.computeEnhancedRowCost({
      source: 'claude',
      model: 'claude-opus-4-7',
      input_tokens: 100,
      cached_input_tokens: 20,
      cache_creation_input_tokens: 90,
      cache_creation_5m_input_tokens: 30,
      cache_creation_1h_input_tokens: 60,
      output_tokens: 50,
      reasoning_output_tokens: 0,
      web_search_requests: 3,
      total_tokens: 260,
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('web-search-only bucket facts bill numeric requests into bucket and session costs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bucket-facts-web-only-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'claude',
      session_id: 'web-only',
      started_at: '2026-05-18T09:00:00.000Z',
      cwd: dir,
      model: 'claude-opus-4-7',
    }, { deferBranchFactRebuild: true });

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'claude',
      session_id: 'web-only',
      observed_at: '2026-05-18T09:01:00.000Z',
      delta_tokens: 0,
      web_search_requests: 2,
      tool_call_count: 4,
      tools_json: JSON.stringify({ WebSearch: 99 }),
      activity_json: JSON.stringify({ research: 99 }),
      cwd: dir,
      model: 'claude-opus-4-7',
    }, { deferBranchFactRebuild: true });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const bucket = db
      .prepare(`
        SELECT *
        FROM vibedeck_session_buckets
        WHERE provider = 'claude' AND session_id = 'web-only'
      `)
      .get();
    const session = db
      .prepare(`
        SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality
        FROM vibedeck_sessions
        WHERE provider = 'claude' AND session_id = 'web-only'
      `)
      .get();
    db.close();

    assert.equal(bucket.total_tokens, 0);
    assert.equal(bucket.web_search_requests, 2);
    assert.deepEqual(JSON.parse(bucket.tools_json), { WebSearch: 99 });
    assert.equal(bucket.cost_quality, 'token_buckets');
    assert.equal(bucket.cost_estimated, 0);
    assert.equal(bucket.total_cost_usd, pricing.computeEnhancedRowCost({
      source: 'claude',
      model: 'claude-opus-4-7',
      web_search_requests: 2,
    }));
    assert.equal(session.total_tokens, 0);
    assert.equal(session.cost_quality, 'token_buckets');
    assert.equal(session.cost_estimated, 0);
    assert.equal(session.total_cost_usd, bucket.total_cost_usd);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
