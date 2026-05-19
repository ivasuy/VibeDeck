const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

function buildTokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    timestamp: ts,
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: last,
        total_token_usage: total,
      },
    },
  });
}

async function makeGitRepo(root, name) {
  const repo = path.join(root, name);
  await fs.mkdir(repo, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repo, stdio: 'ignore' });
  await fs.writeFile(path.join(repo, 'README.md'), `${name}\n`, 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function usage(input, output, cached = 0, cacheCreation = 0, reasoning = 0) {
  return {
    input_tokens: input,
    cached_input_tokens: cached,
    cache_creation_input_tokens: cacheCreation,
    output_tokens: output,
    reasoning_output_tokens: reasoning,
    total_tokens: input + cached + cacheCreation + output + reasoning,
  };
}

async function writeCodexSession(filePath, { cwd, branch, unsafeBranch = null, count = 20 }) {
  const lines = [
    JSON.stringify({ type: 'session_meta', payload: { cwd, model: 'gpt-5.4', git: { branch } } }),
  ];
  if (unsafeBranch) {
    lines.push(JSON.stringify({ payload: { git: { branch: unsafeBranch } } }));
  }

  const baseHour = unsafeBranch ? 11 : 9;
  let total = usage(0, 0);
  for (let i = 0; i < count; i += 1) {
    const last = usage(3 + i, 2, 1, 1, 1);
    total = {
      input_tokens: total.input_tokens + last.input_tokens,
      cached_input_tokens: total.cached_input_tokens + last.cached_input_tokens,
      cache_creation_input_tokens: total.cache_creation_input_tokens + last.cache_creation_input_tokens,
      output_tokens: total.output_tokens + last.output_tokens,
      reasoning_output_tokens: total.reasoning_output_tokens + last.reasoning_output_tokens,
      total_tokens: total.total_tokens + last.total_tokens,
    };
    lines.push(buildTokenCountLine({
      ts: new Date(Date.UTC(2026, 4, 11, baseHour, 0, i)).toISOString(),
      last,
      total,
    }));
  }

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

async function writeClaudeSession(filePath, { cwdBranch = 'feature/claude', count = 10 }) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(JSON.stringify({
      type: 'assistant',
      timestamp: new Date(Date.UTC(2026, 4, 11, 10, 0, i)).toISOString(),
      gitBranch: cwdBranch,
      message: {
        id: `m${i}`,
        model: 'claude-sonnet-4',
        usage: {
          input_tokens: 4 + i,
          output_tokens: 2,
          cache_read_input_tokens: 1,
          cache_creation_input_tokens: 1,
        },
      },
      requestId: `r${i}`,
    }));
  }

  // Keep conversation_count bucket coverage for the default/unknown model lane.
  lines.push(JSON.stringify({
    type: 'user',
    timestamp: new Date(Date.UTC(2026, 4, 11, 10, 30, 0)).toISOString(),
    gitBranch: cwdBranch,
    message: { content: 'hello from a user turn' },
  }));

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
}

function all(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).all(...params);
  } finally {
    db.close();
  }
}

function get(dbPath, sql, ...params) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get(...params);
  } finally {
    db.close();
  }
}

