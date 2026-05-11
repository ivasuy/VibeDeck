const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');

test('session updates populate vibedeck_session_buckets and stored session cost', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-bucket-facts-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 's1',
      started_at: '2026-05-11T09:00:00.000Z',
      cwd: dir,
      model: 'gpt-5.4',
    });

    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 's1',
      observed_at: '2026-05-11T09:01:00.000Z',
      delta_tokens: 110,
      input_tokens: 100,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 10,
      reasoning_output_tokens: 0,
      conversation_count: 1,
      cwd: dir,
      model: 'gpt-5.4',
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const bucket = db
      .prepare("SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality FROM vibedeck_session_buckets WHERE provider = 'codex' AND session_id = 's1'")
      .get();
    const session = db
      .prepare("SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality FROM vibedeck_sessions WHERE provider = 'codex' AND session_id = 's1'")
      .get();
    db.close();

    assert.equal(bucket.total_tokens, 110);
    assert.ok(bucket.total_cost_usd > 0);
    assert.equal(session.total_tokens, 110);
    assert.ok(session.total_cost_usd > 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
