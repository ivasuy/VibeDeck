'use strict';

const fs = require('node:fs');

const { normalizeBranchName } = require('./branch-name');

const SUPPORTED_PROVIDERS = new Set(['codex', 'every-code', 'claude']);
const SENTINELS = new Set(['head', 'unknown branch', 'historical unknown', 'no branch', 'unattributed']);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function providerKey(provider) {
  return String(provider || '').trim().toLowerCase();
}

function isUnsafeBranchLabel(value) {
  if (!isNonEmptyString(value)) return true;
  const branch = value.trim();
  const lower = branch.toLowerCase();

  if (SENTINELS.has(lower)) return true;
  if (lower.startsWith('tags/')) return true;
  if (lower.startsWith('refs/tags/')) return true;
  if (lower.startsWith('origin/')) return true;
  if (lower.startsWith('remotes/')) return true;
  if (lower.startsWith('refs/remotes/')) return true;
  if (lower.startsWith('detached@')) return true;

  return false;
}

function cleanProviderBranch(raw) {
  if (isUnsafeBranchLabel(raw)) return null;
  const normalized = normalizeBranchName(raw);
  if (!normalized) return null;
  if (isUnsafeBranchLabel(normalized)) return null;
  return normalized;
}

function createProviderBranchState() {
  return { branches: new Set(), unsafe: false };
}

function createProviderBranchCache() {
  return {
    providerBranchBySession: new Map(),
    providerBranchEvidenceBySession: new Map(),
  };
}

function ensureState(state) {
  if (state && state.branches instanceof Set) return state;
  return createProviderBranchState();
}

function addBranchCandidate(raw, state) {
  const target = ensureState(state);
  if (raw === undefined || raw === null) return target;

  const cleaned = cleanProviderBranch(raw);
  if (!cleaned) {
    target.unsafe = true;
    return target;
  }

  target.branches.add(cleaned);
  return target;
}

function collectProviderBranchFromObject(provider, obj, state) {
  const target = ensureState(state);
  const key = providerKey(provider);
  if (!SUPPORTED_PROVIDERS.has(key)) return target;
  if (!obj || typeof obj !== 'object') return target;

  if ((key === 'codex' || key === 'every-code') && obj.payload && typeof obj.payload === 'object') {
    addBranchCandidate(obj.payload && obj.payload.git && obj.payload.git.branch, target);
  }

  if (key === 'claude') {
    addBranchCandidate(obj.gitBranch, target);
  }

  return target;
}

function providerBranchFromState(state) {
  if (!state || state.unsafe || !(state.branches instanceof Set)) return null;
  if (state.branches.size !== 1) return null;
  const [branch] = state.branches;
  return {
    branch,
    branch_kind: 'known',
    confidence: 'medium',
    branch_resolution_tier: 'PROVIDER_LOG',
  };
}

function getProviderBranchCache(cache) {
  if (!cache || typeof cache !== 'object') return null;
  if (!(cache.providerBranchBySession instanceof Map)) {
    cache.providerBranchBySession = new Map();
  }
  return cache.providerBranchBySession;
}

function makeCacheKey(provider, sessionId) {
  return `${providerKey(provider)}\u0000${sessionId}`;
}

function getProviderBranchEvidenceCache(cache) {
  if (!cache || typeof cache !== 'object') return null;
  if (!(cache.providerBranchEvidenceBySession instanceof Map)) {
    cache.providerBranchEvidenceBySession = new Map();
  }
  return cache.providerBranchEvidenceBySession;
}

function scanJsonlFileSync(filePath, onObject, { chunkSize = 256 * 1024 } = {}) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(chunkSize);
    let carry = '';
    while (true) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead <= 0) break;
      const chunk = carry + buffer.toString('utf8', 0, bytesRead);
      const lines = chunk.split(/\r?\n/);
      carry = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch (err) {
          const decision = onObject(null, { line, error: err });
          if (decision === false) return;
          continue;
        }
        const decision = onObject(obj, { line, error: null });
        if (decision === false) return;
      }
    }
    if (carry) {
      let obj;
      try {
        obj = JSON.parse(carry);
      } catch (err) {
        onObject(null, { line: carry, error: err });
        return;
      }
      onObject(obj, { line: carry, error: null });
    }
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
}

function readProviderBranchEvidenceFromSessionFile({
  provider,
  session_id,
  cache = null,
  strictMalformed = false,
} = {}) {
  const key = providerKey(provider);
  if (!SUPPORTED_PROVIDERS.has(key)) return { branch: null, checked: false, ambiguous: false };
  if (!isNonEmptyString(session_id) || !session_id.endsWith('.jsonl')) {
    return { branch: null, checked: false, ambiguous: false };
  }

  const map = getProviderBranchEvidenceCache(cache);
  const cacheKey = strictMalformed
    ? `${makeCacheKey(key, session_id)}\u0000strict-malformed`
    : makeCacheKey(key, session_id);
  if (map && map.has(cacheKey)) return map.get(cacheKey);
  if (map && !strictMalformed) {
    const strictCacheKey = `${makeCacheKey(key, session_id)}\u0000strict-malformed`;
    const strictResult = map.get(strictCacheKey);
    if (strictResult && strictResult.ambiguous !== true) return strictResult;
  }

  let result = { branch: null, checked: true, ambiguous: false };
  try {
    if (!fs.existsSync(session_id)) {
      result = { branch: null, checked: true, ambiguous: false };
    } else {
      const state = createProviderBranchState();
      scanJsonlFileSync(session_id, (obj, meta) => {
        if (meta && meta.error) {
          if (strictMalformed) {
            result = { branch: null, checked: true, ambiguous: true };
            return false;
          }
          return true;
        }
        collectProviderBranchFromObject(key, obj, state);
        if (state.unsafe || state.branches.size > 1) {
          result = { branch: null, checked: true, ambiguous: true };
          return false;
        }
        return true;
      });

      if (!result.ambiguous && state.branches.size === 1) {
        const [branch] = state.branches;
        result = { branch, checked: true, ambiguous: false };
      }
    }
  } catch {
    result = { branch: null, checked: true, ambiguous: false };
  }

  if (map) map.set(cacheKey, result);
  return result;
}

function readProviderBranchFromSessionFile({ provider, session_id, cache = null } = {}) {
  const evidence = readProviderBranchEvidenceFromSessionFile({
    provider,
    session_id,
    cache,
    strictMalformed: true,
  });
  if (!evidence.branch || evidence.ambiguous) return null;

  const map = getProviderBranchCache(cache);
  const cacheKey = makeCacheKey(provider, session_id);
  if (map && map.has(cacheKey)) return map.get(cacheKey);

  const result = {
    branch: evidence.branch,
    branch_kind: 'known',
    confidence: 'medium',
    branch_resolution_tier: 'PROVIDER_LOG',
  };

  if (map) map.set(cacheKey, result);
  return result;
}

module.exports = {
  cleanProviderBranch,
  collectProviderBranchFromObject,
  createProviderBranchCache,
  createProviderBranchState,
  providerBranchFromState,
  readProviderBranchEvidenceFromSessionFile,
  readProviderBranchFromSessionFile,
};
