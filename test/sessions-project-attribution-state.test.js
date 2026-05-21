const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const { classifyProjectAttribution } = require('../src/lib/sessions/project-attribution-state');

function initGitRepo(repoRoot) {
  fs.mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repoRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });
}

test('classifies an existing git repo as a visible git project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-project-state-git-'));
  try {
    const repo = path.join(dir, 'repo');
    initGitRepo(repo);
    const state = classifyProjectAttribution({ cwd: repo, repo_root: repo });
    assert.equal(state.project_state, 'git_existing');
    assert.equal(state.default_visible, true);
    assert.equal(state.branch_kind, 'unknown_git');
    assert.equal(state.branch, 'Unknown branch');
    assert.equal(state.project_ref, fs.realpathSync(repo));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies an existing non-git folder as a visible local project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-project-state-nongit-'));
  try {
    const state = classifyProjectAttribution({ cwd: dir, repo_root: null });
    assert.equal(state.project_state, 'non_git_existing');
    assert.equal(state.default_visible, true);
    assert.equal(state.branch_kind, 'no_git');
    assert.equal(state.branch, 'No branch');
    assert.equal(state.project_key, path.basename(dir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('classifies a missing repo as archived git_missing', () => {
  const missing = path.join(os.tmpdir(), `vd-missing-repo-${Date.now()}`);
  const state = classifyProjectAttribution({ cwd: missing, repo_root: missing });
  assert.equal(state.project_state, 'git_missing');
  assert.equal(state.default_visible, false);
  assert.equal(state.branch_kind, 'unknown_git');
  assert.equal(state.branch, 'Unknown branch');
});

test('classifies a missing cwd-only path as archived cwd_missing', () => {
  const missing = path.join(os.tmpdir(), `vd-missing-cwd-${Date.now()}`);
  const state = classifyProjectAttribution({ cwd: missing, repo_root: null });
  assert.equal(state.project_state, 'cwd_missing');
  assert.equal(state.default_visible, false);
  assert.equal(state.branch_kind, 'no_git');
  assert.equal(state.branch, 'No branch');
});

test('classifies a session with no path evidence as unattributed', () => {
  const state = classifyProjectAttribution({ cwd: null, repo_root: null, provider: 'cursor', session_id: 's1' });
  assert.equal(state.project_state, 'unattributed');
  assert.equal(state.default_visible, false);
  assert.equal(state.branch_kind, 'unattributed');
  assert.equal(state.branch, 'Unattributed');
  assert.equal(state.scope_key, 'unattributed:cursor:s1');
});
