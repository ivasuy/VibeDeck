'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function safeRealpath(p) {
  if (!isNonEmptyString(p)) return p;
  try {
    return fs.realpathSync(p);
  } catch {
    return p;
  }
}

const RING_CAP = 1000;
const _ringByWorktree = new Map();

function _getRing(worktreeRoot) {
  const key = safeRealpath(worktreeRoot);
  if (!_ringByWorktree.has(key)) _ringByWorktree.set(key, []);
  return { key, ring: _ringByWorktree.get(key) };
}

function recordTransition(dbPath, { repo_root, worktree_root, ref_name, transitioned_at } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('recordTransition: dbPath must be a non-empty string');
  if (!isNonEmptyString(repo_root)) throw new TypeError('recordTransition: repo_root must be a non-empty string');
  if (!isNonEmptyString(worktree_root)) throw new TypeError('recordTransition: worktree_root must be a non-empty string');
  if (!isNonEmptyString(ref_name)) throw new TypeError('recordTransition: ref_name must be a non-empty string');
  if (!isNonEmptyString(transitioned_at)) throw new TypeError('recordTransition: transitioned_at must be a non-empty ISO string');

  const repoRoot = safeRealpath(repo_root);
  const worktreeRoot = safeRealpath(worktree_root);

  const { ring } = _getRing(worktreeRoot);
  ring.push({ transitioned_at, ref_name });
  if (ring.length > RING_CAP) ring.splice(0, ring.length - RING_CAP);

  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      INSERT OR IGNORE INTO vibedeck_head_history (
        repo_root, worktree_root, transitioned_at, ref_name
      ) VALUES (?, ?, ?, ?)
      `,
    ).run(repoRoot, worktreeRoot, transitioned_at, ref_name);
  } finally {
    db.close();
  }
}

function _findInRing(worktreeRoot, whenIso) {
  const { ring } = _getRing(worktreeRoot);
  if (ring.length === 0) return undefined;

  // transitioned_at is stored as ISO-8601 UTC; lex ordering matches time ordering.
  let lo = 0;
  let hi = ring.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ring[mid].transitioned_at <= whenIso) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === -1) return null;
  return ring[best].ref_name;
}

function findBranchAt(dbPath, { worktree_root, when } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('findBranchAt: dbPath must be a non-empty string');
  if (!isNonEmptyString(worktree_root)) throw new TypeError('findBranchAt: worktree_root must be a non-empty string');
  if (!isNonEmptyString(when)) throw new TypeError('findBranchAt: when must be a non-empty ISO string');

  const worktreeRoot = safeRealpath(worktree_root);
  const inRing = _findInRing(worktreeRoot, when);
  if (inRing !== undefined) return inRing;

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row =
      db
        .prepare(
          `
          SELECT ref_name
          FROM vibedeck_head_history
          WHERE worktree_root = ? AND transitioned_at <= ?
          ORDER BY transitioned_at DESC
          LIMIT 1
          `,
        )
        .get(worktreeRoot, when) || null;
    return row ? row.ref_name : null;
  } finally {
    db.close();
  }
}

function getActiveRepos(dbPath, { sinceDays = 7 } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('getActiveRepos: dbPath must be a non-empty string');
  const days = Number.isFinite(sinceDays) ? sinceDays : 7;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const cutoffIso = new Date(cutoffMs).toISOString();

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(
        `
        SELECT DISTINCT repo_root
        FROM vibedeck_sessions
        WHERE repo_root IS NOT NULL AND repo_root <> '' AND started_at >= ?
        `,
      )
      .all(cutoffIso);
    return rows.map((r) => {
      const repoRoot = safeRealpath(r.repo_root);
      return { repo_root: repoRoot, worktree_root: repoRoot };
    });
  } finally {
    db.close();
  }
}

module.exports = { recordTransition, findBranchAt, getActiveRepos };

