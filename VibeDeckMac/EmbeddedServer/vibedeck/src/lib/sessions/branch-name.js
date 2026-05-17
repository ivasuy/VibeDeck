'use strict';

const SENTINEL_BRANCHES = new Set(['unknown branch', 'no branch', 'unattributed']);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeBranchName(value) {
  let branch = text(value);
  if (!branch) return null;

  if (SENTINEL_BRANCHES.has(branch.toLowerCase())) return null;

  if (branch.startsWith('refs/heads/')) {
    branch = branch.slice('refs/heads/'.length);
  } else if (branch.startsWith('refs/tags/')) {
    branch = `tags/${branch.slice('refs/tags/'.length)}`;
  } else if (branch.startsWith('refs/remotes/')) {
    branch = branch.slice('refs/remotes/'.length);
    const slash = branch.indexOf('/');
    if (slash >= 0) branch = branch.slice(slash + 1);
  } else if (branch.startsWith('remotes/')) {
    branch = branch.slice('remotes/'.length);
    const slash = branch.indexOf('/');
    if (slash >= 0) branch = branch.slice(slash + 1);
  } else if (branch.startsWith('origin/') && branch.length > 'origin/'.length) {
    branch = branch.slice('origin/'.length);
  }

  if (!branch.startsWith('tags/')) {
    branch = branch.replace(/~\d+$/, '');
  }

  branch = text(branch);
  if (!branch || SENTINEL_BRANCHES.has(branch.toLowerCase())) return null;
  return branch;
}

module.exports = { normalizeBranchName };
