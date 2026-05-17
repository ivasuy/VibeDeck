'use strict';

const execa = require('execa');
const fs = require('node:fs');
const path = require('node:path');

const { normalizeCheckpointPath, isValidCheckpointPath } = require('./entire-checkpoint-paths');
const { resolveTrackerPaths } = require('./tracker-paths');
const { upsertEntireState } = require('./db/repos');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;
const CHECKPOINT_BRANCH = 'entire/checkpoints/v1';
const TREE_CACHE_MAX = 100;
const _treeCache = new Map();
function _treeCacheSet(key, value) {
  if (_treeCache.has(key)) _treeCache.delete(key);
  else if (_treeCache.size >= TREE_CACHE_MAX) {
    const oldestKey = _treeCache.keys().next().value;
    _treeCache.delete(oldestKey);
  }
  _treeCache.set(key, value);
}
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
  const checkpointPath = normalizeCheckpointPath(filePath);
  if (!isValidCheckpointPath(filePath)) {
    throw new Error(`readCheckpoint: invalid filePath: ${filePath}`);
  }
  const { stdout } = await execa(
    'git',
    ['-C', repoRoot, 'show', `${CHECKPOINT_BRANCH}:${checkpointPath}`],
    { timeout: 5000 },
  );
  return buildCheckpointPayload(checkpointPath, stdout);
}

function checkpointKind(filePath) {
  const name = path.basename(filePath);
  if (name === 'content_hash.txt') return 'hash';
  if (name.endsWith('.jsonl')) return 'jsonl';
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.txt')) return 'text';
  return 'unknown';
}

function lineCount(raw) {
  const text = String(raw || '');
  if (!text) return 0;
  return text.replace(/\n$/, '').split(/\r?\n/).length;
}

function parseHash(raw) {
  const text = String(raw || '').trim();
  const idx = text.indexOf(':');
  if (idx === -1) return { algorithm: null, value: text };
  return { algorithm: text.slice(0, idx), value: text.slice(idx + 1) };
}

function parseJsonl(raw, { previewLimit = 50 } = {}) {
  const text = String(raw || '');
  const lines = text.split(/\r?\n/);
  const preview = [];
  let validLines = 0;
  let invalidLines = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      validLines += 1;
      if (preview.length < previewLimit) preview.push({ line: i + 1, value });
    } catch (err) {
      invalidLines += 1;
      if (preview.length < previewLimit) {
        preview.push({ line: i + 1, error: err?.message || String(err), raw: line });
      }
    }
  }

  return { valid_lines: validLines, invalid_lines: invalidLines, preview };
}

function buildCheckpointPayload(filePath, raw) {
  const kind = checkpointKind(filePath);
  const payload = {
    path: filePath,
    file_name: path.basename(filePath),
    extension: path.extname(filePath).replace(/^\./, ''),
    kind,
    raw,
    parsed: null,
    parse_error: null,
    size_bytes: Buffer.byteLength(String(raw || ''), 'utf8'),
    line_count: lineCount(raw),
  };

  if (kind === 'json') {
    try {
      payload.parsed = JSON.parse(raw);
    } catch (err) {
      payload.parse_error = err?.message || String(err);
    }
    return payload;
  }

  if (kind === 'jsonl') {
    payload.parsed = parseJsonl(raw);
    return payload;
  }

  if (kind === 'hash') {
    payload.parsed = parseHash(raw);
    return payload;
  }

  return payload;
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
    _treeCacheSet(key, result.files);
    result.tip = tip;
  }
  return result;
}

function _resetCheckpointCacheForTests() {
  _treeCache.clear();
  _gitListCalls = 0;
}

function _setTreeCacheForTests(key, value) {
  _treeCacheSet(key, value);
}

function _hasTreeCacheKeyForTests(key) {
  return _treeCache.has(key);
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
    const exitCode = Number.isInteger(r.exitCode)
      ? r.exitCode
      : Number.isInteger(r.code)
        ? r.code
        : 0;
    return { exitCode, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') };
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

async function entireDoctor(repoRoot) {
  return _runEntire(['doctor'], { cwd: repoRoot });
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
  _checkConfirmToken(confirmToken, 'rewindCheckpoint');
  validateCheckpointId(checkpointId);
  return _runEntire(['checkpoint', 'rewind', '--id', checkpointId], { cwd: repoRoot });
}

async function cleanEntire(repoRoot, confirmToken, { all = false } = {}) {
  _checkConfirmToken(confirmToken, 'cleanEntire');
  const args = ['clean', '--force'];
  if (all) args.push('--all');
  return _runEntire(args, { cwd: repoRoot });
}

async function _getDbPath() {
  const { trackerDir } = await resolveTrackerPaths();
  return path.join(trackerDir, 'vibedeck.sqlite3');
}

async function getEntireRepoStatus(
  repoRoot,
  {
    persist = true,
    dbPathOverride = null,
    dbPathOverrideForTests = null,
    detectionOverrideForTests = null,
    checkpointsTipOverrideForTests,
  } = {},
) {
  const detection = detectionOverrideForTests || (await detectEntire());
  const dbPath = dbPathOverride || dbPathOverrideForTests || (await _getDbPath());

  if (!detection.present) {
    if (persist) upsertEntireState(dbPath, { repoRoot, entire_state: 'not_installed' });
    return { state: 'not_installed' };
  }

  const settingsPath = path.join(repoRoot, '.entire', 'settings.json');
  let enabled = false;
  if (fs.existsSync(settingsPath)) {
    try {
      const json = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      enabled = json.enabled !== false;
    } catch {
      enabled = false;
    }
  }

  if (!enabled) {
    if (persist) {
      upsertEntireState(dbPath, {
        repoRoot,
        entire_state: 'not_enabled',
        entire_version: detection.version,
      });
    }
    return { state: 'not_enabled', version: detection.version };
  }

  const tip =
    typeof checkpointsTipOverrideForTests === 'string'
      ? checkpointsTipOverrideForTests
      : await getCheckpointsBranchTip(repoRoot);

  if (!tip) {
    if (persist) {
      upsertEntireState(dbPath, {
        repoRoot,
        entire_state: 'enabled_no_commits',
        entire_version: detection.version,
      });
    }
    return { state: 'enabled_no_commits', version: detection.version };
  }

  if (persist) {
    upsertEntireState(dbPath, {
      repoRoot,
      entire_state: 'active',
      entire_version: detection.version,
    });
  }
  return { state: 'active', version: detection.version, checkpoint_branch_tip: tip };
}

module.exports = {
  detectEntire,
  _resetEntireCacheForTests,
  listCheckpoints,
  readCheckpoint,
  getCheckpointsBranchTip,
  listCheckpointsCached,
  _resetCheckpointCacheForTests,
  _setTreeCacheForTests,
  _hasTreeCacheKeyForTests,
  _getInternalStats,
  validateAgentName,
  validateBranchName,
  enableEntire,
  disableEntire,
  entireAgentAdd,
  entireAgentRemove,
  entireStatus,
  entireDoctor,
  entireConfigure,
  validateCheckpointId,
  rewindCheckpoint,
  cleanEntire,
  getEntireRepoStatus,
};
