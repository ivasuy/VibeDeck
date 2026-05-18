'use strict';

const { execFileSync } = require('node:child_process');

const { normalizeBranchName } = require('./branch-name');
const { resolveBranchTierC } = require('./tier-c-reflog');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseUtcIsoOrNull(value) {
  if (!isNonEmptyString(value)) return null;
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function safeGit(repoRoot, args) {
  if (!isNonEmptyString(repoRoot) || !Array.isArray(args) || args.length === 0) return null;
  try {
    return execFileSync('git', ['-C', repoRoot, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 3000,
    });
  } catch {
    return null;
  }
}

function getCacheMap(cache, key) {
  if (!cache || typeof cache !== 'object') return null;
  if (!(cache[key] instanceof Map)) {
    cache[key] = new Map();
  }
  return cache[key];
}

function computeWithCacheSync(cache, key, cacheKey, compute) {
  const map = getCacheMap(cache, key);
  if (!map) return compute();
  if (map.has(cacheKey)) return map.get(cacheKey);
  const value = compute();
  map.set(cacheKey, value);
  return value;
}

async function computeWithCacheAsync(cache, key, cacheKey, compute) {
  const map = getCacheMap(cache, key);
  if (!map) return compute();
  if (map.has(cacheKey)) return map.get(cacheKey);
  const pending = Promise.resolve().then(compute);
  map.set(cacheKey, pending);
  try {
    const value = await pending;
    map.set(cacheKey, value);
    return value;
  } catch (error) {
    map.delete(cacheKey);
    throw error;
  }
}

function firstCommitIsoFromGit(repoRoot) {
  const out = safeGit(repoRoot, ['log', '--reverse', '--max-parents=0', '--format=%cI', '-n', '1']);
  if (!isNonEmptyString(out)) return null;
  const firstLine = out.trim().split('\n')[0] || '';
  return parseUtcIsoOrNull(firstLine);
}

function listLocalBranchesFromGit(repoRoot) {
  const out = safeGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  if (!isNonEmptyString(out)) return [];
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function isRecoverableLocalBranch(branch, localBranches) {
  if (!isNonEmptyString(branch)) return false;
  if (!Array.isArray(localBranches)) return false;

  const candidate = branch.trim();
  if (candidate === 'HEAD') return false;
  if (candidate.startsWith('tags/')) return false;
  if (candidate.startsWith('detached@')) return false;

  return localBranches.includes(candidate);
}

async function recoverHistoricalBranchForUnknownGit(
  { repoRoot, observedAt } = {},
  {
    cache = null,
    firstCommitIsoFromGit: readFirstCommit = firstCommitIsoFromGit,
    listLocalBranchesFromGit: listLocalBranches = listLocalBranchesFromGit,
    resolveTierC = resolveBranchTierC,
  } = {},
) {
  if (!isNonEmptyString(repoRoot)) return null;

  const observedIso = parseUtcIsoOrNull(observedAt);
  if (!observedIso) return null;

  const firstCommitIso = parseUtcIsoOrNull(
    computeWithCacheSync(cache, 'firstCommitIsoByRepo', repoRoot, () => readFirstCommit(repoRoot)),
  );
  if (firstCommitIso && observedIso < firstCommitIso) {
    return {
      branch: 'Historical unknown',
      branch_kind: 'historical_unknown',
      confidence: 'low',
      branch_resolution_tier: 'HISTORICAL_GUARD',
    };
  }

  let tierC;
  try {
    tierC = await computeWithCacheAsync(cache, 'tierCResultByRepoTime', `${repoRoot}\u0000${observedIso}`, () =>
      resolveTierC({ repoRoot, when: observedIso, cache }),
    );
  } catch {
    return null;
  }

  const normalized = normalizeBranchName(tierC && tierC.branch);
  if (!normalized) return null;

  const localBranches = computeWithCacheSync(cache, 'localBranchesByRepo', repoRoot, () => listLocalBranches(repoRoot));
  if (!isRecoverableLocalBranch(normalized, localBranches)) return null;

  return {
    branch: normalized,
    branch_kind: 'known',
    confidence: 'low',
    branch_resolution_tier: 'C',
  };
}

module.exports = {
  recoverHistoricalBranchForUnknownGit,
  firstCommitIsoFromGit,
  listLocalBranchesFromGit,
  isRecoverableLocalBranch,
};
