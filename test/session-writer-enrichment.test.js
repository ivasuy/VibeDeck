const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { makeStart, makeUpdate, makeEnd } = require('../src/lib/sessions/event');
const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-writer-enrichment-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    dbPath,
    db: new DatabaseSync(dbPath),
    cleanup() {
      this.db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('upsertSessionFromEvents sums cache split, web search, tools, and activity into session row', () => {
  const tmp = makeDb();
  try {
    const events = [
      makeStart({ provider: 'claude', session_id: 'session-1', started_at: '2026-05-18T00:00:00.000Z', cwd: '/repo', model: 'claude-opus-4-7' }),
      makeUpdate({
        provider: 'claude',
        session_id: 'session-1',
        observed_at: '2026-05-18T00:01:00.000Z',
        delta_tokens: 100,
        cache_creation_input_tokens: 50,
        cache_creation_5m_input_tokens: 20,
        cache_creation_1h_input_tokens: 30,
        web_search_requests: 1,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Bash: 1, Read: 1 }),
        activity_json: JSON.stringify({ shell: 1, reading: 1 }),
      }),
      makeUpdate({
        provider: 'claude',
        session_id: 'session-1',
        observed_at: '2026-05-18T00:02:00.000Z',
        delta_tokens: 200,
        cache_creation_input_tokens: 70,
        cache_creation_5m_input_tokens: 10,
        cache_creation_1h_input_tokens: 60,
        web_search_requests: 2,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Bash: 1, Edit: 1 }),
        activity_json: JSON.stringify({ shell: 1, editing: 1 }),
      }),
      makeEnd({ provider: 'claude', session_id: 'session-1', ended_at: '2026-05-18T00:03:00.000Z', total_tokens: 300, end_reason: 'log_complete' }),
    ];

    upsertSessionFromEvents(tmp.dbPath, events, { db: tmp.db });

    const row = tmp.db.prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get('claude', 'session-1');
    assert.equal(row.cache_creation_5m_input_tokens, 30);
    assert.equal(row.cache_creation_1h_input_tokens, 90);
    assert.equal(row.web_search_requests, 3);
    assert.equal(row.tool_call_count, 4);
    assert.deepEqual(JSON.parse(row.tools_json), { Bash: 2, Edit: 1, Read: 1 });
    assert.deepEqual(JSON.parse(row.activity_json), { editing: 1, reading: 1, shell: 2 });
  } finally {
    tmp.cleanup();
  }
});

test('upsertSessionFromEvents does not double-count enrichment for duplicate update events', () => {
  const tmp = makeDb();
  try {
    const events = [
      makeStart({ provider: 'claude', session_id: 'session-1', started_at: '2026-05-18T00:00:00.000Z' }),
      makeUpdate({
        provider: 'claude',
        session_id: 'session-1',
        observed_at: '2026-05-18T00:01:00.000Z',
        delta_tokens: 100,
        cache_creation_5m_input_tokens: 20,
        cache_creation_1h_input_tokens: 30,
        web_search_requests: 1,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Bash: 1 }),
        activity_json: JSON.stringify({ shell: 1 }),
      }),
    ];
    upsertSessionFromEvents(tmp.dbPath, events, { db: tmp.db });
    upsertSessionFromEvents(tmp.dbPath, events, { db: tmp.db });

    const row = tmp.db.prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get('claude', 'session-1');
    assert.equal(row.cache_creation_5m_input_tokens, 20);
    assert.equal(row.cache_creation_1h_input_tokens, 30);
    assert.equal(row.web_search_requests, 1);
    assert.equal(row.tool_call_count, 2);
    assert.deepEqual(JSON.parse(row.tools_json), { Bash: 1 });
    assert.deepEqual(JSON.parse(row.activity_json), { shell: 1 });
  } finally {
    tmp.cleanup();
  }
});
