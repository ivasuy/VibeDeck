const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { cmdSync } = require('../src/commands/sync');
const { ensureSchema } = require('../src/lib/db');

function buildTokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    timestamp: ts,
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: last,
        total_token_usage: total,
      },
    },
  });
}

async function readJsonl(filePath) {
  const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function readJsonFile(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

test('sync --rebuild-vibedeck-db clears stale canonical state and reparses provider logs', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, 'rollout-a.jsonl');
    const usage = {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 3,
    };
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: '2026-05-11T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    await cmdSync([]);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    const queueStatePath = path.join(trackerDir, 'queue.state.json');
    const projectQueuePath = path.join(trackerDir, 'project.queue.jsonl');
    const projectQueueStatePath = path.join(trackerDir, 'project.queue.state.json');
    ensureSchema(dbPath);

    let db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          input_tokens, cached_input_tokens, cache_creation_input_tokens,
          output_tokens, reasoning_output_tokens, cost_estimated, cost_quality,
          created_at, updated_at
        ) VALUES (
          'codex', 'stale-session', '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z', 'normal',
          NULL, NULL, NULL, NULL,
          NULL, 'D', 'unattributed', NULL,
          'gpt-5.4', 999, 9.99, '2026-05-10T00:01:00.000Z',
          900, 0, 0,
          99, 0, 0, 'stored',
          '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z'
        );

        INSERT INTO vibedeck_branch_usage_facts (
          provider, session_id, scope_key, project_state, project_key, project_ref,
          cwd, repo_root, repo_common_dir, parent_repo, branch, attribution_branch,
          branch_kind, branch_resolution_tier, confidence, model,
          first_observed_at, last_observed_at, event_count, total_tokens,
          input_tokens, cached_input_tokens, cache_creation_input_tokens,
          output_tokens, reasoning_output_tokens, conversation_count,
          total_cost_usd, cost_estimated, cost_quality, token_reconciled,
          cost_reconciled, created_at, updated_at
        ) VALUES (
          'codex', 'stale-session', 'unattributed:codex:stale-session', 'unattributed', 'Unattributed', NULL,
          NULL, NULL, NULL, NULL, 'Unattributed', NULL,
          'unattributed', 'D', 'unattributed', 'gpt-5.4',
          '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z', 1, 999,
          999, 0, 0,
          0, 0, 1,
          9.99, 0, 'stored', 0,
          1, '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z'
        );
      `);
    } finally {
      db.close();
    }
    await fs.appendFile(
      queuePath,
      `${JSON.stringify({
        source: 'cursor',
        model: 'auto',
        hour_start: '2026-05-10T00:00:00.000Z',
        input_tokens: 999,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 999,
        conversation_count: 1,
      })}\n`,
      'utf8',
    );
    await fs.appendFile(
      projectQueuePath,
      `${JSON.stringify({
        source: 'cursor',
        project_key: 'stale-project',
        hour_start: '2026-05-10T00:00:00.000Z',
        total_tokens: 999,
      })}\n`,
      'utf8',
    );
    await fs.writeFile(queueStatePath, JSON.stringify({ offset: 999 }), 'utf8');
    await fs.writeFile(projectQueueStatePath, JSON.stringify({ offset: 999 }), 'utf8');

    await cmdSync(['--rebuild-vibedeck-db']);

    db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const sessions = db
        .prepare('SELECT provider, session_id, total_tokens FROM vibedeck_sessions ORDER BY session_id')
        .all()
        .map((row) => ({
          provider: row.provider,
          session_id: row.session_id,
          total_tokens: row.total_tokens,
        }));
      const events = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_events').get();
      const facts = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts').get();
      const windows = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_branch_windows').get();
      const staleFacts = db
        .prepare("SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts WHERE session_id = 'stale-session'")
        .get();
      assert.deepEqual(sessions, [{ provider: 'codex', session_id: rolloutPath, total_tokens: 3 }]);
      assert.ok(Number(events.n) > 0);
      assert.ok(Number(facts.n) > 0);
      assert.equal(Number(windows.n), 0);
      assert.equal(Number(staleFacts.n), 0);
    } finally {
      db.close();
    }

    const queueRows = await readJsonl(queuePath);
    assert.equal(queueRows.length, 1);
    assert.equal(queueRows[0].source, 'codex');
    assert.equal(queueRows[0].total_tokens, 3);
    const projectQueueRows = await readJsonl(projectQueuePath);
    assert.ok(projectQueueRows.every((row) => row.source !== 'cursor'));
    const queueState = await readJsonFile(queueStatePath);
    const projectQueueState = await readJsonFile(projectQueueStatePath);
    assert.equal(queueState.offset, 0);
    assert.equal(projectQueueState.offset, 0);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('rebuild failure leaves live canonical DB untouched', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-safe-fail-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;

  const rolloutPath = require.resolve('../src/lib/rollout');
  const syncPath = require.resolve('../src/commands/sync');
  const originalRollout = require.cache[rolloutPath];
  const realRollout = require(rolloutPath);

  try {
    process.env.VIBEDECK_HOME = tmp;
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    const queueStatePath = path.join(trackerDir, 'queue.state.json');
    const projectQueuePath = path.join(trackerDir, 'project.queue.jsonl');
    const projectQueueStatePath = path.join(trackerDir, 'project.queue.state.json');
    await fs.mkdir(trackerDir, { recursive: true });
    ensureSchema(dbPath);
    const seedQueue = `${JSON.stringify({ source: 'cursor', total_tokens: 999 })}\n`;
    const seedQueueState = JSON.stringify({ offset: 77 });
    const seedProjectQueue = `${JSON.stringify({ source: 'cursor', project_key: 'stale-project', total_tokens: 999 })}\n`;
    const seedProjectQueueState = JSON.stringify({ offset: 88 });
    await fs.writeFile(queuePath, seedQueue, 'utf8');
    await fs.writeFile(queueStatePath, seedQueueState, 'utf8');
    await fs.writeFile(projectQueuePath, seedProjectQueue, 'utf8');
    await fs.writeFile(projectQueueStatePath, seedProjectQueueState, 'utf8');

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES (
          'codex', 'existing-session', '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z', 'normal',
          NULL, NULL, NULL, NULL,
          NULL, 'D', 'unattributed', NULL,
          'gpt-5.4', 10, 0.1, '2026-05-10T00:01:00.000Z',
          0, 'stored', '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z'
        );
      `);
    } finally {
      db.close();
    }

    require.cache[rolloutPath] = {
      id: rolloutPath,
      filename: rolloutPath,
      loaded: true,
      exports: {
        ...realRollout,
        parseRolloutIncremental: async () => {
          throw new Error('forced parser failure');
        },
      },
    };
    delete require.cache[syncPath];
    const { cmdSync: failingSync } = require(syncPath);

    await assert.rejects(() => failingSync(['--auto', '--rebuild-vibedeck-db']), /forced parser failure/);

    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const count = verifyDb.prepare('SELECT COUNT(*) AS n FROM vibedeck_sessions').get();
      const row = verifyDb.prepare('SELECT session_id FROM vibedeck_sessions').get();
      assert.equal(Number(count.n), 1);
      assert.equal(row.session_id, 'existing-session');
    } finally {
      verifyDb.close();
    }

    assert.equal(await fs.readFile(queuePath, 'utf8'), seedQueue);
    assert.equal(await fs.readFile(queueStatePath, 'utf8'), seedQueueState);
    assert.equal(await fs.readFile(projectQueuePath, 'utf8'), seedProjectQueue);
    assert.equal(await fs.readFile(projectQueueStatePath, 'utf8'), seedProjectQueueState);
  } finally {
    if (originalRollout) require.cache[rolloutPath] = originalRollout;
    else delete require.cache[rolloutPath];
    delete require.cache[syncPath];

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('rebuild promotion failure rolls back live DB and queue/state artifacts', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-promotion-fail-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;
  const originalCopyFile = fs.copyFile;

  try {
    process.env.VIBEDECK_HOME = tmp;
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, 'rollout-a.jsonl');
    const usage = {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 3,
    };
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: '2026-05-11T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    const queueStatePath = path.join(trackerDir, 'queue.state.json');
    const projectQueuePath = path.join(trackerDir, 'project.queue.jsonl');
    const projectQueueStatePath = path.join(trackerDir, 'project.queue.state.json');
    await fs.mkdir(trackerDir, { recursive: true });
    ensureSchema(dbPath);

    const seedQueue = `${JSON.stringify({ source: 'cursor', total_tokens: 999 })}\n`;
    const seedQueueState = JSON.stringify({ offset: 44 });
    const seedProjectQueue = `${JSON.stringify({ source: 'cursor', project_key: 'stale-project', total_tokens: 999 })}\n`;
    const seedProjectQueueState = JSON.stringify({ offset: 55 });
    await fs.writeFile(queuePath, seedQueue, 'utf8');
    await fs.writeFile(queueStatePath, seedQueueState, 'utf8');
    await fs.writeFile(projectQueuePath, seedProjectQueue, 'utf8');
    await fs.writeFile(projectQueueStatePath, seedProjectQueueState, 'utf8');

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES (
          'codex', 'existing-session', '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z', 'normal',
          NULL, NULL, NULL, NULL,
          NULL, 'D', 'unattributed', NULL,
          'gpt-5.4', 10, 0.1, '2026-05-10T00:01:00.000Z',
          0, 'stored', '2026-05-10T00:00:00.000Z', '2026-05-10T00:01:00.000Z'
        );
      `);
    } finally {
      db.close();
    }

    let injectedFailure = false;
    fs.copyFile = async (src, dest, ...rest) => {
      if (!injectedFailure && dest === projectQueuePath && path.basename(src) === 'project.queue.jsonl') {
        injectedFailure = true;
        throw new Error('forced promotion copy failure');
      }
      return originalCopyFile.call(fs, src, dest, ...rest);
    };

    await assert.rejects(() => cmdSync(['--rebuild-vibedeck-db']), /forced promotion copy failure/);

    const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const count = verifyDb.prepare('SELECT COUNT(*) AS n FROM vibedeck_sessions').get();
      const row = verifyDb.prepare('SELECT session_id FROM vibedeck_sessions').get();
      assert.equal(Number(count.n), 1);
      assert.equal(row.session_id, 'existing-session');
    } finally {
      verifyDb.close();
    }

    assert.equal(await fs.readFile(queuePath, 'utf8'), seedQueue);
    assert.equal(await fs.readFile(queueStatePath, 'utf8'), seedQueueState);
    assert.equal(await fs.readFile(projectQueuePath, 'utf8'), seedProjectQueue);
    assert.equal(await fs.readFile(projectQueueStatePath, 'utf8'), seedProjectQueueState);
  } finally {
    fs.copyFile = originalCopyFile;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync --rebuild-vibedeck-db fails loudly and writes diagnostics when session event processing fails', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-fail-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;

  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const syncPath = require.resolve('../src/commands/sync');
  const pipeline = require(pipelinePath);
  const originalProcessSessionEvent = pipeline.processSessionEvent;
  const originalRecoverActiveSessionMetadata = pipeline.recoverActiveSessionMetadata;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, 'rollout-a.jsonl');
    const usage = {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 3,
    };
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: '2026-05-11T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    pipeline.processSessionEvent = async () => {
      throw new Error('forced session event failure');
    };
    pipeline.recoverActiveSessionMetadata = async () => {};
    delete require.cache[syncPath];
    const { cmdSync: failingSync } = require(syncPath);

    await assert.rejects(
      () => failingSync(['--rebuild-vibedeck-db']),
      /rebuild completed with \d+ failed session event\(s\); diagnostics:/,
    );

    const diagnosticsDir = path.join(tmp, '.vibedeck', 'tracker', 'diagnostics');
    const files = await fs.readdir(diagnosticsDir);
    const failureFile = files.find((name) => name.startsWith('session-event-failures-') && name.endsWith('.jsonl'));
    assert.ok(failureFile);

    const body = await fs.readFile(path.join(diagnosticsDir, failureFile), 'utf8');
    const rows = body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(rows.length > 0);
    assert.equal(rows[0].provider, 'codex');
    assert.ok(['start', 'update', 'end'].includes(rows[0].kind));
    assert.match(rows[0].message, /forced session event failure/);
  } finally {
    pipeline.processSessionEvent = originalProcessSessionEvent;
    pipeline.recoverActiveSessionMetadata = originalRecoverActiveSessionMetadata;
    delete require.cache[syncPath];

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync --rebuild-vibedeck-db closes historical idle sessions with historical_idle_reaped reason', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-reap-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;
  const prevTimeout = process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const syncPath = require.resolve('../src/commands/sync');
  const pipeline = require(pipelinePath);
  const originalProcessSessionEvent = pipeline.processSessionEvent;
  const originalRecoverActiveSessionMetadata = pipeline.recoverActiveSessionMetadata;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');
    process.env.VIBEDECK_IDLE_TIMEOUT_MIN = '30';

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, 'rollout-historical-open.jsonl');
    const usage = {
      input_tokens: 1,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 1,
    };
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: '2026-05-11T00:01:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    pipeline.processSessionEvent = async (dbPath) => {
      const db = new DatabaseSync(dbPath);
      try {
        db.prepare(`
          INSERT INTO vibedeck_sessions (
            provider, session_id, started_at, ended_at, end_reason,
            cwd, repo_root, repo_common_dir, parent_repo,
            branch, branch_resolution_tier, confidence, override_user,
            model, total_tokens, total_cost_usd, last_observed_at,
            cost_estimated, cost_quality, created_at, updated_at
          ) VALUES (
            'codex', 'historical-open', '2026-05-11T00:00:00.000Z', NULL, NULL,
            NULL, NULL, NULL, NULL,
            NULL, 'D', 'unattributed', NULL,
            'gpt-5.4', 1, 0, '2026-05-11T00:01:00.000Z',
            0, 'stored', '2026-05-11T00:00:00.000Z', '2026-05-11T00:01:00.000Z'
          )
          ON CONFLICT(provider, session_id) DO UPDATE SET
            ended_at = excluded.ended_at,
            end_reason = excluded.end_reason,
            last_observed_at = excluded.last_observed_at,
            total_tokens = excluded.total_tokens,
            updated_at = excluded.updated_at
        `).run();
      } finally {
        db.close();
      }
    };
    pipeline.recoverActiveSessionMetadata = async () => {};
    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);

    await rebuildSync(['--rebuild-vibedeck-db']);

    const dbPath = path.join(tmp, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare('SELECT ended_at, end_reason FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
        .get('codex', 'historical-open');
      assert.ok(row);
      assert.ok(row.ended_at);
      assert.equal(row.end_reason, 'historical_idle_reaped');
    } finally {
      db.close();
    }
  } finally {
    pipeline.processSessionEvent = originalProcessSessionEvent;
    pipeline.recoverActiveSessionMetadata = originalRecoverActiveSessionMetadata;
    delete require.cache[syncPath];

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    if (prevTimeout === undefined) delete process.env.VIBEDECK_IDLE_TIMEOUT_MIN;
    else process.env.VIBEDECK_IDLE_TIMEOUT_MIN = prevTimeout;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync --rebuild-vibedeck-db skips global branch-fact rebuild when grouped session batches are used', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-no-global-branch-pass-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;

  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const branchFactsPath = require.resolve('../src/lib/sessions/branch-usage-facts');
  const syncPath = require.resolve('../src/commands/sync');
  const pipeline = require(pipelinePath);
  const branchFacts = require(branchFactsPath);
  const originalProcessSessionEventBatch = pipeline.processSessionEventBatch;
  const originalRebuildAllBranchUsageFacts = branchFacts.rebuildAllBranchUsageFacts;

  let rebuildAllCalls = 0;

  try {
    process.env.VIBEDECK_HOME = tmp;
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const rolloutPath = path.join(rolloutDir, 'rollout-a.jsonl');
    const usage = {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 3,
    };
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: '2026-05-11T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    branchFacts.rebuildAllBranchUsageFacts = async () => {
      rebuildAllCalls += 1;
      return 0;
    };
    pipeline.processSessionEventBatch = originalProcessSessionEventBatch;

    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);
    await rebuildSync(['--rebuild-vibedeck-db']);

    assert.equal(rebuildAllCalls, 0);
  } finally {
    pipeline.processSessionEventBatch = originalProcessSessionEventBatch;
    branchFacts.rebuildAllBranchUsageFacts = originalRebuildAllBranchUsageFacts;
    delete require.cache[syncPath];

    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild passes one shared branch evidence cache to grouped batches', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-shared-cache-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const syncPath = require.resolve('../src/commands/sync');
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const pipeline = require(pipelinePath);
  const originalBatch = pipeline.processSessionEventBatch;
  const seenCaches = new Set();

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await fs.mkdir(rolloutDir, { recursive: true });
    const usage = {
      input_tokens: 2,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
      total_tokens: 3,
    };
    await fs.writeFile(
      path.join(rolloutDir, 'rollout-a.jsonl'),
      `${JSON.stringify({ type: 'session_meta', payload: { cwd: tmp, model: 'gpt-5.4', git: { branch: 'main' } } })}\n${buildTokenCountLine({ ts: '2026-05-11T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    pipeline.processSessionEventBatch = async (dbPath, events, options = {}) => {
      assert.ok(options.cache, 'expected rebuild cache');
      seenCaches.add(options.cache);
      return originalBatch(dbPath, events, options);
    };

    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);
    await rebuildSync(['--auto', '--rebuild-vibedeck-db']);
    assert.equal(seenCaches.size, 1);
  } finally {
    pipeline.processSessionEventBatch = originalBatch;
    delete require.cache[syncPath];
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild recent fast path materializes recent files in one flush boundary', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-recent-fastpath-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevProfile = process.env.VIBEDECK_REBUILD_PROFILE;
  const prevFastPath = process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = '1';

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '20');
    await fs.mkdir(rolloutDir, { recursive: true });
    const now = new Date().toISOString();
    const fileCount = 12;
    let expectedTokens = 0;
    for (let i = 0; i < fileCount; i += 1) {
      const usage = {
        input_tokens: i + 2,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
        total_tokens: i + 3,
      };
      expectedTokens += usage.total_tokens;
      await fs.writeFile(
        path.join(rolloutDir, `rollout-${String(i).padStart(2, '0')}.jsonl`),
        `${buildTokenCountLine({ ts: now, last: usage, total: usage })}\n`,
        'utf8',
      );
    }

    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const profile = await readJsonFile(path.join(trackerDir, 'rebuild_profile.json'));
    const recentFlush = profile.stages.find((stage) => stage.name === 'recent_lane_session_event_flush');
    assert.ok(recentFlush);
    assert.equal(recentFlush.counters.flush_count, 1);
    assert.equal(recentFlush.counters.recent_session_events_flushed, fileCount * 3);

    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
      const sessions = db.prepare('SELECT COUNT(*) AS n, SUM(total_tokens) AS tokens FROM vibedeck_sessions').get();
      const events = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_events').get();
      const facts = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts').get();
      assert.equal(Number(sessions.n), fileCount);
      assert.equal(Number(sessions.tokens), expectedTokens);
      assert.equal(Number(events.n), fileCount * 3);
      assert.equal(Number(facts.n), fileCount);
    } finally {
      db.close();
    }
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevProfile === undefined) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = prevProfile;
    if (prevFastPath === undefined) delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    else process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = prevFastPath;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild fast path keeps recent groups pending when a historical file completes next', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-lane-aware-flush-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevProfile = process.env.VIBEDECK_REBUILD_PROFILE;
  const prevFastPath = process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
  const prevFlushSliceEvents = process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const syncPath = require.resolve('../src/commands/sync');
  const pipeline = require(pipelinePath);
  const originalBatch = pipeline.processSessionEventBatch;
  const flushedOrder = [];

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = '1';
    process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = '3';

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '20');
    await fs.mkdir(rolloutDir, { recursive: true });
    const recentPath = path.join(rolloutDir, 'rollout-a-recent.jsonl');
    const historicalPath = path.join(rolloutDir, 'rollout-z-historical.jsonl');
    const recentUsage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };
    const historicalUsage = {
      input_tokens: 4,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 6,
    };
    const recentIso = new Date().toISOString();
    const historicalIso = '2024-01-01T00:00:00.000Z';

    await fs.writeFile(
      recentPath,
      `${buildTokenCountLine({ ts: recentIso, last: recentUsage, total: recentUsage })}\n`,
      'utf8',
    );
    await fs.writeFile(
      historicalPath,
      `${buildTokenCountLine({ ts: historicalIso, last: historicalUsage, total: historicalUsage })}\n`,
      'utf8',
    );
    const oldDate = new Date('2024-01-01T00:00:00.000Z');
    await fs.utimes(historicalPath, oldDate, oldDate);

    pipeline.processSessionEventBatch = async (dbPath, events, options = {}) => {
      flushedOrder.push(path.basename(events[0].session_id));
      return originalBatch(dbPath, events, options);
    };
    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);
    await rebuildSync(['--auto', '--rebuild-vibedeck-db']);

    assert.deepEqual(flushedOrder, ['rollout-z-historical.jsonl', 'rollout-a-recent.jsonl']);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
      const events = Number(db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_events').get().n);
      const facts = Number(db.prepare('SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts').get().n);
      const windows = Number(db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_branch_windows').get().n);
      assert.equal(events, 6);
      assert.equal(facts, 2);
      assert.equal(windows, 0);
    } finally {
      db.close();
    }
  } finally {
    pipeline.processSessionEventBatch = originalBatch;
    delete require.cache[syncPath];
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevProfile === undefined) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = prevProfile;
    if (prevFastPath === undefined) delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    else process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = prevFastPath;
    if (prevFlushSliceEvents === undefined) delete process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;
    else process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = prevFlushSliceEvents;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild flush slice events batches historical file completions by threshold', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-flush-slice-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevProfile = process.env.VIBEDECK_REBUILD_PROFILE;
  const prevFastPath = process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
  const prevFlushSliceEvents = process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = '1';
    process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = '6';

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '20');
    await fs.mkdir(rolloutDir, { recursive: true });
    const historicalIso = '2024-01-01T00:00:00.000Z';
    const recentIso = new Date().toISOString();
    const historicalUsage = {
      input_tokens: 4,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 6,
    };
    const recentUsage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };

    for (let i = 0; i < 3; i += 1) {
      const filePath = path.join(rolloutDir, `rollout-${String(i).padStart(2, '0')}-historical.jsonl`);
      await fs.writeFile(
        filePath,
        `${buildTokenCountLine({ ts: historicalIso, last: historicalUsage, total: historicalUsage })}\n`,
        'utf8',
      );
      const oldDate = new Date('2024-01-01T00:00:00.000Z');
      await fs.utimes(filePath, oldDate, oldDate);
    }
    await fs.writeFile(
      path.join(rolloutDir, 'rollout-99-recent.jsonl'),
      `${buildTokenCountLine({ ts: recentIso, last: recentUsage, total: recentUsage })}\n`,
      'utf8',
    );

    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const profile = await readJsonFile(path.join(trackerDir, 'rebuild_profile.json'));
    const recentFlush = profile.stages.find((stage) => stage.name === 'recent_lane_session_event_flush');
    assert.ok(recentFlush);
    assert.equal(recentFlush.counters.flush_count, 2);
    assert.equal(recentFlush.counters.slice_threshold_flush_count, 1);
    assert.equal(recentFlush.counters.historical_slice_threshold_flush_count, 1);
    assert.equal(recentFlush.counters.historical_session_events_flushed, 9);
    assert.equal(recentFlush.counters.recent_session_events_flushed, 3);

    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
      const sessions = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_sessions').get();
      const events = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_events').get();
      const facts = db.prepare('SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts').get();
      assert.equal(Number(sessions.n), 4);
      assert.equal(Number(events.n), 12);
      assert.equal(Number(facts.n), 4);
    } finally {
      db.close();
    }
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevProfile === undefined) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = prevProfile;
    if (prevFastPath === undefined) delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    else process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = prevFastPath;
    if (prevFlushSliceEvents === undefined) delete process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;
    else process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = prevFlushSliceEvents;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('grouped rebuild processor can flush batches before final drain', async () => {
  const { createGroupedSessionEventProcessor } = require('../src/commands/sync');
  const batches = [];
  const processor = createGroupedSessionEventProcessor(async (events) => {
    batches.push(events.map((event) => event.session_id));
  });

  await processor.onSessionEvent({ provider: 'codex', session_id: 's1', kind: 'start' });
  await processor.onSessionEvent({ provider: 'codex', session_id: 's1', kind: 'update' });
  assert.equal(processor.total, 2);
  assert.equal(processor.processed, 0);

  await processor.flush();
  assert.deepEqual(batches, [['s1', 's1']]);
  assert.equal(processor.processed, 2);

  await processor.onSessionEvent({ provider: 'codex', session_id: 's2', kind: 'start' });
  const drain = await processor.drain();
  assert.deepEqual(batches, [['s1', 's1'], ['s2']]);
  assert.equal(drain.processed, 3);
  assert.equal(drain.total, 3);
});

