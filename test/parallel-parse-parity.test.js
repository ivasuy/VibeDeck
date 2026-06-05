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

async function writeSessionFile(filePath, body, mtime) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}\n`, 'utf8');
  await fs.utimes(filePath, mtime, mtime);
}

function initGitRepo(repoRoot) {
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['checkout', '-B', 'main'], { cwd: repoRoot, stdio: 'ignore' });
}

async function createCorpus(root) {
  const codexHome = path.join(root, '.codex');
  const repoRoot = path.join(root, 'workspace', 'parallel-parity');
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
  await writeSessionFile(
    path.join(recentDir, 'rollout-mixed-lane.jsonl'),
    [
      sessionMetaLine({ cwd: repoRoot, branch: 'main' }),
      tokenCountLine({ ts: historicalTs, last: usages[1], total: usages[1] }),
      tokenCountLine({
        ts: recentTs,
        last: usages[2],
        total: {
          input_tokens: usages[1].input_tokens + usages[2].input_tokens,
          cached_input_tokens: usages[1].cached_input_tokens + usages[2].cached_input_tokens,
          cache_creation_input_tokens:
            usages[1].cache_creation_input_tokens + usages[2].cache_creation_input_tokens,
          output_tokens: usages[1].output_tokens + usages[2].output_tokens,
          reasoning_output_tokens:
            usages[1].reasoning_output_tokens + usages[2].reasoning_output_tokens,
          total_tokens: usages[1].total_tokens + usages[2].total_tokens,
        },
      }),
    ].join('\n'),
    recentDate,
  );
  return codexHome;
}

async function runRebuild({
  dirtyPostDrain,
  recentFastPath = false,
  flushSliceEvents = null,
  sessionBatchEvents = null,
  captureBatchSizes = false,
  captureBatchOptions = false,
}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), dirtyPostDrain ? 'vd-dirty-post-' : 'vd-full-post-'));
  const previous = {
    HOME: process.env.HOME,
    VIBEDECK_HOME: process.env.VIBEDECK_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CODE_HOME: process.env.CODE_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    OPENCODE_HOME: process.env.OPENCODE_HOME,
    VIBEDECK_REBUILD_PROFILE: process.env.VIBEDECK_REBUILD_PROFILE,
    VIBEDECK_REBUILD_DIRTY_POST_DRAIN: process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN,
    VIBEDECK_REBUILD_RECENT_FASTPATH: process.env.VIBEDECK_REBUILD_RECENT_FASTPATH,
    VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS: process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS,
    VIBEDECK_REBUILD_SESSION_BATCH_EVENTS: process.env.VIBEDECK_REBUILD_SESSION_BATCH_EVENTS,
    VIBEDECK_PARALLEL_PARSE: process.env.VIBEDECK_PARALLEL_PARSE,
  };
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const pipeline = require(pipelinePath);
  const originalBatch = pipeline.processSessionEventBatch;
  const batchSizes = [];
  const batchOptions = [];

  try {
    const codexHome = await createCorpus(root);
    process.env.HOME = root;
    process.env.VIBEDECK_HOME = root;
    process.env.CODEX_HOME = codexHome;
    process.env.CODE_HOME = path.join(root, '.code');
    process.env.GEMINI_HOME = path.join(root, '.gemini');
    process.env.OPENCODE_HOME = path.join(root, '.opencode');
    process.env.VIBEDECK_REBUILD_PROFILE = '1';
    process.env.VIBEDECK_PARALLEL_PARSE = '1';
    process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = dirtyPostDrain ? '1' : '0';
    if (recentFastPath) process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = '1';
    else delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    if (flushSliceEvents == null) delete process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS;
    else process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS = String(flushSliceEvents);
    if (sessionBatchEvents == null) delete process.env.VIBEDECK_REBUILD_SESSION_BATCH_EVENTS;
    else process.env.VIBEDECK_REBUILD_SESSION_BATCH_EVENTS = String(sessionBatchEvents);
    if (captureBatchSizes || captureBatchOptions) {
      pipeline.processSessionEventBatch = async (dbPath, events, options = {}) => {
        if (captureBatchSizes) batchSizes.push(events.length);
        if (captureBatchOptions) {
          batchOptions.push({
            deferBranchFactRebuild: options.deferBranchFactRebuild === true,
          });
        }
        return originalBatch(dbPath, events, options);
      };
    }

    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const trackerDir = path.join(root, '.vibedeck', 'tracker');
    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
      return { ...readCanonicalSummary(db), batchSizes, batchOptions };
    } finally {
      db.close();
    }
  } finally {
    pipeline.processSessionEventBatch = originalBatch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

function readCanonicalSummary(db) {
  return {
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

test('dirty post-drain rebuild preserves canonical parity with parallel parse enabled', async () => {
  const baseline = await runRebuild({ dirtyPostDrain: false });
  const dirtyScoped = await runRebuild({ dirtyPostDrain: true });
  const sliceBatched = await runRebuild({
    dirtyPostDrain: true,
    recentFastPath: true,
    flushSliceEvents: 1,
    sessionBatchEvents: 1,
    captureBatchSizes: true,
    captureBatchOptions: true,
  });

  assert.deepEqual(dirtyScoped.sessions, baseline.sessions);
  assert.deepEqual(dirtyScoped.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(dirtyScoped.branchFacts, baseline.branchFacts);
  assert.deepEqual(dirtyScoped.branchWindows, baseline.branchWindows);
  assert.deepEqual(dirtyScoped.totals, baseline.totals);
  assert.deepEqual(dirtyScoped.unknownBuckets, baseline.unknownBuckets);
  assert.deepEqual(sliceBatched.sessions, baseline.sessions);
  assert.deepEqual(sliceBatched.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(sliceBatched.branchFacts, baseline.branchFacts);
  assert.deepEqual(sliceBatched.branchWindows, baseline.branchWindows);
  assert.deepEqual(sliceBatched.totals, baseline.totals);
  assert.deepEqual(sliceBatched.unknownBuckets, baseline.unknownBuckets);
  assert.ok(sliceBatched.batchSizes.length > 1);
  assert.ok(
    sliceBatched.batchSizes.every((size) => size <= 1),
    `batch sizes: ${sliceBatched.batchSizes.join(',')}`,
  );
  assert.ok(sliceBatched.batchOptions.length > 0);
  assert.ok(
    sliceBatched.batchOptions.every((options) => options.deferBranchFactRebuild),
    `batch options: ${JSON.stringify(sliceBatched.batchOptions)}`,
  );
});
