'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 5,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_events ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN tools_sequence_json TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN fast_mode INTEGER;

      ALTER TABLE vibedeck_sessions ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN tools_sequence_json TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN fast_mode INTEGER;

      ALTER TABLE vibedeck_session_buckets ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN task_category TEXT;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN skills_json TEXT;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN fast_mode INTEGER NOT NULL DEFAULT 0;
    `);
  },
};