test('sync --rebuild-vibedeck-db batches many events for one session into one rich-fact rebuild shape', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-batch-shape-unit-'));
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const branchFactsPath = require.resolve('../src/lib/sessions/branch-usage-facts');
  const branchFacts = require(branchFactsPath);
  const originalRebuildBranchUsageFactsForSession = branchFacts.rebuildBranchUsageFactsForSession;
  delete require.cache[pipelinePath];
  let processSessionEventBatch = null;
  let rebuildCalls = 0;
  const updateCount = 1000;

  try {
    branchFacts.rebuildBranchUsageFactsForSession = async (...args) => {
      rebuildCalls += 1;
      return originalRebuildBranchUsageFactsForSession(...args);
    };
    ({ processSessionEventBatch } = require(pipelinePath));

    const dbPath = path.join(tmp, 'vibedeck.sqlite3');
    const repoRoot = path.join(tmp, 'repo');
    await fs.mkdir(repoRoot, { recursive: true });
    execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' });
    ensureSchema(dbPath);
    const events = [
      {
        kind: 'start',
        provider: 'codex',
        session_id: 'many',
        started_at: '2026-05-10T00:00:00.000Z',
        cwd: repoRoot,
        model: 'gpt-5.4',
        branch: 'main',
      },
    ];
    for (let i = 0; i < updateCount; i += 1) {
      events.push({
        kind: 'update',
        provider: 'codex',
        session_id: 'many',
        observed_at: new Date(Date.UTC(2026, 4, 10, 0, 0, i)).toISOString(),
        cwd: repoRoot,
        model: 'gpt-5.4',
        branch: 'main',
        delta_tokens: 1,
        input_tokens: 1,
        output_tokens: 0,
      });
    }
    events.push({
      kind: 'end',
      provider: 'codex',
      session_id: 'many',
      ended_at: '2026-05-10T00:20:00.000Z',
      cwd: repoRoot,
      model: 'gpt-5.4',
      branch: 'main',
      total_tokens: updateCount,
      end_reason: 'log_complete',
    });

    await processSessionEventBatch(dbPath, events);
    assert.equal(rebuildCalls, 1);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const session = db
        .prepare('SELECT total_tokens, model, branch FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
        .get('codex', 'many');
      assert.ok(session);
      assert.equal(session.total_tokens, updateCount);
      assert.equal(session.model, 'gpt-5.4');
      assert.ok(session.branch === null || typeof session.branch === 'string');

      const events = db
        .prepare('SELECT COUNT(*) AS n FROM vibedeck_session_events WHERE provider = ? AND session_id = ?')
        .get('codex', 'many');
      assert.ok(events);
      assert.equal(events.n, updateCount + 2);

      const fact = db
        .prepare('SELECT total_tokens, model, branch, branch_resolution_tier FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?')
        .get('codex', 'many');
      assert.ok(fact);
      assert.equal(fact.total_tokens, updateCount);
      assert.equal(fact.model, 'gpt-5.4');
      assert.equal(fact.branch, 'main');
      assert.ok(typeof fact.branch_resolution_tier === 'string' && fact.branch_resolution_tier.length > 0);
    } finally {
      db.close();
    }
  } finally {
    branchFacts.rebuildBranchUsageFactsForSession = originalRebuildBranchUsageFactsForSession;
    delete require.cache[pipelinePath];
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild dirty post-drain scopes repair and branch-fact rebuild to drained sessions under flag', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-dirty-post-drain-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevProfile = process.env.VIBEDECK_REBUILD_PROFILE;
  const prevDirtyPostDrain = process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;
  const syncPath = require.resolve('../src/commands/sync');
  const branchFactsPath = require.resolve('../src/lib/sessions/branch-usage-facts');
  const branchFacts = require(branchFactsPath);
  const originalRepairMissingProjectAttribution = branchFacts.repairMissingProjectAttribution;
  const originalRebuildAllBranchUsageFacts = branchFacts.rebuildAllBranchUsageFacts;
  const repairScopes = [];
  const branchScopes = [];

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = '1';

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '20');
    await fs.mkdir(rolloutDir, { recursive: true });
    const usage = {
      input_tokens: 4,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 6,
    };
    const rolloutPath = path.join(rolloutDir, 'rollout-dirty.jsonl');
    await fs.writeFile(
      rolloutPath,
      `${buildTokenCountLine({ ts: new Date().toISOString(), last: usage, total: usage })}\n`,
      'utf8',
    );

    branchFacts.repairMissingProjectAttribution = async (dbPath, options = {}) => {
      repairScopes.push(options.sessions);
      return originalRepairMissingProjectAttribution(dbPath, options);
    };
    branchFacts.rebuildAllBranchUsageFacts = async (dbPath, options = {}) => {
      branchScopes.push(options.sessions);
      return originalRebuildAllBranchUsageFacts(dbPath, options);
    };

    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);
    await rebuildSync(['--auto', '--rebuild-vibedeck-db']);

    assert.deepEqual(repairScopes, [[{ provider: 'codex', session_id: rolloutPath }]]);
    assert.deepEqual(branchScopes, [[{ provider: 'codex', session_id: rolloutPath }]]);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const profile = await readJsonFile(path.join(trackerDir, 'rebuild_profile.json'));
    assert.equal(profile.counters.branch_facts_rebuilt_by_scope.dirty, 1);
  } finally {
    branchFacts.repairMissingProjectAttribution = originalRepairMissingProjectAttribution;
    branchFacts.rebuildAllBranchUsageFacts = originalRebuildAllBranchUsageFacts;
    delete require.cache[syncPath];
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevProfile === undefined) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = prevProfile;
    if (prevDirtyPostDrain === undefined) delete process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;
    else process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = prevDirtyPostDrain;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync rebuild dirty post-drain falls back to full branch rebuild when dirty scope is unavailable', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-dirty-post-drain-fallback-'));
  const prevHome = process.env.HOME;
  const prevVibedeckHome = process.env.VIBEDECK_HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevProfile = process.env.VIBEDECK_REBUILD_PROFILE;
  const prevDirtyPostDrain = process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;
  const syncPath = require.resolve('../src/commands/sync');
  const branchFactsPath = require.resolve('../src/lib/sessions/branch-usage-facts');
  const branchFacts = require(branchFactsPath);
  const originalRepairMissingProjectAttribution = branchFacts.repairMissingProjectAttribution;
  const originalRebuildAllBranchUsageFacts = branchFacts.rebuildAllBranchUsageFacts;
  const repairScopes = [];
  const branchScopes = [];

  try {
    process.env.HOME = tmp;
    process.env.VIBEDECK_HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = '1';
    await fs.mkdir(process.env.CODEX_HOME, { recursive: true });

    branchFacts.repairMissingProjectAttribution = async (dbPath, options = {}) => {
      repairScopes.push(options.sessions);
      return originalRepairMissingProjectAttribution(dbPath, options);
    };
    branchFacts.rebuildAllBranchUsageFacts = async (dbPath, options = {}) => {
      branchScopes.push(options.sessions);
      return originalRebuildAllBranchUsageFacts(dbPath, options);
    };

    delete require.cache[syncPath];
    const { cmdSync: rebuildSync } = require(syncPath);
    await rebuildSync(['--auto', '--rebuild-vibedeck-db']);

    assert.deepEqual(repairScopes, [undefined]);
    assert.deepEqual(branchScopes, [undefined]);

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const profile = await readJsonFile(path.join(trackerDir, 'rebuild_profile.json'));
    assert.equal(profile.counters.branch_facts_rebuilt_by_scope.full, 0);
  } finally {
    branchFacts.repairMissingProjectAttribution = originalRepairMissingProjectAttribution;
    branchFacts.rebuildAllBranchUsageFacts = originalRebuildAllBranchUsageFacts;
    delete require.cache[syncPath];
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevVibedeckHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevVibedeckHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevProfile === undefined) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = prevProfile;
    if (prevDirtyPostDrain === undefined) delete process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;
    else process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = prevDirtyPostDrain;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('sync --rebuild-vibedeck-db clears stale checkpoint match and link rows before backfill', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-rebuild-entire-reset-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    await fs.mkdir(trackerDir, { recursive: true });
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES (
          'codex', 'old-session', '2026-05-12T00:00:00.000Z', '2026-05-12T00:05:00.000Z', 'normal',
          '/repo/stale', '/repo/stale', '/repo/stale/.git', NULL,
          'main', 'A', 'high', NULL,
          'gpt-5.5', 100, 1.25, '2026-05-12T00:05:00.000Z',
          0, 'stored', '2026-05-12T00:00:00.000Z', '2026-05-12T00:05:00.000Z'
        );

        INSERT INTO vibedeck_session_entire_links (
          provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
        ) VALUES ('codex', 'old-session', 'entire-old', '["deadbeef0001"]', 'high');

        INSERT INTO vibedeck_entire_checkpoint_matches (
          repo_root, checkpoint_group_id, checkpoint_id, metadata_path, checkpoint_tip,
          entire_session_id, agent, provider, model, branch, started_at, ended_at,
          session_provider, session_id, match_status, match_confidence, reason, candidate_count,
          created_at, updated_at
        ) VALUES (
          '/repo/stale', 'de/adbeef0001', 'deadbeef0001', 'de/adbeef0001/metadata.json', 'oldtip',
          'entire-old', 'codex', 'codex', 'gpt-5.5', 'main', '2026-05-12T00:00:00.000Z', '2026-05-12T00:05:00.000Z',
          'codex', 'old-session', 'linked', 'exact', NULL, 1,
          '2026-05-12T00:00:00.000Z', '2026-05-12T00:00:00.000Z'
        );
      `);
    } finally {
      db.close();
    }

    await cmdSync(['--rebuild-vibedeck-db']);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const links = readDb.prepare('SELECT COUNT(*) AS n FROM vibedeck_session_entire_links').get();
      const matches = readDb.prepare('SELECT COUNT(*) AS n FROM vibedeck_entire_checkpoint_matches').get();
      assert.equal(Number(links.n), 0);
      assert.equal(Number(matches.n), 0);
    } finally {
      readDb.close();
    }
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevCodeHome === undefined) delete process.env.CODE_HOME;
    else process.env.CODE_HOME = prevCodeHome;
    if (prevGeminiHome === undefined) delete process.env.GEMINI_HOME;
    else process.env.GEMINI_HOME = prevGeminiHome;
    if (prevOpencodeHome === undefined) delete process.env.OPENCODE_HOME;
    else process.env.OPENCODE_HOME = prevOpencodeHome;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
