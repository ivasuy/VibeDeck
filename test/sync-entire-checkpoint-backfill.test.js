const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

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

function loadSyncWithStubs({ entireBridgeStub, backfillStub, pipelineStub }) {
  const syncPath = require.resolve('../src/commands/sync');
  const entireBridgePath = require.resolve('../src/lib/entire-bridge');
  const backfillPath = require.resolve('../src/lib/sessions/entire-checkpoint-backfill');
  const pipelinePath = require.resolve('../src/lib/sessions/pipeline');

  const originalEntireBridge = require.cache[entireBridgePath];
  const originalBackfill = require.cache[backfillPath];
  const originalPipeline = require.cache[pipelinePath];

  delete require.cache[syncPath];
  require.cache[entireBridgePath] = {
    id: entireBridgePath,
    filename: entireBridgePath,
    loaded: true,
    exports: entireBridgeStub,
  };
  require.cache[backfillPath] = {
    id: backfillPath,
    filename: backfillPath,
    loaded: true,
    exports: backfillStub,
  };
  require.cache[pipelinePath] = {
    id: pipelinePath,
    filename: pipelinePath,
    loaded: true,
    exports: pipelineStub,
  };

  const mod = require(syncPath);
  return {
    cmdSync: mod.cmdSync,
    restore() {
      delete require.cache[syncPath];
      if (originalEntireBridge) require.cache[entireBridgePath] = originalEntireBridge;
      else delete require.cache[entireBridgePath];
      if (originalBackfill) require.cache[backfillPath] = originalBackfill;
      else delete require.cache[backfillPath];
      if (originalPipeline) require.cache[pipelinePath] = originalPipeline;
      else delete require.cache[pipelinePath];
    },
  };
}

test('sync --rebuild-vibedeck-db runs checkpoint backfill and writes diagnostics after session drain', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-entire-rebuild-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;
  const calls = [];
  let drainedSessionVisible = false;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const rolloutDir = path.join(process.env.CODEX_HOME, 'sessions', '2026', '05', '12');
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
      `${buildTokenCountLine({ ts: '2026-05-12T09:00:00.000Z', last: usage, total: usage })}\n`,
      'utf8',
    );

    const { cmdSync, restore } = loadSyncWithStubs({
      entireBridgeStub: {
        listCheckpointsCached: async () => ({
          available: true,
          files: ['e2/abdc1ec6/metadata.json'],
          tip: 'abc123',
        }),
        readCheckpoint: async (_repoRoot, filePath) => ({
          path: filePath,
          kind: 'json',
          parsed: {
            checkpoint_id: 'e2abdc1ec6',
            entire_session_id: 'entire-session-1',
            agent: 'codex',
            model: 'gpt-5.5',
            branch: 'main',
            started_at: '2026-05-12T09:00:00.000Z',
            ended_at: '2026-05-12T09:05:00.000Z',
          },
        }),
      },
      backfillStub: {
        backfillEntireCheckpointLinks: async ({ dbPath, repoRoot, checkpointTip }) => {
          const db = new DatabaseSync(dbPath, { readOnly: true });
          try {
            const row = db
              .prepare('SELECT session_id FROM vibedeck_sessions WHERE repo_root = ? LIMIT 1')
              .get(repoRoot);
            drainedSessionVisible = Boolean(row && row.session_id);
          } finally {
            db.close();
          }
          calls.push({ repoRoot, checkpointTip });
          return { scanned: 40, linked: 35, ambiguous: 3, unmatched: 2, skipped: 0 };
        },
      },
      pipelineStub: {
        processSessionEvent: async (dbPath, event) => {
          const observedAt =
            event.observed_at || event.started_at || event.ended_at || '2026-05-12T09:00:00.000Z';
          const db = new DatabaseSync(dbPath);
          try {
            db.prepare(`
              INSERT INTO vibedeck_sessions (
                provider, session_id, started_at, ended_at, end_reason,
                cwd, repo_root, repo_common_dir, parent_repo,
                branch, branch_resolution_tier, confidence, override_user,
                model, total_tokens, total_cost_usd, last_observed_at,
                cost_estimated, cost_quality, created_at, updated_at
              ) VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, 'A', 'high', NULL, ?, ?, 1.25, ?, 0, 'stored', ?, ?)
              ON CONFLICT(provider, session_id) DO UPDATE SET updated_at = excluded.updated_at
            `).run(
              event.provider,
              event.session_id,
              observedAt,
              '/repo/switchyard',
              '/repo/switchyard',
              '/repo/switchyard/.git',
              'main',
              'gpt-5.5',
              100,
              observedAt,
              observedAt,
              observedAt,
            );
            db.prepare(`
              INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
              VALUES (?, 'active', '2026-05-12T09:00:00.000Z', '1.0.0')
              ON CONFLICT(repo_root) DO UPDATE SET entire_state = excluded.entire_state
            `).run('/repo/switchyard');
          } finally {
            db.close();
          }
        },
        recoverActiveSessionMetadata: async () => {},
      },
    });

    try {
      await cmdSync(['--rebuild-vibedeck-db']);
    } finally {
      restore();
    }

    assert.equal(drainedSessionVisible, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].repoRoot, '/repo/switchyard');
    assert.equal(calls[0].checkpointTip, 'abc123');

    const diagnosticsPath = path.join(
      tmp,
      '.vibedeck',
      'tracker',
      'diagnostics',
      'entire-checkpoint-backfill.json',
    );
    const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
    assert.equal(typeof diagnostics.generated_at, 'string');
    assert.deepEqual(diagnostics.totals, {
      scanned: 40,
      linked: 35,
      ambiguous: 3,
      unmatched: 2,
    });
    assert.equal(Array.isArray(diagnostics.repos), true);
    assert.equal(diagnostics.repos.length, 1);
    assert.equal(diagnostics.repos[0].repo_root, '/repo/switchyard');
    assert.equal(diagnostics.repos[0].checkpoint_tip, 'abc123');
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

