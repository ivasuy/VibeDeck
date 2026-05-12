'use strict';

module.exports = {
  component: 'vibedeck-entire-checkpoint-matches',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_entire_checkpoint_matches (
        repo_root TEXT NOT NULL,
        checkpoint_group_id TEXT NOT NULL,
        checkpoint_id TEXT,
        metadata_path TEXT NOT NULL,
        checkpoint_tip TEXT,
        entire_session_id TEXT,
        agent TEXT,
        provider TEXT,
        model TEXT,
        branch TEXT,
        started_at TEXT,
        ended_at TEXT,
        session_provider TEXT,
        session_id TEXT,
        match_status TEXT NOT NULL,
        match_confidence TEXT NOT NULL,
        reason TEXT,
        candidate_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (repo_root, checkpoint_group_id)
      );
    `);
  },
};
