const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { getLiveBus } = require('../src/lib/sessions/live-bus');
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

test('processSessionEventBatch uses event branch evidence without provider-log fallback', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-session-batch-no-reread-'));
  const providerBranchPath = require.resolve('../src/lib/sessions/provider-branch');
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const providerBranch = require(providerBranchPath);
  const originalRead = providerBranch.readProviderBranchFromSessionFile;
  delete require.cache[pipelinePath];

  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repo, stdio: 'ignore' });
    await fs.writeFile(path.join(repo, 'README.md'), 'branch evidence\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });

    const sessionFile = path.join(root, 'session.jsonl');
    await fs.writeFile(sessionFile, '{"payload":{"git":{"branch":"main"}}}\n', 'utf8');
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    let fallbackReads = 0;
    providerBranch.readProviderBranchFromSessionFile = (...args) => {
      fallbackReads += 1;
      return originalRead(...args);
    };

    const { processSessionEventBatch: freshBatch } = require(pipelinePath);
    await freshBatch(dbPath, [
      {
        kind: 'start',
        provider: 'codex',
        session_id: sessionFile,
        started_at: '2026-05-10T00:00:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
      },
      {
        kind: 'update',
        provider: 'codex',
        session_id: sessionFile,
        observed_at: '2026-05-10T00:01:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 7,
        input_tokens: 5,
        output_tokens: 2,
      },
      {
        kind: 'end',
        provider: 'codex',
        session_id: sessionFile,
        ended_at: '2026-05-10T00:02:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        total_tokens: 7,
        end_reason: 'log_complete',
      },
    ], { cache: {} });

    assert.equal(fallbackReads, 0);
  } finally {
    providerBranch.readProviderBranchFromSessionFile = originalRead;
    delete require.cache[pipelinePath];
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('processSessionEventBatch returns hot-path counters and emits latest batch metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-session-batch-summary-'));
  const bus = getLiveBus();
  const seen = [];
  const onStart = (event) => seen.push({ type: 'session:start', event });
  const onUpdate = (event) => seen.push({ type: 'session:update', event });
  const onEnd = (event) => seen.push({ type: 'session:end', event });
  bus.on('session:start', onStart);
  bus.on('session:update', onUpdate);
  bus.on('session:end', onEnd);

  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repo, stdio: 'ignore' });
    await fs.writeFile(path.join(repo, 'README.md'), 'batch summary\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
    const expectedRepoRoot = await fs.realpath(repo);
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    const summary = await processSessionEventBatch(dbPath, [
      {
        kind: 'start',
        provider: 'codex',
        session_id: 'summary-session',
        started_at: '2026-05-10T00:00:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
      },
      {
        kind: 'update',
        provider: 'codex',
        session_id: 'summary-session',
        observed_at: '2026-05-10T00:05:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 11,
        input_tokens: 7,
        output_tokens: 4,
      },
      {
        kind: 'end',
        provider: 'codex',
        session_id: 'summary-session',
        ended_at: '2026-05-10T00:06:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        total_tokens: 11,
        end_reason: 'log_complete',
      },
    ]);

    assert.deepEqual(summary, {
      events_processed: 3,
      groups_processed: 1,
      branch_resolution_count: 1,
      existing_repo_reused_count: 0,
    });
    assert.equal(seen.length, 3);
    assert.deepEqual(
      seen.map((entry) => entry.type),
      ['session:start', 'session:update', 'session:end'],
    );
    assert.ok(seen.every(({ event }) => event.total_tokens === 11));
    assert.ok(seen.every(({ event }) => event.branch === 'main'));
    assert.ok(seen.every(({ event }) => event.repo_root === expectedRepoRoot));
    assert.ok(seen.every(({ event }) => event.last_observed_at === '2026-05-10T00:05:00.000Z'));
  } finally {
    bus.off('session:start', onStart);
    bus.off('session:update', onUpdate);
    bus.off('session:end', onEnd);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('processSessionEventBatch counts existing repo metadata reuse when cwd is unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-session-batch-repo-reuse-'));
  try {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repo, stdio: 'ignore' });
    await fs.writeFile(path.join(repo, 'README.md'), 'repo reuse\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    ensureSchema(dbPath);

    await processSessionEventBatch(dbPath, [
      {
        kind: 'start',
        provider: 'codex',
        session_id: 'repo-reuse-session',
        started_at: '2026-05-10T00:00:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
      },
    ]);

    const summary = await processSessionEventBatch(dbPath, [
      {
        kind: 'update',
        provider: 'codex',
        session_id: 'repo-reuse-session',
        observed_at: '2026-05-10T00:05:00.000Z',
        cwd: repo,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 3,
        input_tokens: 2,
        output_tokens: 1,
      },
    ]);

    assert.equal(summary.existing_repo_reused_count, 1);
    assert.equal(summary.events_processed, 1);
    assert.equal(summary.groups_processed, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
