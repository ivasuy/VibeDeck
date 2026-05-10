const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');
const { getLiveBus } = require('../src/lib/sessions/live-bus');

function getSessionEndedState(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT ended_at, end_reason FROM vibedeck_sessions WHERE session_id = ?').get(sessionId);
  } finally {
    db.close();
  }
}

test('recent log_complete sessions remain open for live workbench', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-current-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const observed = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'current-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'current-session',
      observed_at: observed,
      delta_tokens: 1000,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'current-session',
      ended_at: observed,
      total_tokens: 1000,
      end_reason: 'log_complete',
      cwd: root,
      model: 'gpt-5.4',
    });

    const row = getSessionEndedState(dbPath, 'current-session');
    assert.equal(row.ended_at, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('stale log_complete sessions close immediately for backfilled imports', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-stale-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 45 * 60 * 1000).toISOString();
    const observed = new Date(now.getTime() - 31 * 60 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'stale-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'stale-session',
      ended_at: observed,
      total_tokens: 1000,
      end_reason: 'log_complete',
      cwd: root,
      model: 'gpt-5.4',
    });

    const row = getSessionEndedState(dbPath, 'stale-session');
    assert.equal(row.ended_at, observed);
    assert.equal(row.end_reason, 'log_complete');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('recent real end still closes even when it is inside idle timeout', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-real-end-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const ended = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'real-end-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'real-end-session',
      ended_at: ended,
      total_tokens: 1000,
      end_reason: 'normal',
      cwd: root,
      model: 'gpt-5.4',
    });

    const row = getSessionEndedState(dbPath, 'real-end-session');
    assert.equal(row.ended_at, ended);
    assert.equal(row.end_reason, 'normal');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('recent log_complete after a real end does not reopen or emit duplicate session:end', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-real-then-checkpoint-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const realEnded = new Date(now.getTime() - 60 * 1000).toISOString();
    const checkpointEnded = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'already-ended-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'end',
      provider: 'codex',
      session_id: 'already-ended-session',
      ended_at: realEnded,
      total_tokens: 1000,
      end_reason: 'normal',
      cwd: root,
      model: 'gpt-5.4',
    });

    const bus = getLiveBus();
    const seen = [];
    const onEnd = (event) => seen.push({ type: 'session:end', event });
    const onUpdate = (event) => seen.push({ type: 'session:update', event });
    bus.on('session:end', onEnd);
    bus.on('session:update', onUpdate);
    try {
      await processSessionEvent(dbPath, {
        kind: 'end',
        provider: 'codex',
        session_id: 'already-ended-session',
        ended_at: checkpointEnded,
        total_tokens: 1000,
        end_reason: 'log_complete',
        cwd: root,
        model: 'gpt-5.4',
      });
    } finally {
      bus.off('session:end', onEnd);
      bus.off('session:update', onUpdate);
    }

    const row = getSessionEndedState(dbPath, 'already-ended-session');
    assert.equal(row.ended_at, realEnded);
    assert.equal(row.end_reason, 'normal');
    assert.equal(seen.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
