'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 3,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_events (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        started_at TEXT,
        ended_at TEXT,
        end_reason TEXT,
        cwd TEXT,
        repo_root TEXT,
        repo_common_dir TEXT,
        parent_repo TEXT,
        branch TEXT,
        branch_resolution_tier TEXT,
        confidence TEXT,
        model TEXT,
        delta_tokens INTEGER,
        input_tokens INTEGER,
        cached_input_tokens INTEGER,
        cache_creation_input_tokens INTEGER,
        output_tokens INTEGER,
        reasoning_output_tokens INTEGER,
        conversation_count INTEGER,
        total_tokens INTEGER,
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id, event_key)
      );

      CREATE INDEX idx_vibedeck_session_events_activity
        ON vibedeck_session_events(provider, session_id, observed_at);

      ALTER TABLE vibedeck_sessions ADD COLUMN last_observed_at TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN cost_estimated INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE vibedeck_sessions ADD COLUMN cost_quality TEXT;
    `);
  },
};
