'use strict';

module.exports = {
  component: 'vibedeck-known-repo-suppression',
  version: 1,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_repos ADD COLUMN hidden_at TEXT;
    `);
  },
};
