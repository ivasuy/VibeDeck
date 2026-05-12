const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
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
      assert.deepEqual(sessions, [{ provider: 'codex', session_id: rolloutPath, total_tokens: 3 }]);
      assert.ok(Number(events.n) > 0);
    } finally {
      db.close();
    }

    const queueRows = await readJsonl(queuePath);
    assert.equal(queueRows.length, 1);
    assert.equal(queueRows[0].source, 'codex');
    assert.equal(queueRows[0].total_tokens, 3);
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
