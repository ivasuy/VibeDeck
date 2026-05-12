'use strict';

module.exports = {
  component: 'vibedeck-session-buckets-and-windows',
  version: 2,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_buckets ADD COLUMN input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cached_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN output_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN reasoning_output_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN conversation_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN total_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN total_cost_usd REAL;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cost_estimated INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cost_quality TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN last_observed_at TEXT;
    `);
  },
};
