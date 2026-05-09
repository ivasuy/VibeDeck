const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-sessions-reaper-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertSessionRow(dbPath, row) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      INSERT INTO vibedeck_sessions (
        provider, session_id,
        started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        @provider, @session_id,
        @started_at, @ended_at, @end_reason,
        @cwd, @repo_root, @repo_common_dir, @parent_repo,
        @branch, @branch_resolution_tier, @confidence, @override_user,
        @model, @total_tokens, @total_cost_usd,
        @created_at, @updated_at
      )
      `,
    ).run(row);
  } finally {
    db.close();
  }
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

test('reaps live session idle > timeout, leaves < timeout, and is idempotent', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const now = '2026-05-09T10:31:00.000Z';
    const base = {
      cwd: null,
      repo_root: null,
      repo_common_dir: null,
      parent_repo: null,
      branch: null,
      branch_resolution_tier: 'D',
      confidence: 'unattributed',
      override_user: null,
      model: null,
      total_tokens: null,
      total_cost_usd: null,
      created_at: '2026-05-09T10:00:00.000Z',
    };

    insertSessionRow(tmp.dbPath, {
      ...base,
      provider: 'codex',
      session_id: 'idle31',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: null,
      end_reason: null,
      updated_at: '2026-05-09T10:00:00.000Z',
    });

    insertSessionRow(tmp.dbPath, {
      ...base,
      provider: 'codex',
      session_id: 'idle29',
      started_at: '2026-05-09T10:02:00.000Z',
      ended_at: null,
      end_reason: null,
      updated_at: '2026-05-09T10:02:00.000Z',
    });

    const { reapOrphanedSessions } = require('../src/lib/sessions/reaper');

    const r1 = reapOrphanedSessions(tmp.dbPath, { now, idleTimeoutMin: 30 });
    assert.deepEqual(r1, { reaped: 1, scanned: 2 });

    const row31 = fetchSessionRow(tmp.dbPath, 'codex', 'idle31');
    assert.equal(row31.ended_at, '2026-05-09T10:00:00.000Z');
    assert.equal(row31.end_reason, 'orphan_reaped');

    const row29 = fetchSessionRow(tmp.dbPath, 'codex', 'idle29');
    assert.equal(row29.ended_at, null);
    assert.equal(row29.end_reason, null);

    const r2 = reapOrphanedSessions(tmp.dbPath, { now, idleTimeoutMin: 30 });
    assert.deepEqual(r2, { reaped: 0, scanned: 1 });
  } finally {
    tmp.cleanup();
  }
});

test('late-arriving real end signal overwrites if later than reaped, but not if earlier', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const base = {
      provider: 'claude',
      session_id: 'late',
      cwd: null,
      repo_root: null,
      repo_common_dir: null,
      parent_repo: null,
      branch: null,
      branch_resolution_tier: 'D',
      confidence: 'unattributed',
      override_user: null,
      model: null,
      total_tokens: null,
      total_cost_usd: null,
      created_at: '2026-05-09T10:00:00.000Z',
      updated_at: '2026-05-09T10:00:00.000Z',
    };

    insertSessionRow(tmp.dbPath, {
      ...base,
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:00:00.000Z',
      end_reason: 'orphan_reaped',
    });

    const { makeEnd } = require('../src/lib/sessions/event');
    const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');

    upsertSessionFromEvents(tmp.dbPath, [
      makeEnd({
        provider: 'claude',
        session_id: 'late',
        ended_at: '2026-05-09T10:05:00.000Z',
        end_reason: 'normal',
      }),
    ]);

    const rowLater = fetchSessionRow(tmp.dbPath, 'claude', 'late');
    assert.equal(rowLater.ended_at, '2026-05-09T10:05:00.000Z');
    assert.equal(rowLater.end_reason, 'normal');

    upsertSessionFromEvents(tmp.dbPath, [
      makeEnd({
        provider: 'claude',
        session_id: 'late',
        ended_at: '2026-05-09T10:01:00.000Z',
        end_reason: 'disconnect',
      }),
    ]);

    const rowEarlier = fetchSessionRow(tmp.dbPath, 'claude', 'late');
    assert.equal(rowEarlier.ended_at, '2026-05-09T10:05:00.000Z');
    assert.equal(rowEarlier.end_reason, 'normal');
  } finally {
    tmp.cleanup();
  }
});

test('VIBEDECK_IDLE_TIMEOUT_MIN env override and already-ended session is untouched', () => {
  const tmp = makeTempDbPath();
  const prev = process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
  process.env.VIBEDECK_IDLE_TIMEOUT_MIN = '5';
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const base = {
      cwd: null,
      repo_root: null,
      repo_common_dir: null,
      parent_repo: null,
      branch: null,
      branch_resolution_tier: 'D',
      confidence: 'unattributed',
      override_user: null,
      model: null,
      total_tokens: null,
      total_cost_usd: null,
      created_at: '2026-05-09T10:00:00.000Z',
    };

    insertSessionRow(tmp.dbPath, {
      ...base,
      provider: 'codex',
      session_id: 'idle6',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: null,
      end_reason: null,
      updated_at: '2026-05-09T10:00:00.000Z',
    });

    insertSessionRow(tmp.dbPath, {
      ...base,
      provider: 'codex',
      session_id: 'ended',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:04:00.000Z',
      end_reason: 'normal',
      updated_at: '2026-05-09T10:04:00.000Z',
    });

    const { reapOrphanedSessions } = require('../src/lib/sessions/reaper');
    const res = reapOrphanedSessions(tmp.dbPath, { now: '2026-05-09T10:06:00.000Z' });
    assert.deepEqual(res, { reaped: 1, scanned: 1 });

    const row = fetchSessionRow(tmp.dbPath, 'codex', 'idle6');
    assert.equal(row.ended_at, '2026-05-09T10:00:00.000Z');
    assert.equal(row.end_reason, 'orphan_reaped');

    const ended = fetchSessionRow(tmp.dbPath, 'codex', 'ended');
    assert.equal(ended.ended_at, '2026-05-09T10:04:00.000Z');
    assert.equal(ended.end_reason, 'normal');
  } finally {
    if (prev == null) delete process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
    else process.env.VIBEDECK_IDLE_TIMEOUT_MIN = prev;
    tmp.cleanup();
  }
});

