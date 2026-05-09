const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-head-history-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fetchAllHistory(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare('SELECT repo_root, worktree_root, transitioned_at, ref_name FROM vibedeck_head_history ORDER BY transitioned_at ASC')
      .all();
  } finally {
    db.close();
  }
}

test('recordTransition stores realpath repo_root/worktree_root and duplicates are ignored', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-repo-real-'));
    const link = path.join(os.tmpdir(), `vibedeck-repo-link-${Date.now()}`);
    fs.symlinkSync(real, link, 'dir');

    const { recordTransition, findBranchAt } = require('../src/lib/sessions/head-history');
    recordTransition(tmp.dbPath, {
      repo_root: link,
      worktree_root: link,
      ref_name: 'refs/heads/main',
      transitioned_at: '2026-05-09T10:00:00.000Z',
    });
    recordTransition(tmp.dbPath, {
      repo_root: link,
      worktree_root: link,
      ref_name: 'refs/heads/main',
      transitioned_at: '2026-05-09T10:00:00.000Z',
    });

    const rows = fetchAllHistory(tmp.dbPath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].repo_root, fs.realpathSync(real));
    assert.equal(rows[0].worktree_root, fs.realpathSync(real));

    const r = findBranchAt(tmp.dbPath, { worktree_root: link, when: '2026-05-09T10:00:00.000Z' });
    assert.equal(r, 'refs/heads/main');

    fs.unlinkSync(link);
    fs.rmSync(real, { recursive: true, force: true });
  } finally {
    tmp.cleanup();
  }
});

test('findBranchAt returns latest ref at or before time; past lookups return deleted/renamed names', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const { recordTransition, findBranchAt } = require('../src/lib/sessions/head-history');
    recordTransition(tmp.dbPath, {
      repo_root: '/repo',
      worktree_root: '/repo',
      ref_name: 'refs/heads/topic',
      transitioned_at: '2026-05-09T10:00:00.000Z',
    });
    recordTransition(tmp.dbPath, {
      repo_root: '/repo',
      worktree_root: '/repo',
      ref_name: 'refs/heads/main',
      transitioned_at: '2026-05-09T10:10:00.000Z',
    });

    assert.equal(findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T10:05:00.000Z' }), 'refs/heads/topic');
    assert.equal(findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T10:11:00.000Z' }), 'refs/heads/main');
    assert.equal(findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T09:59:59.000Z' }), null);
  } finally {
    tmp.cleanup();
  }
});

test('ring buffer cap (1000) evicts oldest; DB fallback still answers after module reload', () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require('../src/lib/db');
    ensureSchema(tmp.dbPath);

    const mod1 = require('../src/lib/sessions/head-history');
    for (let i = 0; i < 1001; i += 1) {
      const iso = `2026-05-09T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000Z`;
      mod1.recordTransition(tmp.dbPath, {
        repo_root: '/repo',
        worktree_root: '/repo',
        ref_name: `refs/heads/b${i}`,
        transitioned_at: iso,
      });
    }

    assert.equal(mod1.findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T10:00:00.000Z' }), null);
    assert.equal(mod1.findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T10:00:01.000Z' }), 'refs/heads/b1');

    delete require.cache[require.resolve('../src/lib/sessions/head-history')];
    const mod2 = require('../src/lib/sessions/head-history');
    assert.equal(mod2.findBranchAt(tmp.dbPath, { worktree_root: '/repo', when: '2026-05-09T10:00:01.000Z' }), 'refs/heads/b1');
  } finally {
    tmp.cleanup();
  }
});
