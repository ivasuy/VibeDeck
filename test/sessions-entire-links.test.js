const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-entire-links-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath };
}

test('processSessionEvent persists Tier A entire checkpoint links', async () => {
  const { dir, dbPath } = tmpDb();
  const resolveBranchPath = require.resolve('../src/lib/sessions/resolve-branch');
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const resolveBranch = require(resolveBranchPath);
  const originalResolver = resolveBranch.resolveBranchForSession;
  resolveBranch.resolveBranchForSession = async () => ({
    branch: 'main',
    tier: 'A',
    confidence: 'high',
    entire_link: 'entire-session-1',
    checkpoint_ids: ['e2abdc1ec6'],
  });
  delete require.cache[pipelinePath];
  const { processSessionEvent } = require('../src/lib/sessions/pipeline');

  try {
    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'session-1',
      started_at: '2026-05-12T01:00:00.000Z',
      cwd: '/repo/VibeDeck',
      model: 'gpt-5.5',
      total_tokens: 100,
    });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare(
      `
      SELECT provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
      FROM vibedeck_session_entire_links
      WHERE provider = ? AND session_id = ?
      `,
    ).get('codex', 'session-1');
    db.close();

    assert.ok(row);
    assert.equal(row.provider, 'codex');
    assert.equal(row.session_id, 'session-1');
    assert.equal(row.entire_session_id, 'entire-session-1');
    assert.equal(row.match_confidence, 'high');
    assert.equal(row.entire_checkpoint_ids, JSON.stringify(['e2abdc1ec6']));
  } finally {
    resolveBranch.resolveBranchForSession = originalResolver;
    delete require.cache[pipelinePath];
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
