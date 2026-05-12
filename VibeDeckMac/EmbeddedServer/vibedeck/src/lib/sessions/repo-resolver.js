'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { sync: execaSync } = require('execa');

function nullResult(status) {
  return { repo_root: null, repo_common_dir: null, parent_repo: null, status };
}

function includesDotGitSegment(p) {
  if (typeof p !== 'string' || !p) return false;
  const normalized = p.replace(/[\\/]+/g, path.sep);
  const parts = normalized.split(path.sep).filter(Boolean);
  return parts.includes('.git');
}

function gitTry(cwd, args) {
  try {
    return { ok: true, out: execaSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).stdout };
  } catch (e) {
    const stderr = typeof e?.stderr === 'string' ? e.stderr : '';
    const stdout = typeof e?.stdout === 'string' ? e.stdout : '';
    const msg = typeof e?.message === 'string' ? e.message : '';
    return { ok: false, err: `${stderr}\n${stdout}\n${msg}`.trim() };
  }
}

function resolveRepo(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') {
    throw new TypeError('resolveRepo: cwd must be a non-empty string');
  }

  if (includesDotGitSegment(cwd)) {
    return nullResult('inside_dot_git');
  }

  let realCwd;
  try {
    realCwd = fs.realpathSync(cwd);
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      return nullResult('cwd_missing');
    }
    throw e;
  }

  if (includesDotGitSegment(realCwd)) {
    return nullResult('inside_dot_git');
  }

  const bare = gitTry(realCwd, ['rev-parse', '--is-bare-repository']);
  if (bare.ok && bare.out.trim() === 'true') {
    const common = gitTry(realCwd, ['rev-parse', '--git-common-dir']);
    const repo_root = realCwd;
    const repo_common_dir = common.ok ? fs.realpathSync(path.resolve(repo_root, common.out.trim())) : repo_root;
    return { repo_root, repo_common_dir, parent_repo: null, status: 'bare' };
  }

  const top = gitTry(realCwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) {
    const errLower = String(top.err || '').toLowerCase();
    if (errLower.includes('not a git repository')) return nullResult('not_in_repo');
    if (errLower.includes('inside') && errLower.includes('.git')) return nullResult('inside_dot_git');
    return nullResult('not_in_repo');
  }

  const repoRoot = top.out.trim();
  if (!repoRoot) return nullResult('not_in_repo');

  const repo_root = fs.realpathSync(repoRoot);

  const common = gitTry(realCwd, ['rev-parse', '--git-common-dir']);
  let repo_common_dir = null;
  if (common.ok && common.out.trim()) {
    const raw = common.out.trim();
    const abs = path.isAbsolute(raw) ? raw : path.resolve(realCwd, raw);
    repo_common_dir = fs.realpathSync(abs);
  } else {
    repo_common_dir = fs.realpathSync(path.join(repo_root, '.git'));
  }

  const superproj = gitTry(realCwd, ['rev-parse', '--show-superproject-working-tree']);
  const parent_repo = superproj.ok && superproj.out.trim() ? fs.realpathSync(superproj.out.trim()) : null;

  const count = gitTry(realCwd, ['rev-list', '--count', 'HEAD']);
  if (!count.ok) {
    const errLower = String(count.err || '').toLowerCase();
    if (errLower.includes('unknown revision') || errLower.includes('bad revision')) {
      return { repo_root, repo_common_dir, parent_repo, status: 'zero_commits' };
    }
  } else {
    const n = Number.parseInt(count.out.trim(), 10);
    if (!Number.isFinite(n) || n === 0) {
      return { repo_root, repo_common_dir, parent_repo, status: 'zero_commits' };
    }
  }

  return { repo_root, repo_common_dir, parent_repo, status: 'ok' };
}

module.exports = { resolveRepo };
