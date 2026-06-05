'use strict';

// const { resolveBranchTierA } = require('./tier-a-entire');
const { findBranchAt } = require('./head-history');
const { resolveBranchTierC } = require('./tier-c-reflog');
const { getOverride } = require('./overrides');
const { cleanProviderBranch } = require('./provider-branch');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

async function resolveBranchForSession(
  { provider, session_id, repo_root, started_at, ended_at, dbPath, override, provider_branch } = {},
  // { resolveTierA = resolveBranchTierA, findBranchAt: findTierB = findBranchAt, resolveTierC = resolveBranchTierC } = {},
  { findBranchAt: findTierB = findBranchAt, resolveTierC = resolveBranchTierC } = {},
) {
  if (override) {
    return { ...override, tier: 'OVERRIDE', confidence: 'high' };
  }

  if (isNonEmptyString(dbPath) && isNonEmptyString(provider) && isNonEmptyString(session_id)) {
    try {
      const row = getOverride(dbPath, { provider, session_id });
      if (row) {
        if (row.branch !== null) return { branch: row.branch, tier: 'OVERRIDE', confidence: 'high' };
        // branch === null means "cleared override" — proceed with normal tiers.
      }
    } catch {
      // ignore override lookup failures; fall back to tier resolution
    }
  }

  if (!isNonEmptyString(repo_root)) {
    return { branch: null, tier: 'D', confidence: 'unattributed' };
  }

  const repoRoot = repo_root;

  /*
  const tierA = await resolveTierA({ repoRoot, provider, started_at, ended_at });
  if (tierA) {
    const res = { branch: tierA.branch, tier: 'A', confidence: 'high' };
    if (isNonEmptyString(tierA.entire_session_id)) res.entire_link = tierA.entire_session_id;
    return res;
  }
  */

  const providerBranch = cleanProviderBranch(provider_branch);
  if (providerBranch) {
    return { branch: providerBranch, tier: 'PROVIDER_LOG', confidence: 'medium' };
  }

  if (isNonEmptyString(dbPath)) {
    const b = findTierB(dbPath, { worktree_root: repoRoot, when: started_at });
    if (b) return { branch: b, tier: 'B', confidence: 'medium' };
  }

  const tierC = await resolveTierC({ repoRoot, when: started_at });
  if (tierC) return { branch: tierC.branch, tier: 'C', confidence: 'low' };

  return { branch: null, tier: 'D', confidence: 'unattributed' };
}

module.exports = { resolveBranchForSession };
