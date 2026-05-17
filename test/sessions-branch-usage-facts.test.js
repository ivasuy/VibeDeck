const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const {
  rebuildBranchUsageFactsForSession,
  readBranchUsageFactRows,
  repairMissingProjectAttribution,
} = require('../src/lib/sessions/branch-usage-facts');
const { recordTransition } = require('../src/lib/sessions/head-history');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-branch-facts-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    dir,
    dbPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function initGitRepo(repoRoot) {
  fs.mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repoRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['branch', 'feature/live'], { cwd: repoRoot, stdio: 'ignore' });
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, cost_estimated, cost_quality,
      created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @cost_estimated, @cost_quality,
      @started_at, @last_observed_at
    )
  `).run({
    repo_common_dir: null,
    parent_repo: null,
    branch: null,
    branch_resolution_tier: 'D',
    confidence: 'unattributed',
    total_cost_usd: null,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_estimated: 1,
    cost_quality: 'partial_unknown',
    ...row,
  });
}

function insertEvent(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at,
      started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence,
      model, delta_tokens, input_tokens, cached_input_tokens,
      cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
      conversation_count, total_tokens, created_at
    ) VALUES (
      @provider, @session_id, @event_key, 'update', @observed_at,
      NULL, NULL, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence,
      @model, @delta_tokens, @input_tokens, 0,
      0, @output_tokens, 0,
      1, @total_tokens, @observed_at
    )
  `).run({
    branch: null,
    branch_resolution_tier: null,
    confidence: null,
    input_tokens: 0,
    output_tokens: 0,
    total_tokens: null,
    delta_tokens: null,
    ...row,
  });
}

test('branch facts split a cross-branch session by event time instead of wall-clock time', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T10:00:00.000Z',
    });
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'feature/live',
      transitioned_at: '2026-05-10T10:05:00.000Z',
    });

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 's1',
        started_at: '2026-05-10T10:00:00.000Z',
        ended_at: '2026-05-10T10:30:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'feature/live',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100,
        total_cost_usd: 1.0,
        last_observed_at: '2026-05-10T10:20:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 's1',
        event_key: 'e1',
        observed_at: '2026-05-10T10:02:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.4',
        delta_tokens: 90,
        input_tokens: 80,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 's1',
        event_key: 'e2',
        observed_at: '2026-05-10T10:20:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.4',
        delta_tokens: 10,
        input_tokens: 8,
        output_tokens: 2,
      });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 's1' });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.deepEqual(rows.map((row) => ({ branch: row.branch, total_tokens: row.total_tokens, total_cost_usd: row.total_cost_usd })), [
      { branch: 'main', total_tokens: 90, total_cost_usd: 0.9 },
      { branch: 'feature/live', total_tokens: 10, total_cost_usd: 0.1 },
    ]);
  } finally {
    tmp.cleanup();
  }
});

test('branch facts use event branch labels when head history is missing and normalize ancestry suffixes', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'event-branch-fallback',
        started_at: '2026-05-10T10:00:00.000Z',
        ended_at: '2026-05-10T10:30:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'release/0.1.3',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100,
        total_cost_usd: 1.0,
        last_observed_at: '2026-05-10T10:20:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'event-branch-fallback',
        event_key: 'e1',
        observed_at: '2026-05-10T10:02:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'release/0.1.3~1',
        model: 'gpt-5.4',
        delta_tokens: 90,
        input_tokens: 80,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'event-branch-fallback',
        event_key: 'e2',
        observed_at: '2026-05-10T10:20:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'release/0.1.3~2',
        model: 'gpt-5.4',
        delta_tokens: 10,
        input_tokens: 8,
        output_tokens: 2,
      });
      rebuildBranchUsageFactsForSession(db, {
        dbPath: tmp.dbPath,
        provider: 'codex',
        session_id: 'event-branch-fallback',
      });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.deepEqual(rows.map((row) => ({
      branch: row.branch,
      attribution_branch: row.attribution_branch,
      branch_kind: row.branch_kind,
      total_tokens: row.total_tokens,
      total_cost_usd: row.total_cost_usd,
    })), [
      {
        branch: 'release/0.1.3',
        attribution_branch: 'release/0.1.3',
        branch_kind: 'known',
        total_tokens: 100,
        total_cost_usd: 1,
      },
    ]);
  } finally {
    tmp.cleanup();
  }
});

