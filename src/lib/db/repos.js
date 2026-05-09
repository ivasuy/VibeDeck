'use strict';

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

module.exports = { upsertEntireState, getRepoState };

