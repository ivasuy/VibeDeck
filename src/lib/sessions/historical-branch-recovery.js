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
    firstCommitIsoFromGit: readFirstCommit = firstCommitIsoFromGit,
    listLocalBranchesFromGit: listLocalBranches = listLocalBranchesFromGit,
    resolveTierC = resolveBranchTierC,
  } = {},
) {
  if (!isNonEmptyString(repoRoot)) return null;

  const observedIso = parseUtcIsoOrNull(observedAt);
  if (!observedIso) return null;

  const firstCommitIso = parseUtcIsoOrNull(readFirstCommit(repoRoot));
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
    tierC = await resolveTierC({ repoRoot, when: observedIso });
  } catch {
    return null;
  }

  const normalized = normalizeBranchName(tierC && tierC.branch);
  if (!normalized) return null;

  const localBranches = listLocalBranches(repoRoot);
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