test('branch facts preserve non-git projects and hide missing folders by default', () => {
  const tmp = makeDb();
  try {
    const nonGit = path.join(tmp.dir, 'notes-app');
    fs.mkdirSync(nonGit, { recursive: true });
    const missing = path.join(tmp.dir, 'deleted-app');
    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'claude',
        session_id: 'non-git',
        started_at: '2026-05-10T11:00:00.000Z',
        ended_at: '2026-05-10T11:05:00.000Z',
        cwd: nonGit,
        repo_root: null,
        model: 'claude-sonnet-4',
        total_tokens: 50,
        total_cost_usd: 0.5,
        last_observed_at: '2026-05-10T11:05:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 'missing',
        started_at: '2026-05-10T12:00:00.000Z',
        ended_at: '2026-05-10T12:05:00.000Z',
        cwd: missing,
        repo_root: null,
        model: 'claude-sonnet-4',
        total_tokens: 70,
        total_cost_usd: 0.7,
        last_observed_at: '2026-05-10T12:05:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'claude', session_id: 'non-git' });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'claude', session_id: 'missing' });
    } finally {
      db.close();
    }

    const visible = readBranchUsageFactRows(tmp.dbPath);
    assert.deepEqual(visible.map((row) => ({ state: row.project_state, branch: row.branch, tokens: row.total_tokens })), [
      { state: 'non_git_existing', branch: 'No branch', tokens: 50 },
    ]);

    const allRows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(allRows.length, 2);
    assert.equal(allRows.find((row) => row.session_id === 'missing').project_state, 'cwd_missing');
  } finally {
    tmp.cleanup();
  }
});

test('sessions with no update events fall back to one fact and rebuild is idempotent', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'fallback',
        started_at: '2026-05-10T13:00:00.000Z',
        ended_at: '2026-05-10T13:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 33,
        total_cost_usd: 0.66,
        last_observed_at: '2026-05-10T13:10:00.000Z',
        input_tokens: 20,
        output_tokens: 13,
        cost_estimated: 0,
        cost_quality: 'stored',
      });

      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'fallback' });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'fallback' });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, 'main');
    assert.equal(rows[0].attribution_branch, 'main');
    assert.equal(rows[0].branch_kind, 'known');
    assert.equal(rows[0].total_tokens, 33);
    assert.equal(rows[0].total_cost_usd, 0.66);
    assert.equal(rows[0].event_count, 0);
    assert.equal(rows[0].session_id, 'fallback');
  } finally {
    tmp.cleanup();
  }
});

test('branch facts normalize remote branch labels but preserve tag ancestry labels', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'remote-branch',
        started_at: '2026-05-10T13:00:00.000Z',
        ended_at: '2026-05-10T13:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'remotes/origin/main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 20,
        total_cost_usd: 0.2,
        last_observed_at: '2026-05-10T13:10:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertSession(db, {
        provider: 'codex',
        session_id: 'tag-history',
        started_at: '2026-05-10T14:00:00.000Z',
        ended_at: '2026-05-10T14:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'tags/v0.1.1~73',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 30,
        total_cost_usd: 0.3,
        last_observed_at: '2026-05-10T14:10:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });

      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'remote-branch' });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'tag-history' });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true })
      .map((row) => ({ session_id: row.session_id, branch: row.branch, attribution_branch: row.attribution_branch }))
      .sort((a, b) => a.session_id.localeCompare(b.session_id));
    assert.deepEqual(rows, [
      { session_id: 'remote-branch', branch: 'main', attribution_branch: 'main' },
      { session_id: 'tag-history', branch: 'tags/v0.1.1~73', attribution_branch: 'tags/v0.1.1~73' },
    ]);
  } finally {
    tmp.cleanup();
  }
});

