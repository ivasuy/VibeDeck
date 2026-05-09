'use strict';

const execa = require('execa');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;
const CHECKPOINT_BRANCH = 'entire/checkpoints/v1';
const _treeCache = new Map();
let _gitListCalls = 0;
const KNOWN_AGENTS = new Set([
  'claude-code',
  'codex',
  'gemini',
  'opencode',
  'cursor',
  'factoryai-droid',
  'copilot-cli',
]);
const CHECKPOINT_ID_RE = /^[a-f0-9]{12}$/;

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

async function listCheckpointsCached(repoRoot) {
  const tip = await getCheckpointsBranchTip(repoRoot);
  if (!tip) return { available: false, reason: 'branch_not_fetched' };
  const key = `${repoRoot}|${tip}`;
  if (_treeCache.has(key)) {
    return { available: true, files: _treeCache.get(key), tip, cached: true };
  }
  _gitListCalls += 1;
  const result = await listCheckpoints(repoRoot);
  if (result.available) {
    _treeCache.set(key, result.files);
    result.tip = tip;
  }
  return result;
}

function _resetCheckpointCacheForTests() {
  _treeCache.clear();
  _gitListCalls = 0;
}

function _getInternalStats() {
  return { gitListCalls: _gitListCalls, cacheSize: _treeCache.size };
}

function validateAgentName(name) {
  if (typeof name !== 'string' || !KNOWN_AGENTS.has(name)) {
    throw new Error(
      `Invalid agent name: ${name}. Allowed: ${Array.from(KNOWN_AGENTS).join(', ')}`,
    );
  }
}

async function validateBranchName(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid branch name: ${name}`);
  }
  try {
    await execa('git', ['check-ref-format', '--branch', name], { timeout: 3000 });
  } catch {
    throw new Error(`Invalid branch name (git check-ref-format): ${name}`);
  }
}

function _validateArgvStrings(args, { name } = {}) {
  if (!Array.isArray(args)) throw new Error(`${name || 'args'} must be an array`);
  for (const a of args) {
    if (typeof a !== 'string' || a.length === 0 || a.includes('\0')) {
      throw new Error(`Invalid ${name || 'args'} value: ${String(a)}`);
    }
  }
}

async function _runEntire(args, { cwd, timeoutMs = 30000 } = {}) {
  _validateArgvStrings(args, { name: 'args' });
  try {
    const r = await execa('entire', args, { cwd, timeout: timeoutMs, reject: false });
    return { exitCode: r.exitCode, stdout: String(r.stdout), stderr: String(r.stderr) };
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err.shortMessage || err.message) };
  }
}

async function enableEntire(repoRoot, agents = []) {
  if (!Array.isArray(agents)) throw new Error('enableEntire: agents must be an array');
  const args = ['enable'];
  for (const a of agents) {
    validateAgentName(a);
    args.push('--agent', a);
  }
  return _runEntire(args, { cwd: repoRoot });
}

async function disableEntire(repoRoot) {
  return _runEntire(['disable'], { cwd: repoRoot });
}

async function entireAgentAdd(repoRoot, agent) {
  validateAgentName(agent);
  return _runEntire(['agent', 'add', agent], { cwd: repoRoot });
}

async function entireAgentRemove(repoRoot, agent) {
  validateAgentName(agent);
  return _runEntire(['agent', 'remove', agent], { cwd: repoRoot });
}

async function entireStatus(repoRoot) {
  return _runEntire(['status'], { cwd: repoRoot });
}

async function entireConfigure(repoRoot, args = []) {
  _validateArgvStrings(args, { name: 'configure args' });
  return _runEntire(['configure', ...args], { cwd: repoRoot });
}

function validateCheckpointId(id) {
  if (!CHECKPOINT_ID_RE.test(id)) {
    throw new Error(`Invalid checkpoint id (expected 12 lowercase hex chars): ${id}`);
  }
}

function _checkConfirmToken(token, opName) {
  if (typeof token !== 'string' || token.length === 0) {
    throw new Error(`${opName} requires a confirm token; refusing to run without one`);
  }
  // Placeholder until Plan 4 wires local-auth tokens.
  console.warn(
    `[vibedeck] WARN: ${opName} accepted placeholder confirm token (Plan 4 wires real auth)`,
  );
}

async function rewindCheckpoint(repoRoot, checkpointId, confirmToken) {
  validateCheckpointId(checkpointId);
  _checkConfirmToken(confirmToken, 'rewindCheckpoint');
  return _runEntire(['checkpoint', 'rewind', '--id', checkpointId], { cwd: repoRoot });
}

async function cleanEntire(repoRoot, confirmToken, { all = false } = {}) {
  _checkConfirmToken(confirmToken, 'cleanEntire');
  const args = ['clean', '--force'];
  if (all) args.push('--all');
  return _runEntire(args, { cwd: repoRoot });
}

module.exports = {
  detectEntire,
  _resetEntireCacheForTests,
  listCheckpoints,
  readCheckpoint,
  getCheckpointsBranchTip,
  listCheckpointsCached,
  _resetCheckpointCacheForTests,
  _getInternalStats,
  validateAgentName,
  validateBranchName,
  enableEntire,
  disableEntire,
  entireAgentAdd,
  entireAgentRemove,
  entireStatus,
  entireConfigure,
  validateCheckpointId,
  rewindCheckpoint,
  cleanEntire,
};
