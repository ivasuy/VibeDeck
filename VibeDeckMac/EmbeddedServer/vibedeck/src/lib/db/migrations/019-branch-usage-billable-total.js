'use strict';

module.exports = {
  component: 'vibedeck-branch-usage-facts',
  version: 2,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_branch_usage_facts
        ADD COLUMN billable_total_tokens INTEGER;
    `);
  },
};