test('sessions without cwd or repo evidence remain hidden by default and can be included', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'cursor',
        session_id: 'unattributed',
        started_at: '2026-05-10T14:00:00.000Z',
        ended_at: '2026-05-10T14:05:00.000Z',
        cwd: null,
        repo_root: null,
        model: 'gpt-4o',
        total_tokens: 12,
        total_cost_usd: null,
        last_observed_at: '2026-05-10T14:05:00.000Z',
        cost_estimated: 1,
        cost_quality: 'partial_unknown',
      });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'cursor', session_id: 'unattributed' });
    } finally {
      db.close();
    }

    const visible = readBranchUsageFactRows(tmp.dbPath);
    assert.equal(visible.length, 0);

    const included = readBranchUsageFactRows(tmp.dbPath, { includeUnattributed: true });
    assert.equal(included.length, 1);
    assert.equal(included[0].project_state, 'unattributed');
    assert.equal(included[0].branch, 'Unattributed');
  } finally {
    tmp.cleanup();
  }
});

test('token reconciliation assigns delta to the largest group', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T09:00:00.000Z',
    });

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'reconcile',
        started_at: '2026-05-10T15:00:00.000Z',
        ended_at: '2026-05-10T15:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100,
        total_cost_usd: 1,
        last_observed_at: '2026-05-10T15:10:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'reconcile',
        event_key: 'e1',
        observed_at: '2026-05-10T15:01:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.4',
        delta_tokens: 60,
        input_tokens: 50,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'reconcile',
        event_key: 'e2',
        observed_at: '2026-05-10T15:02:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-4o',
        delta_tokens: 30,
        input_tokens: 25,
        output_tokens: 5,
      });

      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'reconcile' });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true }).sort((a, b) => b.total_tokens - a.total_tokens);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].token_reconciled, 1);
    assert.equal(rows[0].total_tokens, 70);
    assert.equal(rows[1].token_reconciled, 0);
    assert.equal(rows[1].total_tokens, 30);
    assert.equal(rows[0].total_tokens + rows[1].total_tokens, 100);
  } finally {
    tmp.cleanup();
  }
});

test('events missing cwd/repo fallback to session project attribution for event-time branch splits', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T16:00:00.000Z',
    });
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'feature/live',
      transitioned_at: '2026-05-10T16:05:00.000Z',
    });

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'missing-event-project',
        started_at: '2026-05-10T16:00:00.000Z',
        ended_at: '2026-05-10T16:30:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'feature/live',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 100,
        total_cost_usd: 1,
        last_observed_at: '2026-05-10T16:30:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'missing-event-project',
        event_key: 'e1',
        observed_at: '2026-05-10T16:02:00.000Z',
        cwd: null,
        repo_root: null,
        model: 'gpt-5.4',
        delta_tokens: 80,
        input_tokens: 70,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'missing-event-project',
        event_key: 'e2',
        observed_at: '2026-05-10T16:20:00.000Z',
        cwd: null,
        repo_root: null,
        model: 'gpt-5.4',
        delta_tokens: 20,
        input_tokens: 15,
        output_tokens: 5,
      });

      rebuildBranchUsageFactsForSession(db, {
        dbPath: tmp.dbPath,
        provider: 'codex',
        session_id: 'missing-event-project',
      });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.deepEqual(rows.map((row) => ({ branch: row.branch, total_tokens: row.total_tokens })), [
      { branch: 'main', total_tokens: 80 },
      { branch: 'feature/live', total_tokens: 20 },
    ]);
  } finally {
    tmp.cleanup();
  }
});

test('readBranchUsageFactRows supports sourceFilter string and set', () => {
  const tmp = makeDb();
  try {
    const codexDir = path.join(tmp.dir, 'codex-proj');
    const claudeDir = path.join(tmp.dir, 'claude-proj');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.mkdirSync(claudeDir, { recursive: true });

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'source-codex',
        started_at: '2026-05-10T17:00:00.000Z',
        ended_at: '2026-05-10T17:05:00.000Z',
        cwd: codexDir,
        repo_root: null,
        model: 'gpt-5.4',
        total_tokens: 10,
        total_cost_usd: 0.1,
        last_observed_at: '2026-05-10T17:05:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 'source-claude',
        started_at: '2026-05-10T17:10:00.000Z',
        ended_at: '2026-05-10T17:15:00.000Z',
        cwd: claudeDir,
        repo_root: null,
        model: 'claude-sonnet-4',
        total_tokens: 20,
        total_cost_usd: 0.2,
        last_observed_at: '2026-05-10T17:15:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });

      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'source-codex' });
      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'claude', session_id: 'source-claude' });
    } finally {
      db.close();
    }

    const stringFiltered = readBranchUsageFactRows(tmp.dbPath, { sourceFilter: 'codex' });
    assert.deepEqual(stringFiltered.map((row) => row.provider), ['codex']);

    const setFiltered = readBranchUsageFactRows(tmp.dbPath, { sourceFilter: new Set(['codex']) });
    assert.deepEqual(setFiltered.map((row) => row.provider), ['codex']);
  } finally {
    tmp.cleanup();
  }
});

