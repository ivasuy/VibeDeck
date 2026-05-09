const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-sessions-writer-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fetchSessionRow(dbPath, provider, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (
      db
        .prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
        .get(provider, sessionId) || null
    );
  } finally {
    db.close();
  }
}

test('start + update + end produces a single row with correct totals', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { makeStart, makeUpdate, makeEnd } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    const events = [
      makeStart({
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-09T10:00:00.000Z',
        cwd: '/repo',
        model: 'gpt-4.1',
      }),
      makeUpdate({
        provider: 'codex',
        session_id: 's1',
        observed_at: '2026-05-09T10:01:00.000Z',
        delta_tokens: 120,
      }),
      makeEnd({
        provider: 'codex',
        session_id: 's1',
        ended_at: '2026-05-09T10:02:00.000Z',
        total_tokens: 120,
        end_reason: 'normal',
      }),
    ];

    upsertSessionFromEvents(tmp.dbPath, events);
    const row = fetchSessionRow(tmp.dbPath, 'codex', 's1');
    assert.ok(row, 'expected session row');

    assert.equal(row.provider, 'codex');
    assert.equal(row.session_id, 's1');
    assert.equal(row.started_at, '2026-05-09T10:00:00.000Z');
    assert.equal(row.ended_at, '2026-05-09T10:02:00.000Z');
    assert.equal(row.end_reason, 'normal');
    assert.equal(row.cwd, '/repo');
    assert.equal(row.model, 'gpt-4.1');
    assert.equal(row.total_tokens, 120);
    assert.equal(row.confidence, 'unattributed');
    assert.equal(row.branch_resolution_tier, 'D');
  } finally {
    tmp.cleanup();
  }
});

test('replaying same events twice produces identical row (idempotent — compare every column)', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { makeStart, makeUpdate, makeEnd } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    const events = [
      makeStart({
        provider: 'claude',
        session_id: 'abc',
        started_at: '2026-05-09T11:00:00.000Z',
        cwd: null,
        model: 'claude-3.7',
      }),
      makeUpdate({
        provider: 'claude',
        session_id: 'abc',
        observed_at: '2026-05-09T11:00:10.000Z',
        delta_tokens: 10,
        cwd: '/maybe',
      }),
      makeEnd({
        provider: 'claude',
        session_id: 'abc',
        ended_at: '2026-05-09T11:01:00.000Z',
        end_reason: 'user_exit',
      }),
    ];

    upsertSessionFromEvents(tmp.dbPath, events);
    const row1 = fetchSessionRow(tmp.dbPath, 'claude', 'abc');

    upsertSessionFromEvents(tmp.dbPath, events);
    const row2 = fetchSessionRow(tmp.dbPath, 'claude', 'abc');

    assert.deepEqual(row2, row1);
  } finally {
    tmp.cleanup();
  }
});

test('out-of-order events: end-before-start in array still yields correct started_at + ended_at', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { makeStart, makeEnd } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    const events = [
      makeEnd({
        provider: 'gemini',
        session_id: 'g1',
        ended_at: '2026-05-09T12:10:00.000Z',
        end_reason: 'normal',
      }),
      makeStart({
        provider: 'gemini',
        session_id: 'g1',
        started_at: '2026-05-09T12:00:00.000Z',
        cwd: '/x',
      }),
    ];

    upsertSessionFromEvents(tmp.dbPath, events);
    const row = fetchSessionRow(tmp.dbPath, 'gemini', 'g1');
    assert.ok(row);
    assert.equal(row.started_at, '2026-05-09T12:00:00.000Z');
    assert.equal(row.ended_at, '2026-05-09T12:10:00.000Z');
  } finally {
    tmp.cleanup();
  }
});

test('reconnect: applying [start1,end1] then [start2,end2] with same (provider,session_id) merges into one row spanning min(start) max(end)', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { makeStart, makeEnd } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    const batch1 = [
      makeStart({
        provider: 'cursor',
        session_id: 'same',
        started_at: '2026-05-09T09:00:00.000Z',
        cwd: null,
      }),
      makeEnd({
        provider: 'cursor',
        session_id: 'same',
        ended_at: '2026-05-09T09:05:00.000Z',
        end_reason: 'disconnect',
      }),
    ];

    const batch2 = [
      makeStart({
        provider: 'cursor',
        session_id: 'same',
        started_at: '2026-05-09T09:10:00.000Z',
        cwd: '/later',
      }),
      makeEnd({
        provider: 'cursor',
        session_id: 'same',
        ended_at: '2026-05-09T09:12:00.000Z',
        end_reason: 'normal',
      }),
    ];

    upsertSessionFromEvents(tmp.dbPath, batch1);
    upsertSessionFromEvents(tmp.dbPath, batch2);

    const row = fetchSessionRow(tmp.dbPath, 'cursor', 'same');
    assert.ok(row);
    assert.equal(row.started_at, '2026-05-09T09:00:00.000Z');
    assert.equal(row.ended_at, '2026-05-09T09:12:00.000Z');
    assert.equal(row.end_reason, 'normal');
  } finally {
    tmp.cleanup();
  }
});

test('null cwd + null repo (no resolution) produces row with confidence=unattributed, branch_resolution_tier=D', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { makeStart } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    const events = [
      makeStart({
        provider: 'opencode',
        session_id: 'oc1',
        started_at: '2026-05-09T13:00:00.000Z',
        cwd: null,
        model: null,
      }),
    ];

    upsertSessionFromEvents(tmp.dbPath, events);
    const row = fetchSessionRow(tmp.dbPath, 'opencode', 'oc1');
    assert.ok(row);
    assert.equal(row.cwd, null);
    assert.equal(row.repo_root, null);
    assert.equal(row.confidence, 'unattributed');
    assert.equal(row.branch_resolution_tier, 'D');
  } finally {
    tmp.cleanup();
  }
});
