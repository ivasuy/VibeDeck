const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-head-watcher-db-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeTempRepoDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-head-watcher-repo-'));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function countHistoryRows(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT COUNT(*) AS n FROM vibedeck_head_history').get().n;
  } finally {
    db.close();
  }
}

function getLatestHistory(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (
      db
        .prepare('SELECT repo_root, worktree_root, transitioned_at, ref_name FROM vibedeck_head_history ORDER BY transitioned_at DESC LIMIT 1')
        .get() || null
    );
  } finally {
    db.close();
  }
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor timeout');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test('watcher records HEAD changes for a repo', { timeout: 20000 }, async () => {
  const tmp = makeTempDbPath();
  const repo = makeTempRepoDir();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const gitDir = path.join(repo.dir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

    const { startHeadWatcher, stopHeadWatcher } = require('../src/lib/sessions/head-watcher');
    const handle = startHeadWatcher({ dbPath: tmp.dbPath, repos: [{ repo_root: repo.dir }] });
    await handle.ready;
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/test\n');
    await waitFor(() => countHistoryRows(tmp.dbPath) >= 1, { timeoutMs: 15000 });

    const latest = getLatestHistory(tmp.dbPath);
    assert.ok(latest);
    assert.equal(latest.ref_name, 'refs/heads/feature/test');

    fs.writeFileSync(path.join(gitDir, 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
    await waitFor(() => {
      const r = getLatestHistory(tmp.dbPath);
      return r && r.ref_name === 'detached@0123456';
    }, { timeoutMs: 15000 });

    await stopHeadWatcher(handle);
  } finally {
    repo.cleanup();
    tmp.cleanup();
  }
});

test('polling fallback enabled when VIBEDECK_WATCHER_POLLING=1', { timeout: 20000 }, async () => {
  const tmp = makeTempDbPath();
  const repo = makeTempRepoDir();
  const prev = process.env.VIBEDECK_WATCHER_POLLING;
  process.env.VIBEDECK_WATCHER_POLLING = '1';
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const gitDir = path.join(repo.dir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

    const { startHeadWatcher, stopHeadWatcher } = require('../src/lib/sessions/head-watcher');
    const handle = startHeadWatcher({ dbPath: tmp.dbPath, repos: [{ repo_root: repo.dir }] });
    assert.equal(handle.usePolling, true);
    await handle.ready;
    await new Promise((r) => setTimeout(r, 100));

    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/poll\n');
    await waitFor(() => countHistoryRows(tmp.dbPath) >= 1, { timeoutMs: 15000 });

    await stopHeadWatcher(handle);
  } finally {
    if (prev == null) delete process.env.VIBEDECK_WATCHER_POLLING;
    else process.env.VIBEDECK_WATCHER_POLLING = prev;
    repo.cleanup();
    tmp.cleanup();
  }
});

test('registerActiveRepo adds repo at runtime and stopHeadWatcher stops recording', { timeout: 20000 }, async () => {
  const tmp = makeTempDbPath();
  const repo = makeTempRepoDir();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const gitDir = path.join(repo.dir, '.git');
    fs.mkdirSync(gitDir, { recursive: true });
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');

    const { startHeadWatcher, stopHeadWatcher, registerActiveRepo } = require('../src/lib/sessions/head-watcher');
    const handle = startHeadWatcher({ dbPath: tmp.dbPath, repos: [] });
    await handle.ready;

    registerActiveRepo(handle, { repo_root: repo.dir, worktree_root: repo.dir });
    await new Promise((r) => setTimeout(r, 100));
    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/dynamic\n');
    await waitFor(() => countHistoryRows(tmp.dbPath) >= 1, { timeoutMs: 15000 });

    const beforeStop = countHistoryRows(tmp.dbPath);
    await stopHeadWatcher(handle);

    fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/feature/after-stop\n');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(countHistoryRows(tmp.dbPath), beforeStop);
  } finally {
    repo.cleanup();
    tmp.cleanup();
  }
});
