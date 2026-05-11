'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 2,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_sessions ADD COLUMN input_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN cached_input_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN cache_creation_input_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN output_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN reasoning_output_tokens INTEGER;
    `);
  },
};
