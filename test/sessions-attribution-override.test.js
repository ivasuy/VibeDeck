const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const cp = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { DatabaseSync } = require('node:sqlite');
const { upsertOverride, clearOverride } = require('../src/lib/sessions/overrides');
const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');

async function runCli(args, { env } = {}) {
  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'vibedeck.js'), ...args], {
    env: { ...process.env, ...(env || {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (c) => (stdout += c));
  child.stderr.on('data', (c) => (stderr += c));

  const [code] = await once(child, 'close');
  return { code, stdout, stderr };
}

function insertSession(dbPath, { provider, session_id } = {}) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        @provider, @session_id, '2026-05-09T00:00:00.000Z', NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, 'D', 'unattributed', NULL,
        NULL, 0, 0.0,
        '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z'
      );`,
    ).run({ provider, session_id });
  } finally {
    db.close();
  }
}

test('override row forces resolver to OVERRIDE tier', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-override-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  insertSession(dbPath, { provider: 'claude', session_id: 's1' });
  await upsertOverride(dbPath, { provider: 'claude', session_id: 's1', branch: 'feature/x', set_by: 'cli' });

  const res = await resolveBranchForSession({
    provider: 'claude',
    session_id: 's1',
    repo_root: null,
    started_at: '2026-05-09T00:00:00.000Z',
    ended_at: null,
    dbPath,
  });
  assert.deepEqual(res, { branch: 'feature/x', tier: 'OVERRIDE', confidence: 'high' });

  await fs.rm(root, { recursive: true, force: true });
});

test('upsertOverride is idempotent and updates set_at', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-override-idem-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  insertSession(dbPath, { provider: 'codex', session_id: 's2' });

  await upsertOverride(dbPath, { provider: 'codex', session_id: 's2', branch: 'main', set_by: 'cli' });
  const db = new DatabaseSync(dbPath);
  let first;
  try {
    first = db
      .prepare('SELECT * FROM vibedeck_attribution_overrides WHERE provider = ? AND session_id = ?')
      .get('codex', 's2');
  } finally {
    db.close();
  }
  assert.equal(first.branch, 'main');
  assert.equal(first.set_by, 'cli');

  await new Promise((r) => setTimeout(r, 5));
  await upsertOverride(dbPath, { provider: 'codex', session_id: 's2', branch: 'main', set_by: 'cli' });

  const db2 = new DatabaseSync(dbPath);
  let second;
  try {
    second = db2
      .prepare('SELECT * FROM vibedeck_attribution_overrides WHERE provider = ? AND session_id = ?')
      .get('codex', 's2');
  } finally {
    db2.close();
  }
  assert.equal(second.branch, 'main');
  assert.equal(second.set_by, 'cli');
  assert.notEqual(second.set_at, first.set_at);

  await fs.rm(root, { recursive: true, force: true });
});

test('clearOverride removes row and resolver falls back to tier logic', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-override-clear-'));
  const trackerDir = path.join(root, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  insertSession(dbPath, { provider: 'codex', session_id: 's3' });
  await upsertOverride(dbPath, { provider: 'codex', session_id: 's3', branch: 'main', set_by: 'cli' });
  await clearOverride(dbPath, { provider: 'codex', session_id: 's3' });

  const res = await resolveBranchForSession({
    provider: 'codex',
    session_id: 's3',
    repo_root: null,
    started_at: '2026-05-09T00:00:00.000Z',
    ended_at: null,
    dbPath,
  });
  assert.equal(res.tier, 'D');
  assert.equal(res.confidence, 'unattributed');

  await fs.rm(root, { recursive: true, force: true });
});

test('CLI: unknown session id exits non-zero with session not found message', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-override-cli-unknown-'));
  const home = root;
  const trackerDir = path.join(home, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  const result = await runCli(['attribute', '--session', 'nope', '--provider', 'claude', '--branch', 'foo'], {
    env: { HOME: home },
  });
  assert.notEqual(result.code, 0);
  assert.match((result.stderr || result.stdout).toLowerCase(), /session not found/);

  await fs.rm(root, { recursive: true, force: true });
});

test('CLI: --clear removes override end-to-end', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-override-cli-clear-'));
  const home = root;
  const trackerDir = path.join(home, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  ensureSchema(dbPath);

  insertSession(dbPath, { provider: 'claude', session_id: 's4' });
  await upsertOverride(dbPath, { provider: 'claude', session_id: 's4', branch: 'foo', set_by: 'cli' });

  const cleared = await runCli(['attribute', '--session', 's4', '--provider', 'claude', '--clear'], {
    env: { HOME: home },
  });
  assert.equal(cleared.code, 0);

  const db = new DatabaseSync(dbPath);
  let row;
  try {
    row = db
      .prepare('SELECT * FROM vibedeck_attribution_overrides WHERE provider = ? AND session_id = ?')
      .get('claude', 's4');
  } finally {
    db.close();
  }
  assert.equal(row, undefined);

  await fs.rm(root, { recursive: true, force: true });
});
