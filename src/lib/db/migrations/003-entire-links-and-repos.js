'use strict';

module.exports = {
  component: 'vibedeck-entire-links-and-repos',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_entire_links (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        entire_session_id TEXT NOT NULL,
        entire_checkpoint_ids TEXT,
        match_confidence TEXT NOT NULL,
        PRIMARY KEY (provider, session_id, entire_session_id),
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE TABLE vibedeck_repos (
        repo_root TEXT PRIMARY KEY,
        entire_state TEXT,
        entire_checked_at TEXT,
        entire_version TEXT
      );
    `);
  },
};

