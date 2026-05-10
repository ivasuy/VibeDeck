const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');

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

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db
      .prepare('SELECT ended_at FROM vibedeck_sessions WHERE session_id = ?')
      .get('current-session');
    db.close();

    assert.equal(row.ended_at, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
