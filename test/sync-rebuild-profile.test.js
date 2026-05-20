const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { cmdSync } = require('../src/commands/sync');

function codexTokenLine(ts, totalTokens) {
  const usage = {
    input_tokens: totalTokens,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
  };
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: usage,
        total_token_usage: usage,
      },
    },
  });
}

function claudeUsageLine(ts, id, totalTokens) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: ts,
    message: {
      id,
      model: 'claude-sonnet-4',
      usage: {
        input_tokens: totalTokens,
        output_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    requestId: `req-${id}`,
  });
}

async function writeFixtureFile(filePath, body, mtime) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${body}\n`, 'utf8');
  await fs.utimes(filePath, mtime, mtime);
}

async function runProfiledRebuildFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-rebuild-profile-'));
  const previousEnv = {
    HOME: process.env.HOME,
    VIBEDECK_HOME: process.env.VIBEDECK_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CODE_HOME: process.env.CODE_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    OPENCODE_HOME: process.env.OPENCODE_HOME,
    VIBEDECK_REBUILD_PROFILE: process.env.VIBEDECK_REBUILD_PROFILE,
  };
  const recentDate = new Date();
  const historicalDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  process.env.HOME = root;
  process.env.VIBEDECK_HOME = root;
  process.env.CODEX_HOME = path.join(root, '.codex');
  process.env.CODE_HOME = path.join(root, '.code');
  process.env.GEMINI_HOME = path.join(root, '.gemini');
  process.env.OPENCODE_HOME = path.join(root, '.opencode');
  process.env.VIBEDECK_REBUILD_PROFILE = '1';

  const recentIso = recentDate.toISOString();
  const historicalIso = historicalDate.toISOString();
  await writeFixtureFile(
    path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '20', 'rollout-recent.jsonl'),
    codexTokenLine(recentIso, 5),
    recentDate,
  );
  await writeFixtureFile(
    path.join(process.env.CODEX_HOME, 'sessions', '2026', '04', '20', 'rollout-historical.jsonl'),
    codexTokenLine(historicalIso, 7),
    historicalDate,
  );
  await writeFixtureFile(
    path.join(root, '.claude', 'projects', '-tmp-recent', 'recent.jsonl'),
    claudeUsageLine(recentIso, 'recent', 11),
    recentDate,
  );
  await writeFixtureFile(
    path.join(root, '.claude', 'projects', '-tmp-historical', 'historical.jsonl'),
    claudeUsageLine(historicalIso, 'historical', 13),
    historicalDate,
  );

  try {
    await cmdSync(['--auto', '--rebuild-vibedeck-db']);
    const profilePath = path.join(root, '.vibedeck', 'tracker', 'rebuild_profile.json');
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    return { profile };
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('rebuild profile records decomposed parse and post-drain stages', async () => {
  const { profile } = await runProfiledRebuildFixture();
  const stageNames = profile.stages.map((stage) => stage.name);

  assert.deepEqual(stageNames, [
    'recent_codex_parse',
    'recent_claude_parse',
    'recent_lane_session_event_flush',
    'historical_codex_parse',
    'historical_claude_parse',
    'repair_pass',
    'branch_fact_rebuild_pass',
  ]);
  for (const stage of profile.stages) {
    assert.equal(typeof stage.duration_ms, 'number');
    assert.ok(stage.duration_ms >= 0);
  }
});

test('rebuild profile records hard counters for flushed events and post-drain scopes', async () => {
  const { profile } = await runProfiledRebuildFixture();

  assert.equal(typeof profile.counters.recent_session_events_flushed, 'number');
  assert.equal(typeof profile.counters.historical_session_events_flushed, 'number');
  assert.ok(profile.counters.recent_session_events_flushed > 0);
  assert.ok(profile.counters.historical_session_events_flushed > 0);
  assert.equal(typeof profile.counters.repair_candidates_attempted, 'number');
  assert.equal(typeof profile.counters.branch_facts_rebuilt_by_scope, 'object');
  assert.ok(
    Object.values(profile.counters.branch_facts_rebuilt_by_scope).every(
      (value) => typeof value === 'number' && value >= 0,
    ),
  );
});

test('phase h smoke harness writes compact summary and copied profile artifact', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-phase-h-smoke-artifacts-'));
  try {
    const profilePath = path.join(tmp, 'rebuild_profile.json');
    await fs.writeFile(
      profilePath,
      JSON.stringify(
        {
          generated_at: '2026-05-20T00:00:00.000Z',
          stages: [
            { name: 'recent_codex_parse', duration_ms: 20, counters: { files_processed: 2 } },
            { name: 'recent_lane_session_event_flush', duration_ms: 80, counters: { flush_count: 1 } },
            { name: 'repair_pass', duration_ms: 30, counters: { repair_candidates_attempted: 3 } },
          ],
          counters: {
            recent_session_events_flushed: 6,
            historical_session_events_flushed: 4,
            repair_candidates_attempted: 3,
            branch_facts_rebuilt_by_scope: { dirty: 2 },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const { writePhaseHSmokeArtifacts } = require('../scripts/smoke/rebuild-hot-path-phase-h.cjs');
    const summary = await writePhaseHSmokeArtifacts({
      artifactDir: tmp,
      profilePath,
      wallClockMs: 194_000,
      command: 'node bin/vibedeck.js sync --rebuild-vibedeck-db',
      exitCode: 0,
    });

    assert.equal(summary.result, 'pass');
    assert.equal(summary.performance_gate.passed, true);
    assert.equal(summary.performance_gate.baseline_ms, 268_890);
    assert.equal(summary.performance_gate.target_ms, 195_000);
    assert.deepEqual(
      summary.top_stages.map((stage) => stage.name),
      ['recent_lane_session_event_flush', 'repair_pass', 'recent_codex_parse'],
    );
    assert.equal(summary.totals.recent_session_events_flushed, 6);

    const copiedProfile = JSON.parse(
      await fs.readFile(path.join(tmp, 'phase-h-rebuild-profile.json'), 'utf8'),
    );
    assert.equal(copiedProfile.counters.branch_facts_rebuilt_by_scope.dirty, 2);

    const writtenSummary = JSON.parse(
      await fs.readFile(path.join(tmp, 'phase-h-rebuild-summary.json'), 'utf8'),
    );
    assert.equal(writtenSummary.wall_clock_ms, 194_000);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
