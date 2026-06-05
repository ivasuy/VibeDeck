const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { makeUpdate } = require('../src/lib/sessions/event');
const { insertSessionEvent } = require('../src/lib/sessions/event-ledger');
const { extractClaudeCodeSessionEvents } = require('../src/lib/sessions/extractors');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-event-enrichment-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    db: new DatabaseSync(dbPath),
    cleanup() {
      this.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('SessionEvent update accepts cache split, web search, tools, and activity fields', () => {
  const event = makeUpdate({
    provider: 'claude',
    session_id: 'session-1',
    observed_at: '2026-05-18T00:00:00.000Z',
    delta_tokens: 200,
    input_tokens: 10,
    cached_input_tokens: 20,
    cache_creation_input_tokens: 70,
    cache_creation_5m_input_tokens: 30,
    cache_creation_1h_input_tokens: 40,
    output_tokens: 100,
    reasoning_output_tokens: 0,
    web_search_requests: 2,
    tool_call_count: 3,
    tools_json: JSON.stringify({ Bash: 1, Read: 1, Edit: 1 }),
    activity_json: JSON.stringify({ shell: 1, reading: 1, editing: 1 }),
    conversation_count: 1,
  });

  assert.equal(event.cache_creation_5m_input_tokens, 30);
  assert.equal(event.cache_creation_1h_input_tokens, 40);
  assert.equal(event.web_search_requests, 2);
  assert.equal(event.tool_call_count, 3);
  assert.equal(event.tools_json, JSON.stringify({ Bash: 1, Read: 1, Edit: 1 }));
  assert.equal(event.activity_json, JSON.stringify({ shell: 1, reading: 1, editing: 1 }));
});

test('SessionEvent update rejects negative enrichment counters', () => {
  assert.throws(
    () =>
      makeUpdate({
        provider: 'claude',
        session_id: 'session-1',
        observed_at: '2026-05-18T00:00:00.000Z',
        cache_creation_1h_input_tokens: -1,
      }),
    /cache_creation_1h_input_tokens/,
  );
});

test('SessionEvent update rejects invalid enrichment JSON', () => {
  assert.throws(
    () =>
      makeUpdate({
        provider: 'claude',
        session_id: 'session-1',
        observed_at: '2026-05-18T00:00:00.000Z',
        tools_json: '{bad json',
      }),
    /tools_json/,
  );
});

test('insertSessionEvent persists enrichment fields', () => {
  const tmp = makeDb();
  try {
    const event = makeUpdate({
      provider: 'claude',
      session_id: 'session-1',
      observed_at: '2026-05-18T00:00:00.000Z',
      delta_tokens: 200,
      cache_creation_input_tokens: 70,
      cache_creation_5m_input_tokens: 30,
      cache_creation_1h_input_tokens: 40,
      web_search_requests: 2,
      tool_call_count: 1,
      tools_json: JSON.stringify({ WebSearch: 1 }),
      activity_json: JSON.stringify({ research: 1 }),
    });
    insertSessionEvent(tmp.db, event, { branch: 'main', confidence: 'provider' });
    const row = tmp.db
      .prepare('SELECT * FROM vibedeck_session_events WHERE provider = ? AND session_id = ?')
      .get('claude', 'session-1');
    assert.equal(row.cache_creation_5m_input_tokens, 30);
    assert.equal(row.cache_creation_1h_input_tokens, 40);
    assert.equal(row.web_search_requests, 2);
    assert.equal(row.tool_call_count, 1);
    assert.equal(row.tools_json, JSON.stringify({ WebSearch: 1 }));
    assert.equal(row.activity_json, JSON.stringify({ research: 1 }));
    assert.equal(row.branch, 'main');
  } finally {
    tmp.cleanup();
  }
});

test('generic session extractors pass enrichment fields through updates', () => {
  const events = extractClaudeCodeSessionEvents({
    session_id: 'session-1',
    started_at: '2026-05-18T00:00:00.000Z',
    cwd: '/tmp/repo',
    model: 'claude',
    branch: 'main',
    updates: [
      {
        observed_at: '2026-05-18T00:01:00.000Z',
        delta_tokens: 50,
        cache_creation_5m_input_tokens: 10,
        cache_creation_1h_input_tokens: 20,
        web_search_requests: 1,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Read: 1, Edit: 1 }),
        activity_json: JSON.stringify({ reading: 1, editing: 1 }),
      },
    ],
  });

  const update = events.find((event) => event.kind === 'update');
  assert.equal(update.cache_creation_5m_input_tokens, 10);
  assert.equal(update.cache_creation_1h_input_tokens, 20);
  assert.equal(update.web_search_requests, 1);
  assert.equal(update.tool_call_count, 2);
  assert.equal(update.tools_json, JSON.stringify({ Read: 1, Edit: 1 }));
  assert.equal(update.activity_json, JSON.stringify({ reading: 1, editing: 1 }));
  assert.equal(update.branch, 'main');
});