test('normal sync runs lightweight backfill for active/recent and tip-changed active-entire repos', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-entire-incremental-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;
  const calledRepos = [];
  const nowMs = Date.now();
  const activeStartedAt = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
  const activeObservedAt = new Date(nowMs - 20 * 60 * 1000).toISOString();
  const inactiveStartedAt = new Date(nowMs - 5 * 24 * 60 * 60 * 1000).toISOString();
  const inactiveEndedAt = new Date(nowMs - 5 * 24 * 60 * 60 * 1000 + 5 * 60 * 1000).toISOString();
  const inactiveObservedAt = inactiveEndedAt;
  const checkedAt = new Date(nowMs - 60 * 60 * 1000).toISOString();

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, '.codex');
    process.env.CODE_HOME = path.join(tmp, '.code');
    process.env.GEMINI_HOME = path.join(tmp, '.gemini');
    process.env.OPENCODE_HOME = path.join(tmp, '.opencode');

    const trackerDir = path.join(tmp, '.vibedeck', 'tracker');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    const cursorsPath = path.join(trackerDir, 'cursors.json');
    await fs.mkdir(trackerDir, { recursive: true });
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES
          ('codex', 'active-1', ?, NULL, NULL,
           '/repo/active', '/repo/active', '/repo/active/.git', NULL, 'main', 'A', 'high', NULL,
           'gpt-5.5', 10, 0.1, ?, 0, 'stored', ?, ?),
          ('codex', 'inactive-1', ?, ?, 'normal',
           '/repo/inactive', '/repo/inactive', '/repo/inactive/.git', NULL, 'main', 'A', 'high', NULL,
           'gpt-5.5', 10, 0.1, ?, 0, 'stored', ?, ?);

      `).run(
        activeStartedAt,
        activeObservedAt,
        activeStartedAt,
        activeObservedAt,
        inactiveStartedAt,
        inactiveEndedAt,
        inactiveObservedAt,
        inactiveStartedAt,
        inactiveEndedAt,
      );
      db.prepare(`
        INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
        VALUES ('/repo/entire-tip-change', 'active', ?, '1.0.0');
      `).run(checkedAt);
    } finally {
      db.close();
    }

    await fs.writeFile(
      cursorsPath,
      JSON.stringify({
        version: 1,
        files: {},
        updatedAt: null,
        entireCheckpointBackfill: {
          tips: {
            '/repo/active': 'same-tip',
            '/repo/inactive': 'same-tip',
            '/repo/entire-tip-change': 'old-tip',
          },
          updatedAt: null,
        },
      }),
      'utf8',
    );

    const { cmdSync, restore } = loadSyncWithStubs({
      entireBridgeStub: {
        listCheckpointsCached: async (repoRoot) => ({
          available: true,
          files: ['e2/abdc1ec6/metadata.json'],
          tip: repoRoot === '/repo/entire-tip-change' ? 'new-tip' : 'same-tip',
        }),
        readCheckpoint: async (_repoRoot, filePath) => ({ path: filePath, kind: 'json', parsed: {} }),
      },
      backfillStub: {
        backfillEntireCheckpointLinks: async ({ repoRoot }) => {
          calledRepos.push(repoRoot);
          return { scanned: 1, linked: 1, ambiguous: 0, unmatched: 0, skipped: 0 };
        },
      },
      pipelineStub: {
        processSessionEvent: async () => {},
        recoverActiveSessionMetadata: async () => {},
      },
    });

    try {
      await cmdSync([]);
    } finally {
      restore();
    }

    assert.deepEqual(calledRepos.sort(), ['/repo/active', '/repo/entire-tip-change']);
    const diagnosticsPath = path.join(
      tmp,
      '.vibedeck',
      'tracker',
      'diagnostics',
      'entire-checkpoint-backfill.json',
    );
    const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
    assert.equal(diagnostics.repos.length, 2);
    assert.deepEqual(diagnostics.totals, {
      scanned: 2,
      linked: 2,
      ambiguous: 0,
      unmatched: 0,
    });
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

test('normal sync writes diagnostics and preserves tip cursor when per-repo backfill fails', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-entire-faildiag-'));
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
    const cursorsPath = path.join(trackerDir, 'cursors.json');
    await fs.mkdir(trackerDir, { recursive: true });
    ensureSchema(dbPath);

    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
        VALUES ('/repo/failing', 'active', '2026-05-12T08:00:00.000Z', '1.0.0');
      `);
    } finally {
      db.close();
    }

    await fs.writeFile(
      cursorsPath,
      JSON.stringify({
        version: 1,
        files: {},
        updatedAt: null,
        entireCheckpointBackfill: {
          tips: {
            '/repo/failing': 'old-tip',
          },
          updatedAt: null,
        },
      }),
      'utf8',
    );

    const { cmdSync, restore } = loadSyncWithStubs({
      entireBridgeStub: {
        listCheckpointsCached: async () => ({
          available: true,
          files: ['e2/abdc1ec6/metadata.json'],
          tip: 'new-tip',
        }),
        readCheckpoint: async (_repoRoot, filePath) => ({ path: filePath, kind: 'json', parsed: {} }),
      },
      backfillStub: {
        backfillEntireCheckpointLinks: async () => {
          throw new Error('forced backfill failure');
        },
      },
      pipelineStub: {
        processSessionEvent: async () => {},
        recoverActiveSessionMetadata: async () => {},
      },
    });

    try {
      await cmdSync([]);
    } finally {
      restore();
    }

    const diagnosticsPath = path.join(
      tmp,
      '.vibedeck',
      'tracker',
      'diagnostics',
      'entire-checkpoint-backfill.json',
    );
    const diagnostics = JSON.parse(await fs.readFile(diagnosticsPath, 'utf8'));
    assert.equal(diagnostics.repos.length, 1);
    assert.equal(diagnostics.repos[0].repo_root, '/repo/failing');
    assert.match(String(diagnostics.repos[0].error || ''), /forced backfill failure/);
    assert.deepEqual(diagnostics.totals, {
      scanned: 0,
      linked: 0,
      ambiguous: 0,
      unmatched: 0,
    });

    const cursors = JSON.parse(await fs.readFile(cursorsPath, 'utf8'));
    assert.equal(cursors.entireCheckpointBackfill.tips['/repo/failing'], 'old-tip');
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

