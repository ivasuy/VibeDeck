'use strict';

module.exports = {
  component: 'vibedeck-attribution-overrides',
  version: 5,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_attribution_overrides (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        branch TEXT,
        set_by TEXT,
        set_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id)
      );
    `);
  },
};

