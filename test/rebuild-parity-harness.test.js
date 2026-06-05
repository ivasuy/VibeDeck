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
  fastPath,
  dirtyPostDrain = false,
  flushSliceEvents = null,
  sessionBatchEvents = null,
  captureBatchSizes = false,
  captureBatchOptions = false,
  recentFastPathEnv = fastPath ? '1' : '0',
  profileEnv = '1',
}) {
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
    VIBEDECK_PROJECTION_FRESHNESS: process.env.VIBEDECK_PROJECTION_FRESHNESS,
    VIBEDECK_REBUILD_DIRTY_POST_DRAIN: process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN,
    VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS: process.env.VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS,
    VIBEDECK_REBUILD_SESSION_BATCH_EVENTS: process.env.VIBEDECK_REBUILD_SESSION_BATCH_EVENTS,
  };
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');
  const pipeline = require(pipelinePath);
  const originalBatch = pipeline.processSessionEventBatch;
  const batchSizes = [];
  const batchOptions = [];

  try {
    const codexHome = await createParityCorpus(root);
    process.env.HOME = root;
    process.env.VIBEDECK_HOME = root;
    process.env.CODEX_HOME = codexHome;
    process.env.CODE_HOME = path.join(root, '.code');
    process.env.GEMINI_HOME = path.join(root, '.gemini');
    process.env.OPENCODE_HOME = path.join(root, '.opencode');
    if (profileEnv == null) delete process.env.VIBEDECK_REBUILD_PROFILE;
    else process.env.VIBEDECK_REBUILD_PROFILE = String(profileEnv);
    if (recentFastPathEnv == null) delete process.env.VIBEDECK_REBUILD_RECENT_FASTPATH;
    else process.env.VIBEDECK_REBUILD_RECENT_FASTPATH = String(recentFastPathEnv);
    if (dirtyPostDrain == null) delete process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;
    else process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = dirtyPostDrain ? '1' : '0';
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
      let profile = null;
      try {
        profile = await readJson(path.join(trackerDir, 'rebuild_profile.json'));
      } catch (err) {
        if (err?.code !== 'ENOENT') throw err;
      }
      summary.recentFlush =
        profile?.stages?.find((stage) => stage.name === 'recent_lane_session_event_flush')?.counters || {};
      summary.profile = profile;
      summary.batchSizes = batchSizes;
      summary.batchOptions = batchOptions;
      return summary;
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

test('phase h3 smoke summary records defer-branch-fact benchmark gates', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-phase-h3-smoke-test-'));
  try {
    const profilePath = path.join(tmp, 'rebuild_profile.json');
    await fs.writeFile(
      profilePath,
      JSON.stringify(
        {
          generated_at: '2026-05-20T00:00:00.000Z',
          stages: [
            { name: 'recent_codex_parse', duration_ms: 20, counters: { files_processed: 2 } },
            {
              name: 'recent_lane_session_event_flush',
              duration_ms: 210_000,
              counters: {
                recent_session_events_flushed: 6,
                historical_session_events_flushed: 4,
                flush_count: 11,
                slice_threshold_flush_count: 8,
                historical_slice_threshold_flush_count: 8,
              },
            },
            {
              name: 'branch_fact_rebuild_pass',
              duration_ms: 20_000,
              counters: { dirty_branch_facts_rebuilt: 2 },
            },
          ],
          counters: {
            recent_session_events_flushed: 6,
            historical_session_events_flushed: 4,
            branch_facts_rebuilt_by_scope: { dirty: 2 },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const smokeHarness = require('../scripts/smoke/rebuild-hot-path-phase-h3.cjs');
    const summary = await smokeHarness.writePhaseH3SmokeArtifacts({
      artifactDir: tmp,
      profilePath,
      wallClockMs: 299_000,
      command: 'node bin/vibedeck.js sync --rebuild-vibedeck-db',
      exitCode: 0,
    });

    assert.equal(summary.result, 'pass');
    assert.equal(summary.performance_gate.baseline_ms, 366_301);
    assert.equal(summary.performance_gate.target_ms, 300_000);
    assert.equal(summary.performance_gate.passed, true);
    assert.equal(summary.flush_stage_gate.stage_name, 'recent_lane_session_event_flush');
    assert.equal(summary.flush_stage_gate.baseline_ms, 307_974.929);
    assert.equal(summary.flush_stage_gate.target_ms, 220_000);
    assert.equal(summary.flush_stage_gate.passed, true);
    assert.equal(summary.branch_fact_gate.stage_name, 'branch_fact_rebuild_pass');
    assert.equal(summary.branch_fact_gate.baseline_ms, 25_939.595);
    assert.equal(summary.branch_fact_gate.current_ms, 20_000);
    assert.equal(summary.branch_fact_gate.passed, true);

    const copiedProfile = JSON.parse(
      await fs.readFile(path.join(tmp, 'phase-h3-rebuild-profile.json'), 'utf8'),
    );
    assert.equal(copiedProfile.counters.branch_facts_rebuilt_by_scope.dirty, 2);

    const writtenSummary = JSON.parse(
      await fs.readFile(path.join(tmp, 'phase-h3-rebuild-summary.json'), 'utf8'),
    );
    assert.equal(writtenSummary.flush_stage_gate.current_ms, 210_000);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('phase h3 smoke summary fails branch-fact gate when branch rebuild stage is missing', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-phase-h3-smoke-missing-branch-stage-'));
  try {
    const profilePath = path.join(tmp, 'rebuild_profile.json');
    await fs.writeFile(
      profilePath,
      JSON.stringify(
        {
          generated_at: '2026-05-20T00:00:00.000Z',
          stages: [
            { name: 'recent_codex_parse', duration_ms: 20, counters: { files_processed: 2 } },
            {
              name: 'recent_lane_session_event_flush',
              duration_ms: 210_000,
              counters: {
                recent_session_events_flushed: 6,
                historical_session_events_flushed: 4,
                flush_count: 11,
              },
            },
          ],
          counters: {
            recent_session_events_flushed: 6,
            historical_session_events_flushed: 4,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const smokeHarness = require('../scripts/smoke/rebuild-hot-path-phase-h3.cjs');
    const summary = await smokeHarness.writePhaseH3SmokeArtifacts({
      artifactDir: tmp,
      profilePath,
      wallClockMs: 299_000,
      command: 'node bin/vibedeck.js sync --rebuild-vibedeck-db',
      exitCode: 0,
    });

    assert.equal(summary.result, 'fail');
    assert.equal(summary.branch_fact_gate.current_ms, null);
    assert.equal(summary.branch_fact_gate.passed, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('recent-first rebuild preserves canonical parity while materializing recent before historical', async () => {
  const baseline = await runRebuild({ fastPath: false });
  const fastPath = await runRebuild({ fastPath: true });
  const dirtyDeferred = await runRebuild({
    fastPath: true,
    dirtyPostDrain: true,
    flushSliceEvents: 1,
    sessionBatchEvents: 1,
    captureBatchSizes: true,
    captureBatchOptions: true,
  });
  const sliceBatch = await runRebuild({ fastPath: true, flushSliceEvents: 1 });
  const laneSplitChunked = await runRebuild({
    fastPath: true,
    flushSliceEvents: 1,
    sessionBatchEvents: 1,
    captureBatchSizes: true,
  });

  assert.deepEqual(fastPath.sessions, baseline.sessions);
  assert.deepEqual(fastPath.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(fastPath.branchFacts, baseline.branchFacts);
  assert.deepEqual(fastPath.branchWindows, baseline.branchWindows);
  assert.deepEqual(fastPath.totals, baseline.totals);
  assert.deepEqual(fastPath.unknownBuckets, baseline.unknownBuckets);
  assert.deepEqual(dirtyDeferred.sessions, baseline.sessions);
  assert.deepEqual(dirtyDeferred.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(dirtyDeferred.branchFacts, baseline.branchFacts);
  assert.deepEqual(dirtyDeferred.branchWindows, baseline.branchWindows);
  assert.deepEqual(dirtyDeferred.totals, baseline.totals);
  assert.deepEqual(dirtyDeferred.unknownBuckets, baseline.unknownBuckets);
  assert.deepEqual(sliceBatch.sessions, fastPath.sessions);
  assert.deepEqual(sliceBatch.sessionEvents, fastPath.sessionEvents);
  assert.deepEqual(sliceBatch.branchFacts, fastPath.branchFacts);
  assert.deepEqual(sliceBatch.branchWindows, fastPath.branchWindows);
  assert.deepEqual(sliceBatch.totals, fastPath.totals);
  assert.deepEqual(sliceBatch.unknownBuckets, fastPath.unknownBuckets);
  assert.deepEqual(laneSplitChunked.sessions, baseline.sessions);
  assert.deepEqual(laneSplitChunked.sessionEvents, baseline.sessionEvents);
  assert.deepEqual(laneSplitChunked.branchFacts, baseline.branchFacts);
  assert.deepEqual(laneSplitChunked.branchWindows, baseline.branchWindows);
  assert.deepEqual(laneSplitChunked.totals, baseline.totals);
  assert.deepEqual(laneSplitChunked.unknownBuckets, baseline.unknownBuckets);
  assert.ok(laneSplitChunked.batchSizes.length > 1);
  assert.ok(
    laneSplitChunked.batchSizes.every((size) => size <= 1),
    `batch sizes: ${laneSplitChunked.batchSizes.join(',')}`,
  );
  assert.ok(dirtyDeferred.batchOptions.length > 0);
  assert.ok(
    dirtyDeferred.batchOptions.every((options) => options.deferBranchFactRebuild),
    `batch options: ${JSON.stringify(dirtyDeferred.batchOptions)}`,
  );
  assert.ok(sliceBatch.recentFlush.slice_threshold_flush_count > 0);
  assert.ok(laneSplitChunked.recentFlush.historical_slice_threshold_flush_count > 0);
  assert.equal(fastPath.recentFlush.flush_count, 2);
  assert.ok(fastPath.recentFlush.recent_session_events_flushed > 0);
  assert.ok(fastPath.recentFlush.historical_session_events_flushed > 0);
});

test('rebuild rollout defaults enable recent-first profile diagnostics with documented rollback flags', async () => {
  const rollout = await runRebuild({
    fastPath: true,
    dirtyPostDrain: null,
    recentFastPathEnv: null,
    profileEnv: null,
  });

  assert.equal(rollout.profile.defaults.snapshot_write, true);
  assert.equal(rollout.profile.defaults.recent_first_rebuild, true);
  assert.equal(rollout.profile.defaults.dirty_post_drain, true);
  assert.equal(rollout.profile.defaults.freshness_reporting, true);
  assert.ok(Number.isFinite(rollout.profile.milestones.first_paint_ready_ms));
  assert.ok(Number.isFinite(rollout.profile.milestones.historical_completion_ms));
  assert.ok(
    rollout.profile.milestones.historical_completion_ms >= rollout.profile.milestones.first_paint_ready_ms,
    JSON.stringify(rollout.profile.milestones),
  );
  assert.match(
    rollout.profile.rollback_env_flags.VIBEDECK_STARTUP_SNAPSHOT,
    /0 disables startup snapshot/,
  );
  assert.match(
    rollout.profile.rollback_env_flags.VIBEDECK_REBUILD_RECENT_FASTPATH,
    /0 disables recent-first/,
  );
  assert.match(
    rollout.profile.rollback_env_flags.VIBEDECK_REBUILD_DIRTY_POST_DRAIN,
    /0 restores inline branch-fact rebuilds/,
  );
  assert.match(
    rollout.profile.rollback_env_flags.VIBEDECK_PROJECTION_FRESHNESS,
    /0 disables projection freshness/,
  );
  assert.match(
    rollout.profile.rollback_env_flags.VIBEDECK_REBUILD_PROFILE,
    /0 disables rebuild profile/,
  );
});