test('phase A rebuild preserves rich usage, branch facts, and honest unknown fallbacks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-phase-a-richness-'));
  const prev = {
    HOME: process.env.HOME,
    VIBEDECK_HOME: process.env.VIBEDECK_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CODE_HOME: process.env.CODE_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    OPENCODE_HOME: process.env.OPENCODE_HOME,
  };

  try {
    process.env.HOME = root;
    process.env.VIBEDECK_HOME = root;
    process.env.CODEX_HOME = path.join(root, '.codex');
    process.env.CODE_HOME = path.join(root, '.code');
    process.env.GEMINI_HOME = path.join(root, '.gemini');
    process.env.OPENCODE_HOME = path.join(root, '.opencode');

    const repoA = await makeGitRepo(root, 'repo-a');
    const repoB = await makeGitRepo(root, 'repo-b');
    const canonicalRepoA = await fs.realpath(repoA);
    const canonicalRepoB = await fs.realpath(repoB);

    const codexDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '11');
    await writeCodexSession(path.join(codexDir, 'rollout-known.jsonl'), {
      cwd: repoA,
      branch: 'main',
      count: 40,
    });
    await writeCodexSession(path.join(codexDir, 'rollout-unsafe.jsonl'), {
      cwd: repoB,
      branch: 'main',
      unsafeBranch: 'tags/v1.2.3',
      count: 15,
    });

    const claudeDir = path.join(root, '.claude', 'projects', repoA.replace(/\//g, '-'));
    await writeClaudeSession(path.join(claudeDir, 'claude.jsonl'), {
      cwdBranch: 'feature/claude',
      count: 12,
    });

    const { cmdSync } = require('../src/commands/sync');
    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const dbPath = path.join(root, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
    assert.equal(get(dbPath, 'PRAGMA quick_check').quick_check, 'ok');

    const sessions = get(dbPath, 'SELECT COUNT(*) AS n FROM vibedeck_sessions');
    const events = get(dbPath, 'SELECT COUNT(*) AS n FROM vibedeck_session_events');
    const buckets = get(dbPath, 'SELECT COUNT(*) AS n FROM vibedeck_session_buckets');
    const facts = get(dbPath, 'SELECT COUNT(*) AS n FROM vibedeck_branch_usage_facts');
    assert.ok(sessions.n >= 3, 'expected codex and claude sessions');
    assert.ok(events.n >= 70, 'expected raw events to be preserved');
    assert.ok(buckets.n >= 3, 'expected bucket facts');
    assert.ok(facts.n >= 3, 'expected branch usage facts');

    const tokenBuckets = get(dbPath, `
      SELECT
        SUM(input_tokens) AS input_tokens,
        SUM(cached_input_tokens) AS cached_input_tokens,
        SUM(cache_creation_input_tokens) AS cache_creation_input_tokens,
        SUM(output_tokens) AS output_tokens,
        SUM(reasoning_output_tokens) AS reasoning_output_tokens,
        SUM(conversation_count) AS conversation_count
      FROM vibedeck_session_events
      WHERE kind = 'update'
    `);
    assert.ok(Number(tokenBuckets.input_tokens) > 0);
    assert.ok(Number(tokenBuckets.cached_input_tokens) > 0);
    assert.ok(Number(tokenBuckets.cache_creation_input_tokens) > 0);
    assert.ok(Number(tokenBuckets.output_tokens) > 0);
    assert.ok(Number(tokenBuckets.reasoning_output_tokens) > 0);
    assert.ok(Number(tokenBuckets.conversation_count) >= 0);

    const knownBranches = all(dbPath, `
      SELECT branch, branch_kind, confidence, branch_resolution_tier, SUM(total_tokens) AS tokens
      FROM vibedeck_branch_usage_facts
      GROUP BY branch, branch_kind, confidence, branch_resolution_tier
      ORDER BY branch
    `);
    assert.ok(
      knownBranches.some((row) => row.branch === 'main' && row.branch_kind === 'known' && row.branch_resolution_tier),
      'expected known main branch fact with resolution tier',
    );
    assert.ok(
      knownBranches.some((row) => row.branch === 'feature/claude' && row.branch_kind === 'known' && row.confidence),
      'expected known claude branch fact with confidence',
    );
    assert.ok(
      knownBranches.some((row) => row.branch === 'Unknown branch' || row.branch === 'Historical unknown'),
      'expected honest unknown fallback for unsafe provider branch evidence',
    );

    const unresolved = knownBranches.filter(
      (row) => row.branch === 'Unknown branch' || row.branch === 'Historical unknown',
    );
    assert.ok(
      unresolved.some((row) => row.branch_kind === 'unknown_git' || row.branch_kind === 'historical_unknown'),
      'expected unknown fallback kind to remain unresolved',
    );

    const projectRows = all(dbPath, `
      SELECT project_key, repo_root, branch, model, provider, SUM(total_tokens) AS tokens
      FROM vibedeck_branch_usage_facts
      GROUP BY project_key, repo_root, branch, model, provider
    `);
    assert.ok(projectRows.some((row) => row.repo_root === canonicalRepoA && row.branch === 'main'));
    assert.ok(projectRows.some((row) => row.repo_root === canonicalRepoA && row.branch === 'feature/claude'));
    assert.ok(projectRows.some((row) => row.repo_root === canonicalRepoB && row.branch === 'Unknown branch'));
    assert.ok(projectRows.every((row) => Number(row.tokens) >= 0));

    const sessionDrawerRows = all(dbPath, `
      SELECT provider, session_id, branch, first_observed_at, last_observed_at
      FROM vibedeck_branch_usage_facts
      ORDER BY last_observed_at DESC
    `);
    assert.ok(sessionDrawerRows.some((row) => row.provider === 'codex' && row.session_id.includes('rollout-known')));
    assert.ok(sessionDrawerRows.some((row) => row.provider === 'claude' && row.session_id.endsWith('claude.jsonl')));
    assert.ok(sessionDrawerRows.every((row) => typeof row.first_observed_at === 'string' && row.first_observed_at.length > 0));
    assert.ok(sessionDrawerRows.every((row) => typeof row.last_observed_at === 'string' && row.last_observed_at.length > 0));
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('live single-event processing remains immediate outside rebuild mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-phase-a-live-single-'));
  try {
    const repo = await makeGitRepo(root, 'live-repo');
    const dbPath = path.join(root, 'vibedeck.sqlite3');
    const { ensureSchema } = require('../src/lib/db');
    const { processSessionEvent } = require('../src/lib/sessions/pipeline');
    ensureSchema(dbPath);

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 'live-s1',
      started_at: '2026-05-11T12:00:00.000Z',
      cwd: repo,
      model: 'gpt-5.4',
      branch: 'main',
    });

    assert.equal(get(dbPath, 'SELECT COUNT(*) AS n FROM vibedeck_session_events').n, 1);
    assert.equal(
      get(dbPath, 'SELECT branch FROM vibedeck_sessions WHERE provider = ? AND session_id = ?', 'codex', 'live-s1').branch,
      'main',
    );
    assert.equal(
      get(dbPath, 'SELECT branch FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?', 'codex', 'live-s1').branch,
      'main',
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
