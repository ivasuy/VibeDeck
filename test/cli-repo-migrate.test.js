const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cli-repo-'));
  fs.mkdirSync(path.join(home, '.vibedeck'), { recursive: true });
  return home;
}

function dbPathFor(home) {
  return path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
}

function seedDb(home, { repoRoot } = {}) {
  const dbPath = dbPathFor(home);
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO vibedeck_sessions(
      provider, session_id, started_at, ended_at, end_reason, cwd, repo_root, repo_common_dir,
      parent_repo, branch, branch_resolution_tier, confidence, override_user, model,
      total_tokens, total_cost_usd, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    'codex',
    's1',
    now,
    null,
    null,
    repoRoot,
    repoRoot,
    repoRoot,
    null,
    'main',
    'repo_root',
    'high',
    null,
    null,
    0,
    0,
    now,
    now,
  );
  db.prepare('INSERT INTO vibedeck_repos(repo_root, entire_state) VALUES (?, ?)').run(repoRoot, 'unknown');
  db.prepare(
    'INSERT INTO vibedeck_head_history(repo_root, worktree_root, transitioned_at, ref_name) VALUES (?, ?, ?, ?)',
  ).run(repoRoot, repoRoot, now, 'refs/heads/main');
  db.close();
}

function runCli(args, env) {
  return cp.spawnSync(process.execPath, ['bin/vibedeck.js', ...args], { env, encoding: 'utf8' });
}

function getRepoRoots(home) {
  const db = new DatabaseSync(dbPathFor(home));
  const sessions = db.prepare('SELECT repo_root FROM vibedeck_sessions ORDER BY session_id').all();
  const repos = db.prepare('SELECT repo_root FROM vibedeck_repos ORDER BY repo_root').all();
  const heads = db.prepare('SELECT repo_root FROM vibedeck_head_history ORDER BY transitioned_at').all();
  db.close();
  return {
    sessions: sessions.map((r) => r.repo_root),
    repos: repos.map((r) => r.repo_root),
    heads: heads.map((r) => r.repo_root),
  };
}

test('vibedeck repo migrate /old /new updates vibedeck_sessions.repo_root for matching rows', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  seedDb(home, { repoRoot: '/old' });

  const r = runCli(['repo', 'migrate', '/old', '/new'], env);
  assert.strictEqual(r.status, 0, r.stderr);

  const roots = getRepoRoots(home);
  assert.deepStrictEqual(roots.sessions, ['/new']);
});

test('vibedeck repo migrate also updates vibedeck_repos and vibedeck_head_history', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  seedDb(home, { repoRoot: '/old' });

  const r = runCli(['repo', 'migrate', '/old', '/new'], env);
  assert.strictEqual(r.status, 0, r.stderr);

  const roots = getRepoRoots(home);
  assert.deepStrictEqual(roots.repos, ['/new']);
  assert.deepStrictEqual(roots.heads, ['/new']);
});

test('vibedeck repo migrate with non-matching old-path is a no-op (0 rows updated)', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  seedDb(home, { repoRoot: '/something-else' });

  const r = runCli(['repo', 'migrate', '/old', '/new'], env);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Updated 0 row\(s\)\./);

  const roots = getRepoRoots(home);
  assert.deepStrictEqual(roots.sessions, ['/something-else']);
  assert.deepStrictEqual(roots.repos, ['/something-else']);
  assert.deepStrictEqual(roots.heads, ['/something-else']);
});

test('vibedeck repo migrate exits 1 if either path is not absolute', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  seedDb(home, { repoRoot: '/old' });

  const r = runCli(['repo', 'migrate', 'old', '/new'], env);
  assert.strictEqual(r.status, 1);
});

