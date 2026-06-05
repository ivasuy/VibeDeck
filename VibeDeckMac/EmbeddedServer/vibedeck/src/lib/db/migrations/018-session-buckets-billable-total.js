'use strict';

module.exports = {
  component: 'vibedeck-session-buckets-and-windows',
  version: 3,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_buckets
        ADD COLUMN billable_total_tokens INTEGER;
    `);
  },
};
