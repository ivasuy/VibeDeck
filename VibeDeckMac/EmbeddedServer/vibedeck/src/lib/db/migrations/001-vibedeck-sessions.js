'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_sessions (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        end_reason TEXT,
        cwd TEXT,
        repo_root TEXT,
        repo_common_dir TEXT,
        parent_repo TEXT,
        branch TEXT,
        branch_resolution_tier TEXT NOT NULL,
        confidence TEXT NOT NULL,
        override_user TEXT,
        model TEXT,
        total_tokens INTEGER,
        total_cost_usd REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id)
      );
      CREATE INDEX idx_vibedeck_sessions_repo_branch ON vibedeck_sessions(repo_root, branch);
      CREATE INDEX idx_vibedeck_sessions_started ON vibedeck_sessions(started_at);
      CREATE INDEX idx_vibedeck_sessions_live ON vibedeck_sessions(ended_at) WHERE ended_at IS NULL;
    `);
  },
};

