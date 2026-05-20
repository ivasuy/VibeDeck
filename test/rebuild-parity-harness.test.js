const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { cmdSync } = require('../src/commands/sync');

function tokenCountLine({ ts, last, total }) {
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

function sessionMetaLine({ cwd, branch }) {
  return JSON.stringify({
    type: 'session_meta',
    payload: {
      cwd,
      model: 'gpt-5.4',
      git: { branch },
    },
  });
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeSessionFile(filePath, body, mtime) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}\n`, 'utf8');
  await fs.utimes(filePath, mtime, mtime);
}

function initGitRepo(repoRoot) {
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-B', 'main'], { cwd: repoRoot, stdio: 'ignore' });
}

async function createParityCorpus(root) {
  const codexHome = path.join(root, '.codex');
  const repoRoot = path.join(root, 'workspace', 'slice-parity');
  await fs.mkdir(repoRoot, { recursive: true });
  initGitRepo(repoRoot);
  const recentDate = new Date();
  const historicalDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const recentDir = path.join(codexHome, 'sessions', '2026', '05', '20');
  const historicalDir = path.join(codexHome, 'sessions', '2026', '04', '20');
  const recentTs = recentDate.toISOString();
  const historicalTs = historicalDate.toISOString();
  const usages = [
    {
      input_tokens: 5,
      cached_input_tokens: 1,
      cache_creation_input_tokens: 0,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 8,
    },
    {
      input_tokens: 7,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 1,
      output_tokens: 3,
      reasoning_output_tokens: 0,
      total_tokens: 11,
    },
    {
      input_tokens: 13,
      cached_input_tokens: 2,
      cache_creation_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 1,
      total_tokens: 21,
    },
  ];

  await writeSessionFile(
    path.join(recentDir, 'rollout-recent.jsonl'),
    [
      sessionMetaLine({ cwd: repoRoot, branch: 'main' }),
      tokenCountLine({ ts: recentTs, last: usages[0], total: usages[0] }),
    ].join('\n'),
    recentDate,
  );
  await writeSessionFile(
    path.join(historicalDir, 'rollout-historical-a.jsonl'),
    [
      sessionMetaLine({ cwd: repoRoot, branch: 'main' }),
      tokenCountLine({ ts: historicalTs, last: usages[1], total: usages[1] }),
    ].join('\n'),
    historicalDate,
  );
  await writeSessionFile(
    path.join(historicalDir, 'rollout-historical-b.jsonl'),
    [
      sessionMetaLine({ cwd: repoRoot, branch: 'main' }),
      tokenCountLine({ ts: historicalTs, last: usages[2], total: usages[2] }),
    ].join('\n'),
    historicalDate,
  );
  return codexHome;
}

async function runRebuild({ fastPath, flushSliceEvents = null }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), fastPath ? 'vd-rebuild-fast-' : 'vd-rebuild-base-'));
  const previous = {
    HOME: process.env.HOME,
    VIBEDECK_HOME: process.env.VIBEDECK_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CODE_HOME: process.env.CODE_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    OPENCODE_HOME: process.env.OPENCODE_HOME,
    VIBEDECK_REBUILD_PROFILE: process.env.VIBEDECK_REBUILD_PROFILE,
    VIBEDECK_REBUILD_RECENT_FASTPATH: process.env.VIBEDECK_REBUILD_RECENT_FASTPATH,
    VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS: process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS,
  };

  try {
    const codexHome = await createParityCorpus(root);
    process.env.HOME = root;
    process.env.VIBEDECK_HOME = root;
    process.env.CODEX_HOME = codexHome;
    process.env.CODE_HOME = path.join(root, '.code');
    process.env.GEMINI_HOME = path.join(root, '.gemini');
    process.env.OPENCODE_HOME = path.join(root, '.opencode');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    if (fastPath) process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = '1';
    else delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    if (flushSliceEvents == null) delete process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;
    else process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = String(flushSliceEvents);

    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const trackerDir = path.join(root, '.vibedeck', 'tracker');
    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
      const summary = {
        sessions: db
          .prepare(
            `
            SELECT provider, session_id, model, total_tokens, input_tokens,
                   cached_input_tokens, cache_creation_input_tokens, output_tokens,
                   reasoning_output_tokens, cost_quality
            FROM vibedeck_sessions
            ORDER BY provider, session_id
            `,
          )
          .all()
          .map(normalizeSessionPathRow),
        sessionEvents: db
          .prepare('SELECT provider, session_id, kind, delta_tokens FROM vibedeck_session_events ORDER BY provider, session_id, event_key')
          .all()
          .map(normalizeSessionPathRow),
        branchFacts: db
          .prepare(
            `
            SELECT provider, session_id, branch, branch_kind, branch_resolution_tier,
                   confidence, total_tokens, input_tokens, cached_input_tokens,
                   cache_creation_input_tokens, output_tokens, reasoning_output_tokens
            FROM vibedeck_branch_usage_facts
            ORDER BY provider, session_id, scope_key
            `,
          )
          .all()
          .map(normalizeSessionPathRow),
        branchWindows: db
          .prepare('SELECT provider, session_id, branch, window_start, window_end FROM vibedeck_session_branch_windows ORDER BY provider, session_id, window_start')
          .all()
          .map(normalizeSessionPathRow),
        totals: readTotals(db),
        unknownBuckets: readUnknownBuckets(db),
      };
      const profile = await readJson(path.join(trackerDir, 'rebuild_profile.json'));
      summary.recentFlush = profile.stages.find((stage) => stage.name === 'recent_lane_session_event_flush')?.counters || {};
      return summary;
    } finally {
      db.close();
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

function readTotals(db) {
  const sessions = db
    .prepare(
      `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(total_tokens), 0) AS total_tokens,
             COALESCE(SUM(input_tokens), 0) AS input_tokens,
             COALESCE(SUM(cached_input_tokens), 0) AS cached_input_tokens,
             COALESCE(SUM(cache_creation_input_tokens), 0) AS cache_creation_input_tokens,
             COALESCE(SUM(output_tokens), 0) AS output_tokens,
             COALESCE(SUM(reasoning_output_tokens), 0) AS reasoning_output_tokens
      FROM vibedeck_sessions
      `,
    )
    .get();
  const sessionEvents = db
    .prepare(
      `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(delta_tokens), 0) AS delta_tokens
      FROM vibedeck_session_events
      `,
    )
    .get();
  const branchFacts = db
    .prepare(
      `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM vibedeck_branch_usage_facts
      `,
    )
    .get();
  const branchWindows = db
    .prepare(
      `
      SELECT COUNT(*) AS count,
             COALESCE(SUM(prorated_tokens), 0) AS prorated_tokens
      FROM vibedeck_session_branch_windows
      `,
    )
    .get();
  return { sessions, sessionEvents, branchFacts, branchWindows };
}

function readUnknownBuckets(db) {
  return db
    .prepare(
      `
      SELECT branch, branch_kind, COUNT(*) AS count, COALESCE(SUM(total_tokens), 0) AS total_tokens
      FROM vibedeck_branch_usage_facts
      WHERE branch IN ('Unknown branch', 'Historical unknown')
         OR branch_kind IN ('unknown_git', 'historical_unknown')
      GROUP BY branch, branch_kind
      ORDER BY branch, branch_kind
      `,
    )
    .all();
}

function normalizeSessionPathRow(row) {
  if (!row || typeof row.session_id !== 'string') return row;
  return {
    ...row,
    session_id: path.basename(row.session_id),
  };
}

test('recent fast path preserves rebuild canonical parity while reducing flush boundaries', async () => {
  const baseline = await runRebuild({ fastPath: false });
  const fastPath = await runRebuild({ fastPath: true });
  const sliceBatch = await runRebuild({ fastPath: true, flushSliceEvents: 1 });

  assert.deepEqual(fastPath.sessions, baseline.sessions);
  assert.deepEqual(fastPath.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(fastPath.branchFacts, baseline.branchFacts);
  assert.deepEqual(fastPath.branchWindows, baseline.branchWindows);
  assert.deepEqual(fastPath.totals, baseline.totals);
  assert.deepEqual(fastPath.unknownBuckets, baseline.unknownBuckets);
  assert.deepEqual(sliceBatch.sessions, fastPath.sessions);
  assert.deepEqual(sliceBatch.sessionEvents, fastPath.sessionEvents);
  assert.deepEqual(sliceBatch.branchFacts, fastPath.branchFacts);
  assert.deepEqual(sliceBatch.branchWindows, fastPath.branchWindows);
  assert.deepEqual(sliceBatch.totals, fastPath.totals);
  assert.deepEqual(sliceBatch.unknownBuckets, fastPath.unknownBuckets);
  assert.ok(sliceBatch.recentFlush.slice_threshold_flush_count > 0);
  assert.equal(fastPath.recentFlush.flush_count, 1);
  assert.ok(
    !Number.isFinite(baseline.recentFlush.flush_count) ||
      fastPath.recentFlush.flush_count <= baseline.recentFlush.flush_count,
  );
});
