const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');

test('processSessionEvent persists deduplicated session events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-event-ledger-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    const event = {
      kind: 'update',
      provider: 'codex',
      session_id: 's1',
      observed_at: '2026-05-11T09:00:00.000Z',
      delta_tokens: 10,
      input_tokens: 8,
      output_tokens: 2,
      conversation_count: 1,
      cwd: dir,
      model: 'gpt-5.4',
    };

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 's1',
      started_at: '2026-05-11T08:59:00.000Z',
      cwd: dir,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, event);
    await processSessionEvent(dbPath, event);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM vibedeck_session_events WHERE provider = 'codex' AND session_id = 's1'")
      .get().n;
    db.close();

    assert.equal(count, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
