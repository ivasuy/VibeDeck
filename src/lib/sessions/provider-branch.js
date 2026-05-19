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

function readProviderBranchFromSessionFile({ provider, session_id, cache = null } = {}) {
  const key = providerKey(provider);
  if (!SUPPORTED_PROVIDERS.has(key)) return null;
  if (!isNonEmptyString(session_id) || !session_id.endsWith('.jsonl')) return null;

  const map = getProviderBranchCache(cache);
  const cacheKey = makeCacheKey(key, session_id);
  if (map && map.has(cacheKey)) return map.get(cacheKey);

  let result = null;
  try {
    if (!fs.existsSync(session_id)) {
      result = null;
    } else {
      const state = createProviderBranchState();
      const content = fs.readFileSync(session_id, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        if (!line) continue;
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          result = null;
          state.unsafe = true;
          break;
        }
        collectProviderBranchFromObject(key, obj, state);
        if (state.unsafe || state.branches.size > 1) break;
      }
      if (!state.unsafe && state.branches.size <= 1) {
        result = providerBranchFromState(state);
      }
    }
  } catch {
    result = null;
  }

  if (map) map.set(cacheKey, result);
  return result;
}

module.exports = {
  cleanProviderBranch,
  collectProviderBranchFromObject,
  createProviderBranchCache,
  createProviderBranchState,
  providerBranchFromState,
  readProviderBranchFromSessionFile,
};