test('token reconciliation never writes negative totals when event sum exceeds session total', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);
    recordTransition(tmp.dbPath, {
      repo_root: repoRoot,
      worktree_root: repoRoot,
      ref_name: 'main',
      transitioned_at: '2026-05-10T18:00:00.000Z',
    });

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'overcount',
        started_at: '2026-05-10T18:00:00.000Z',
        ended_at: '2026-05-10T18:10:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'main',
        branch_resolution_tier: 'B',
        confidence: 'medium',
        model: 'gpt-5.4',
        total_tokens: 0,
        total_cost_usd: 0,
        last_observed_at: '2026-05-10T18:10:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'overcount',
        event_key: 'e1',
        observed_at: '2026-05-10T18:01:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-5.4',
        delta_tokens: 30,
        input_tokens: 20,
        output_tokens: 10,
      });
      insertEvent(db, {
        provider: 'codex',
        session_id: 'overcount',
        event_key: 'e2',
        observed_at: '2026-05-10T18:02:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'gpt-4o',
        delta_tokens: 20,
        input_tokens: 15,
        output_tokens: 5,
      });

      rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'codex', session_id: 'overcount' });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.total_tokens >= 0));
    assert.equal(rows.reduce((sum, row) => sum + row.total_tokens, 0), 0);
    assert.ok(rows.some((row) => row.token_reconciled === 1));
  } finally {
    tmp.cleanup();
  }
});

test('repairMissingProjectAttribution backfills session repo metadata and rebuilds git facts', () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    const nestedCwd = path.join(repoRoot, 'subdir', 'deep');
    initGitRepo(repoRoot);
    fs.mkdirSync(nestedCwd, { recursive: true });
    const expectedRepoRoot = fs.realpathSync(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'codex',
        session_id: 'repair-metadata',
        started_at: '2026-05-10T19:00:00.000Z',
        ended_at: '2026-05-10T19:05:00.000Z',
        cwd: nestedCwd,
        repo_root: null,
        repo_common_dir: null,
        parent_repo: null,
        branch: 'main',
        branch_resolution_tier: 'D',
        confidence: 'unattributed',
        model: 'gpt-5.4',
        total_tokens: 11,
        total_cost_usd: 0.11,
        last_observed_at: '2026-05-10T19:05:00.000Z',
        cost_estimated: 0,
        cost_quality: 'stored',
      });
    } finally {
      db.close();
    }

    const repaired = repairMissingProjectAttribution(tmp.dbPath);
    assert.equal(repaired, 1);

    const checkDb = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const session = checkDb
        .prepare(
          'SELECT repo_root, repo_common_dir, parent_repo FROM vibedeck_sessions WHERE provider = ? AND session_id = ?',
        )
        .get('codex', 'repair-metadata');
      assert.equal(session.repo_root, expectedRepoRoot);
      assert.ok(typeof session.repo_common_dir === 'string' && session.repo_common_dir.trim() !== '');

      const fact = checkDb
        .prepare(
          "SELECT project_state, repo_root FROM vibedeck_branch_usage_facts WHERE provider = 'codex' AND session_id = 'repair-metadata'",
        )
        .get();
      assert.ok(fact);
      assert.equal(fact.project_state, 'git_existing');
      assert.equal(fact.repo_root, expectedRepoRoot);
    } finally {
      checkDb.close();
    }
  } finally {
    tmp.cleanup();
  }
});
