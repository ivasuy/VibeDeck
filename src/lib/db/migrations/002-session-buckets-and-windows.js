'use strict';

module.exports = {
  component: 'vibedeck-session-buckets-and-windows',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_buckets (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        bucket_provider TEXT NOT NULL,
        bucket_model TEXT NOT NULL,
        bucket_hour_start TEXT NOT NULL,
        proportion REAL NOT NULL DEFAULT 1.0,
        PRIMARY KEY (provider, session_id, bucket_provider, bucket_model, bucket_hour_start),
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE TABLE vibedeck_session_branch_windows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        branch TEXT NOT NULL,
        window_start TEXT NOT NULL,
        window_end TEXT NOT NULL,
        prorated_tokens INTEGER,
        prorated_cost_usd REAL,
        FOREIGN KEY (provider, session_id)
          REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
      );
      CREATE INDEX idx_branch_windows_branch ON vibedeck_session_branch_windows(branch, window_start);
    `);
  },
};

