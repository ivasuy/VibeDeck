'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveRepo } = require('./repo-resolver');

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeRealpath(value) {
  const input = text(value);
  if (!input) return null;
  try {
    return fs.realpathSync(input);
  } catch {
    return input;
  }
}

function pathExists(value) {
  const input = text(value);
  if (!input) return false;
  try {
    return fs.statSync(input).isDirectory();
  } catch {
    return false;
  }
}

function basenameLabel(value, fallback) {
  const input = text(value) || text(fallback) || 'unknown';
  return input.split(/[\\/]+/).filter(Boolean).pop() || input;
}

function repoProjectRef({ parent_repo, repo_common_dir, repo_root }) {
  const parent = text(parent_repo);
  if (parent) return safeRealpath(parent);
  const common = text(repo_common_dir);
  if (common && path.basename(common) === '.git') return safeRealpath(path.dirname(common));
  if (common) return safeRealpath(common);
  return safeRealpath(repo_root);
}

function classifyProjectAttribution(row = {}) {
  const provider = text(row.provider) || 'unknown';
  const sessionId = text(row.session_id) || 'unknown';
  const cwd = safeRealpath(row.cwd);
  const repoRoot = safeRealpath(row.repo_root);
  const repoCommonDir = safeRealpath(row.repo_common_dir);
  const parentRepo = safeRealpath(row.parent_repo);

  if (repoRoot) {
    const exists = pathExists(repoRoot);
    const projectRef = repoProjectRef({ parent_repo: parentRepo, repo_common_dir: repoCommonDir, repo_root: repoRoot }) || repoRoot;
    return {
      project_state: exists ? 'git_existing' : 'git_missing',
      default_visible: exists,
      scope_key: `git:${projectRef}`,
      project_key: basenameLabel(projectRef, repoRoot),
      project_ref: projectRef,
      cwd,
      repo_root: repoRoot,
      repo_common_dir: repoCommonDir,
      parent_repo: parentRepo,
      branch: 'Unknown branch',
      branch_kind: 'unknown_git',
    };
  }

  if (cwd) {
    if (!pathExists(cwd)) {
      return {
        project_state: 'cwd_missing',
        default_visible: false,
        scope_key: `cwd:${cwd}`,
        project_key: basenameLabel(cwd),
        project_ref: cwd,
        cwd,
        repo_root: null,
        repo_common_dir: null,
        parent_repo: null,
        branch: 'No branch',
        branch_kind: 'no_git',
      };
    }

    let resolved = null;
    try {
      resolved = resolveRepo(cwd);
    } catch {
      resolved = null;
    }
    if (resolved && resolved.repo_root) {
      const projectRef = repoProjectRef(resolved) || safeRealpath(resolved.repo_root);
      return {
        project_state: 'git_existing',
        default_visible: true,
        scope_key: `git:${projectRef}`,
        project_key: basenameLabel(projectRef, resolved.repo_root),
        project_ref: projectRef,
        cwd,
        repo_root: safeRealpath(resolved.repo_root),
        repo_common_dir: safeRealpath(resolved.repo_common_dir),
        parent_repo: safeRealpath(resolved.parent_repo),
        branch: 'Unknown branch',
        branch_kind: 'unknown_git',
      };
    }

    return {
      project_state: 'non_git_existing',
      default_visible: true,
      scope_key: `cwd:${cwd}`,
      project_key: basenameLabel(cwd),
      project_ref: cwd,
      cwd,
      repo_root: null,
      repo_common_dir: null,
      parent_repo: null,
      branch: 'No branch',
      branch_kind: 'no_git',
    };
  }

  return {
    project_state: 'unattributed',
    default_visible: false,
    scope_key: `unattributed:${provider}:${sessionId}`,
    project_key: 'Unattributed',
    project_ref: null,
    cwd: null,
    repo_root: null,
    repo_common_dir: null,
    parent_repo: null,
    branch: 'Unattributed',
    branch_kind: 'unattributed',
  };
}

module.exports = { classifyProjectAttribution };
