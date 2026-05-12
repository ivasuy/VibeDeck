const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent, recoverActiveSessionMetadata } = require('../src/lib/sessions/pipeline');
const { reapOrphanedSessions } = require('../src/lib/sessions/reaper');
const { getLiveBus } = require('../src/lib/sessions/live-bus');

function getSessionEndedState(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT ended_at, end_reason FROM vibedeck_sessions WHERE session_id = ?').get(sessionId);
  } finally {
    db.close();
  }
}

function getSessionAttribution(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT cwd, repo_root, branch, confidence FROM vibedeck_sessions WHERE session_id = ?')
      .get(sessionId);
  } finally {
    db.close();
  }
}

function markSessionReaped(dbPath, sessionId, endedAt) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      UPDATE vibedeck_sessions
      SET ended_at = ?, end_reason = 'orphan_reaped', updated_at = ?
      WHERE session_id = ?
      `,
    ).run(endedAt, endedAt, sessionId);
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

test('live update events include persisted model for realtime cost pricing', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-update-model-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const now = new Date();
    const started = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
    const observed = new Date(now.getTime() - 30 * 1000).toISOString();

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'model-preserved-session',
      started_at: started,
      cwd: root,
      model: 'gpt-5.3-codex-spark',
    });

    const bus = getLiveBus();
    const seen = [];
    const onUpdate = (event) => seen.push(event);
    bus.on('session:update', onUpdate);
    try {
      await processSessionEvent(dbPath, {
        kind: 'update',
        provider: 'codex',
        session_id: 'model-preserved-session',
        observed_at: observed,
        delta_tokens: 1000,
        input_tokens: 200,
        cached_input_tokens: 700,
        output_tokens: 100,
        reasoning_output_tokens: 0,
      });
    } finally {
      bus.off('session:update', onUpdate);
    }

    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, 'gpt-5.3-codex-spark');
    assert.equal(seen[0].total_tokens, 1000);
    assert.equal(seen[0].input_tokens, 200);
    assert.equal(seen[0].cached_input_tokens, 700);
    assert.equal(seen[0].output_tokens, 100);
    assert.equal(seen[0].cwd, root);
    assert.equal(seen[0].repo_root, null);
    assert.equal(seen[0].repo_common_dir, null);
    assert.equal(seen[0].parent_repo, null);
    assert.equal(seen[0].branch, null);
    assert.equal(seen[0].tier, 'D');
    assert.equal(seen[0].branch_resolution_tier, 'D');
    assert.equal(seen[0].confidence, 'unattributed');
    assert.equal(typeof seen[0].started_at, 'string');
    assert.equal(typeof seen[0].last_observed_at, 'string');
    assert.equal(typeof seen[0].updated_at, 'string');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('new activity after orphan_reaped reopens the session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-reopen-reaped-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const started = '2026-05-11T01:00:00.000Z';
    const firstObserved = '2026-05-11T01:05:00.000Z';
    const reapedAt = '2026-05-11T01:05:00.000Z';
    const newObserved = '2026-05-11T01:40:00.000Z';

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'reaped-then-active',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'reaped-then-active',
      observed_at: firstObserved,
      delta_tokens: 100,
      cwd: root,
      model: 'gpt-5.4',
    });
    markSessionReaped(dbPath, 'reaped-then-active', reapedAt);

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'reaped-then-active',
      observed_at: newObserved,
      delta_tokens: 200,
      cwd: root,
      model: 'gpt-5.4',
    });

    const row = getSessionEndedState(dbPath, 'reaped-then-active');
    assert.equal(row.ended_at, null);
    assert.equal(row.end_reason, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('old activity does not reopen an orphan_reaped session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-stale-reaped-'));
  try {
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);
    const started = '2026-05-11T01:00:00.000Z';
    const reapedAt = '2026-05-11T01:40:00.000Z';
    const oldObserved = '2026-05-11T01:20:00.000Z';

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'reaped-stays-ended',
      started_at: started,
      cwd: root,
      model: 'gpt-5.4',
    });
    markSessionReaped(dbPath, 'reaped-stays-ended', reapedAt);

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 'reaped-stays-ended',
      observed_at: oldObserved,
      delta_tokens: 200,
      cwd: root,
      model: 'gpt-5.4',
    });

    const row = getSessionEndedState(dbPath, 'reaped-stays-ended');
    assert.equal(row.ended_at, reapedAt);
    assert.equal(row.end_reason, 'orphan_reaped');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('codex session file metadata recovers cwd when incremental events omit cwd', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-cwd-recovery-'));
  try {
    cp.execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    cp.execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, stdio: 'ignore' });
    cp.execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, stdio: 'ignore' });
    await fs.writeFile(path.join(root, 'README.md'), 'test\n', 'utf8');
    cp.execFileSync('git', ['add', 'README.md'], { cwd: root, stdio: 'ignore' });
    cp.execFileSync('git', ['commit', '-m', 'init'], { cwd: root, stdio: 'ignore' });
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    const sessionFile = path.join(root, 'rollout-session.jsonl');
    ensureSchema(dbPath);
    await fs.writeFile(
      sessionFile,
      JSON.stringify({
        timestamp: '2026-05-11T02:00:00.000Z',
        type: 'session_meta',
        payload: {
          cwd: root,
          model: 'gpt-5.5',
        },
      }) + '\n',
      'utf8',
    );

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: sessionFile,
      started_at: '2026-05-11T02:00:00.000Z',
      cwd: null,
      model: 'gpt-5.5',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: sessionFile,
      observed_at: '2026-05-11T02:01:00.000Z',
      delta_tokens: 100,
      cwd: null,
      model: 'gpt-5.5',
    });

    const row = getSessionAttribution(dbPath, sessionFile);
    assert.equal(row.cwd, root);
    assert.equal(row.repo_root, await fs.realpath(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('active unknown codex sessions can be backfilled from session file metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-cwd-backfill-'));
  try {
    cp.execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    const sessionFile = path.join(root, 'rollout-session.jsonl');
    ensureSchema(dbPath);
    await fs.writeFile(
      sessionFile,
      JSON.stringify({
        timestamp: '2026-05-11T02:00:00.000Z',
        type: 'session_meta',
        payload: { cwd: root, model: 'gpt-5.5' },
      }) + '\n',
      'utf8',
    );

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd,
          created_at, updated_at
        ) VALUES (
          'codex', ?, '2026-05-11T02:00:00.000Z', NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, 'D', 'unattributed', NULL,
          'gpt-5.5', 100, NULL,
          '2026-05-11T02:00:00.000Z', '2026-05-11T02:00:00.000Z'
        )
        `,
      ).run(sessionFile);
    } finally {
      db.close();
    }

    const result = await recoverActiveSessionMetadata(dbPath);

    const row = getSessionAttribution(dbPath, sessionFile);
    assert.equal(result.recovered, 1);
    assert.equal(row.cwd, root);
    assert.equal(row.repo_root, await fs.realpath(root));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('active metadata backfill does not refresh stale open sessions', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-live-cwd-stale-backfill-'));
  try {
    cp.execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    const sessionFile = path.join(root, 'rollout-session.jsonl');
    ensureSchema(dbPath);
    await fs.writeFile(
      sessionFile,
      JSON.stringify({
        timestamp: '2026-05-11T02:00:00.000Z',
        type: 'session_meta',
        payload: { cwd: root, model: 'gpt-5.5' },
      }) + '\n',
      'utf8',
    );

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(
        `
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd,
          created_at, updated_at
        ) VALUES (
          'codex', ?, '2026-05-11T01:00:00.000Z', NULL, NULL,
          NULL, NULL, NULL, NULL,
          NULL, 'D', 'unattributed', NULL,
          'gpt-5.5', 100, NULL,
          '2026-05-11T01:00:00.000Z', '2026-05-11T01:05:00.000Z'
        )
        `,
      ).run(sessionFile);
    } finally {
      db.close();
    }

    const result = await recoverActiveSessionMetadata(dbPath);
    assert.equal(result.recovered, 1);

    const reaped = reapOrphanedSessions(dbPath, {
      now: '2026-05-11T01:36:00.000Z',
      idleTimeoutMin: 30,
    });

    assert.deepEqual(reaped, { reaped: 1, scanned: 1 });
    const row = getSessionEndedState(dbPath, sessionFile);
    assert.equal(row.ended_at, '2026-05-11T01:05:00.000Z');
    assert.equal(row.end_reason, 'orphan_reaped');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
