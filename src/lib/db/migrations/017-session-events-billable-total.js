'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 6,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_events
        ADD COLUMN billable_total_tokens INTEGER;
    `);
  },
};
