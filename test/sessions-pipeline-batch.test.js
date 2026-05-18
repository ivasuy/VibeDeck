const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEventBatch } = require('../src/lib/sessions/pipeline');

function getRow(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

test('processSessionEventBatch preserves session, event, bucket, and branch facts', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-session-batch-'));
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repo, stdio: 'ignore' });
    await fs.writeFile(path.join(repo, 'README.md'), 'batch test\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    await processSessionEventBatch(dbPath, [
      {
        kind: 'start',
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-10T00:00:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
      },
      {
        kind: 'update',
        provider: 'codex',
        session_id: 's1',
        observed_at: '2026-05-10T00:05:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 10,
        input_tokens: 7,
        output_tokens: 3,
        conversation_count: 1,
      },
      {
        kind: 'update',
        provider: 'codex',
        session_id: 's1',
        observed_at: '2026-05-10T00:35:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 20,
        input_tokens: 12,
        output_tokens: 8,
        conversation_count: 1,
      },
      {
        kind: 'end',
        provider: 'codex',
        session_id: 's1',
        ended_at: '2026-05-10T00:40:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        total_tokens: 30,
        end_reason: 'log_complete',
      },
    ]);

    const session = getRow(
      dbPath,
      'SELECT total_tokens, branch FROM vibedeck_sessions WHERE provider = ? AND session_id = ?',
      'codex',
      's1',
    );
    assert.equal(session.total_tokens, 30);
    assert.equal(session.branch, 'main');

    const eventCount = getRow(
      dbPath,
      'SELECT COUNT(*) AS n FROM vibedeck_session_events WHERE provider = ? AND session_id = ?',
      'codex',
      's1',
    );
    assert.equal(eventCount.n, 4);

    const bucketCount = getRow(
      dbPath,
      'SELECT COUNT(*) AS n FROM vibedeck_session_buckets WHERE provider = ? AND session_id = ?',
      'codex',
      's1',
    );
    assert.equal(bucketCount.n, 2);

    const branchFact = getRow(
      dbPath,
      'SELECT branch, attribution_branch, total_tokens FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ? LIMIT 1',
      'codex',
      's1',
    );
    assert.equal(branchFact.branch, 'main');
    assert.equal(branchFact.attribution_branch, 'main');
    assert.equal(branchFact.total_tokens, 30);

    const branchWindows = getRow(
      dbPath,
      'SELECT COUNT(*) AS n FROM vibedeck_session_branch_windows WHERE provider = ? AND session_id = ?',
      'codex',
      's1',
    );
    assert.equal(branchWindows.n, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
