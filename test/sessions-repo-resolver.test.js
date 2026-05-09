const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sync: execaSync } = require('execa');

const { resolveRepo } = require('../src/lib/sessions/repo-resolver');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args) {
  return execaSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
}

test('cwd inside repo: returns realpath of toplevel', () => {
  const dir = tmpDir('vd-repo-ok-');
  try {
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'init']);
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    const res = resolveRepo(path.join(dir, 'a', 'b'));
    assert.equal(res.status, 'ok');
    assert.equal(res.repo_root, fs.realpathSync(dir));
    assert.ok(typeof res.repo_common_dir === 'string' && res.repo_common_dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cwd outside any git repo: status=not_in_repo, repo_root=null', () => {
  const dir = tmpDir('vd-repo-none-');
  try {
    const res = resolveRepo(dir);
    assert.equal(res.status, 'not_in_repo');
    assert.equal(res.repo_root, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('symlinked cwd resolves to physical repo root', () => {
  const dir = tmpDir('vd-repo-symlink-');
  const linkDir = tmpDir('vd-repo-symlink-link-');
  try {
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'init']);
    const target = path.join(dir, 'sub');
    fs.mkdirSync(target, { recursive: true });
    const link = path.join(linkDir, 'link');
    fs.symlinkSync(target, link);

    const res = resolveRepo(link);
    assert.equal(res.status, 'ok');
    assert.equal(res.repo_root, fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(linkDir, { recursive: true, force: true });
  }
});

test('worktree cwd: returns worktree root and shared common_dir', () => {
  const dir = tmpDir('vd-repo-worktree-');
  try {
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'init']);

    const wtDir = tmpDir('vd-repo-worktree-wt-');
    const worktreePath = path.join(wtDir, 'wt');
    git(dir, ['worktree', 'add', worktreePath]);

    const main = resolveRepo(dir);
    const wt = resolveRepo(worktreePath);
    assert.equal(wt.status, 'ok');
    assert.equal(wt.repo_root, fs.realpathSync(worktreePath));
    assert.equal(wt.repo_common_dir, main.repo_common_dir);

    fs.rmSync(wtDir, { recursive: true, force: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('submodule cwd: returns submodule root with parent_repo set', () => {
  const dir = tmpDir('vd-repo-submodule-');
  const sub = tmpDir('vd-repo-submodule-child-');
  try {
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'init']);

    git(sub, ['init']);
    fs.writeFileSync(path.join(sub, 'sub.txt'), 'y');
    git(sub, ['add', '.']);
    git(sub, ['commit', '-m', 'sub']);

    git(dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', sub, 'modules/sub']);

    const subPath = path.join(dir, 'modules', 'sub');
    const res = resolveRepo(subPath);
    assert.equal(res.status, 'ok');
    assert.equal(res.repo_root, fs.realpathSync(subPath));
    assert.equal(res.parent_repo, fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(sub, { recursive: true, force: true });
  }
});

test('bare repo: status=bare', () => {
  const dir = tmpDir('vd-repo-bare-');
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    git(path.dirname(dir), ['init', '--bare', dir]);
    const res = resolveRepo(dir);
    assert.equal(res.status, 'bare');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('zero-commit repo: status=zero_commits', () => {
  const dir = tmpDir('vd-repo-zero-');
  try {
    git(dir, ['init']);
    const res = resolveRepo(dir);
    assert.equal(res.status, 'zero_commits');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cwd is .git directory itself: status=inside_dot_git', () => {
  const dir = tmpDir('vd-repo-dotgit-');
  try {
    git(dir, ['init']);
    const res = resolveRepo(path.join(dir, '.git'));
    assert.equal(res.status, 'inside_dot_git');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cwd was deleted between session and query: status=cwd_missing', () => {
  const dir = tmpDir('vd-repo-missing-');
  fs.rmSync(dir, { recursive: true, force: true });
  const res = resolveRepo(dir);
  assert.equal(res.status, 'cwd_missing');
});

test('two parent dirs with same name resolve to distinct repos via realpath', () => {
  const a = tmpDir('vd-repo-same-');
  const b = tmpDir('vd-repo-same-');
  try {
    git(a, ['init']);
    git(b, ['init']);
    fs.writeFileSync(path.join(a, 'a.txt'), 'a');
    git(a, ['add', '.']);
    git(a, ['commit', '-m', 'a']);
    fs.writeFileSync(path.join(b, 'b.txt'), 'b');
    git(b, ['add', '.']);
    git(b, ['commit', '-m', 'b']);

    const ra = resolveRepo(a);
    const rb = resolveRepo(b);
    assert.equal(ra.status, 'ok');
    assert.equal(rb.status, 'ok');
    assert.notEqual(ra.repo_root, rb.repo_root);
  } finally {
    fs.rmSync(a, { recursive: true, force: true });
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('detached HEAD: repo_root resolves; branch handling deferred', () => {
  const dir = tmpDir('vd-repo-detached-');
  try {
    git(dir, ['init']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'init']);
    const sha = git(dir, ['rev-parse', 'HEAD']).stdout.trim();
    git(dir, ['checkout', sha]);

    const res = resolveRepo(dir);
    assert.equal(res.status, 'ok');
    assert.equal(res.repo_root, fs.realpathSync(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
