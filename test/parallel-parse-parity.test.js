const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
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

async function createCorpus(root) {
  const codexHome = path.join(root, '.codex');
  const rolloutDir = path.join(codexHome, 'sessions', '2026', '05', '20');
  await fs.mkdir(rolloutDir, { recursive: true });
  const ts = new Date().toISOString();
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
  ];

  for (let index = 0; index < usages.length; index += 1) {
    const usage = usages[index];
    await fs.writeFile(
      path.join(rolloutDir, `rollout-${index}.jsonl`),
      `${tokenCountLine({ ts, last: usage, total: usage })}\n`,
      'utf8',
    );
  }
  return codexHome;
}

async function runRebuild({ dirtyPostDrain }) {
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
    VIBEDECK_PARALLEL_PARSE: process.env.VIBEDECK_PARALLEL_PARSE,
  };

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
    if (dirtyPostDrain) process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN = '1';
    else delete process.env.VIBEDECK_REBUILD_DIRTY_POST_DRAIN;

    await cmdSync(['--auto', '--rebuild-vibedeck-db']);

    const trackerDir = path.join(root, '.vibedeck', 'tracker');
    const db = new DatabaseSync(path.join(trackerDir, 'vibedeck.sqlite3'), { readOnly: true });
    try {
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
      };
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

  assert.deepEqual(dirtyScoped.sessions, baseline.sessions);
  assert.deepEqual(dirtyScoped.branchFacts, baseline.branchFacts);
});
