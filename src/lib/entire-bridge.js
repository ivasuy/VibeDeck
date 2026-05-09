'use strict';

const execa = require('execa');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;
const CHECKPOINT_BRANCH = 'entire/checkpoints/v1';

async function detectEntire({ timeoutMs = 5000 } = {}) {
  const now = Date.now();
  if (cache && now - cache.stamp < CACHE_TTL_MS) return cache.result;

  let result;
  try {
    const { stdout } = await execa('entire', ['version'], { timeout: timeoutMs });
    const raw = String(stdout).trim();
    const m = raw.match(/\b(\d+\.\d+\.\d+(?:[^\s]*)?(?:\s*\\([^)]+\\))?)/);
    result = { present: true, version: m ? m[1].trim() : raw };
  } catch {
    result = { present: false, version: null };
  }

  cache = { result, stamp: now };
  return result;
}

function _resetEntireCacheForTests() {
  cache = null;
}

async function _branchExists(repoRoot, branchName) {
  try {
    await execa(
      'git',
      ['-C', repoRoot, 'rev-parse', '--verify', `refs/heads/${branchName}`],
      { timeout: 5000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function listCheckpoints(repoRoot) {
  if (!(await _branchExists(repoRoot, CHECKPOINT_BRANCH))) {
    return { available: false, reason: 'branch_not_fetched' };
  }
  try {
    const { stdout } = await execa(
      'git',
      ['-C', repoRoot, 'ls-tree', '-r', '--name-only', CHECKPOINT_BRANCH],
      { timeout: 10000 },
    );
    const files = stdout.trim() ? stdout.trim().split('\n') : [];
    return { available: true, files };
  } catch (err) {
    return {
      available: false,
      reason: 'git_error',
      detail: String(err.shortMessage || err.message),
    };
  }
}

async function readCheckpoint(repoRoot, filePath) {
  if (
    typeof filePath !== 'string' ||
    filePath.includes('\0') ||
    filePath.startsWith('/') ||
    filePath.split('/').includes('..')
  ) {
    throw new Error(`readCheckpoint: invalid filePath: ${filePath}`);
  }
  const { stdout } = await execa(
    'git',
    ['-C', repoRoot, 'show', `${CHECKPOINT_BRANCH}:${filePath}`],
    { timeout: 5000 },
  );
  return JSON.parse(stdout);
}

async function getCheckpointsBranchTip(repoRoot) {
  try {
    const { stdout } = await execa(
      'git',
      ['-C', repoRoot, 'rev-parse', CHECKPOINT_BRANCH],
      { timeout: 5000 },
    );
    return stdout.trim();
  } catch {
    return null;
  }
}

module.exports = {
  detectEntire,
  _resetEntireCacheForTests,
  listCheckpoints,
  readCheckpoint,
  getCheckpointsBranchTip,
};
