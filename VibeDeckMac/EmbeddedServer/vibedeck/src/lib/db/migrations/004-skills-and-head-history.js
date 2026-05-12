'use strict';

module.exports = {
  component: 'vibedeck-skills-and-head-history',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_skills (
        provider TEXT NOT NULL,
        name TEXT NOT NULL,
        install_path TEXT NOT NULL,
        source_url TEXT,
        installed_at TEXT NOT NULL,
        last_used_estimate TEXT,
        PRIMARY KEY (provider, name)
      );
      CREATE TABLE vibedeck_head_history (
        repo_root TEXT NOT NULL,
        worktree_root TEXT NOT NULL,
        transitioned_at TEXT NOT NULL,
        ref_name TEXT NOT NULL,
        PRIMARY KEY (repo_root, worktree_root, transitioned_at)
      );
      CREATE INDEX idx_head_history_lookup ON vibedeck_head_history(worktree_root, transitioned_at);
    `);
  },
};