test('normal sync treats last_observed_at as recent activity for checkpoint backfill selection', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sync-entire-lastobs-'));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevCodeHome = process.env.CODE_HOME;
  const prevGeminiHome = process.env.GEMINI_HOME;
  const prevOpencodeHome = process.env.OPENCODE_HOME;
  const calledRepos = [];
  const nowMs = Date.now();
  const recentObservedAt = new Date(nowMs - 30 * 60 * 1000).toISOString();
  const oldUpdatedAt = new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString();
  const startedAt = new Date(nowMs - 2 * 60 * 60 * 1000).toISOString();
  const endedAt = new Date(nowMs - 90 * 60 * 1000).toISOString();

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
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, last_observed_at,
          cost_estimated, cost_quality, created_at, updated_at
        ) VALUES (
          'codex', 'recent-by-observed', ?, ?, 'normal',
          '/repo/last-observed', '/repo/last-observed', '/repo/last-observed/.git', NULL,
          'main', 'A', 'high', NULL, 'gpt-5.5', 10, 0.1, ?,
          0, 'stored', ?, ?
        );
      `).run(startedAt, endedAt, recentObservedAt, startedAt, oldUpdatedAt);
    } finally {
      db.close();
    }

    const { cmdSync, restore } = loadSyncWithStubs({
      entireBridgeStub: {
        listCheckpointsCached: async () => ({
          available: true,
          files: ['e2/abdc1ec6/metadata.json'],
          tip: 'tip-lastobs',
        }),
        readCheckpoint: async (_repoRoot, filePath) => ({ path: filePath, kind: 'json', parsed: {} }),
      },
      backfillStub: {
        backfillEntireCheckpointLinks: async ({ repoRoot }) => {
          calledRepos.push(repoRoot);
          return { scanned: 1, linked: 1, ambiguous: 0, unmatched: 0, skipped: 0 };
        },
      },
      pipelineStub: {
        processSessionEvent: async () => {},
        recoverActiveSessionMetadata: async () => {},
      },
    });

    try {
      await cmdSync([]);
    } finally {
      restore();
    }

    assert.deepEqual(calledRepos, ['/repo/last-observed']);
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
