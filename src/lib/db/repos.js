'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function upsertEntireState(dbPath, { repoRoot, entire_state, entire_version }) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(repo_root) DO UPDATE SET
        entire_state = excluded.entire_state,
        entire_checked_at = excluded.entire_checked_at,
        entire_version = excluded.entire_version
    `,
    ).run(repoRoot, entire_state, new Date().toISOString(), entire_version || null);
  } finally {
    db.close();
  }
}

function getRepoState(dbPath, repoRoot) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare('SELECT * FROM vibedeck_repos WHERE repo_root = ?').get(repoRoot) || null;
  } finally {
    db.close();
  }
}

function parseLimit(value, fallback = 50) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, 200);
}

function maxIso(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a >= b ? a : b;
}

function listKnownRepos(dbPath, { limit = 50 } = {}) {
  if (!dbPath || !fs.existsSync(dbPath)) return { repos: [] };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const repos = new Map();

    const entireRows = db.prepare('SELECT * FROM vibedeck_repos').all();
    for (const row of entireRows) {
      const repoRoot = typeof row.repo_root === 'string' ? row.repo_root.trim() : '';
      if (!repoRoot) continue;
      repos.set(repoRoot, {
        repo_root: repoRoot,
        entire_state: row.entire_state ?? null,
        entire_version: row.entire_version ?? null,
        entire_checked_at: row.entire_checked_at ?? null,
        last_session_at: null,
        session_count: 0,
        open_session_count: 0,
        sources: { entire: true, sessions: false },
      });
    }

    const sessionRows = db
      .prepare(
        `
        SELECT
          repo_root,
          COUNT(*) AS session_count,
          SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open_session_count,
          MAX(updated_at) AS last_session_at
        FROM vibedeck_sessions
        WHERE repo_root IS NOT NULL AND repo_root <> ''
        GROUP BY repo_root
      `,
      )
      .all();

    for (const row of sessionRows) {
      const repoRoot = typeof row.repo_root === 'string' ? row.repo_root.trim() : '';
      if (!repoRoot) continue;
      const existing = repos.get(repoRoot) || {
        repo_root: repoRoot,
        entire_state: null,
        entire_version: null,
        entire_checked_at: null,
        last_session_at: null,
        session_count: 0,
        open_session_count: 0,
        sources: { entire: false, sessions: false },
      };
      existing.last_session_at = row.last_session_at ?? null;
      existing.session_count = Number(row.session_count || 0);
      existing.open_session_count = Number(row.open_session_count || 0);
      existing.sources.sessions = true;
      repos.set(repoRoot, existing);
    }

    return {
      repos: Array.from(repos.values())
        .sort((a, b) => {
          const aSeen = maxIso(a.entire_checked_at, a.last_session_at) || '';
          const bSeen = maxIso(b.entire_checked_at, b.last_session_at) || '';
          if (aSeen !== bSeen) return bSeen.localeCompare(aSeen);
          return a.repo_root.localeCompare(b.repo_root);
        })
        .slice(0, parseLimit(limit)),
    };
  } finally {
    db.close();
  }
}

module.exports = { upsertEntireState, getRepoState, listKnownRepos };
