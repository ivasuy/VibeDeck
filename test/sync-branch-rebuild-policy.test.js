'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('auto sync runs the full branch-fact rebuild once, not on every poll', () => {
  const { shouldRunFullBranchFactRebuild } = require('../src/commands/sync');

  assert.equal(
    shouldRunFullBranchFactRebuild({ auto: true, rebuildVibedeckDb: false, autoBranchFactsRebuilt: false }),
    true,
  );
  assert.equal(
    shouldRunFullBranchFactRebuild({ auto: true, rebuildVibedeckDb: false, autoBranchFactsRebuilt: true }),
    false,
  );
});

test('manual sync and explicit rebuild keep the full branch-fact rebuild', () => {
  const { shouldRunFullBranchFactRebuild } = require('../src/commands/sync');

  assert.equal(
    shouldRunFullBranchFactRebuild({ auto: false, rebuildVibedeckDb: false, autoBranchFactsRebuilt: true }),
    true,
  );
  assert.equal(
    shouldRunFullBranchFactRebuild({ auto: true, rebuildVibedeckDb: true, autoBranchFactsRebuilt: true }),
    true,
  );
});
