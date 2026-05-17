'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

test('sync lifecycle progress bridge forwards parser proof while preserving progress-bar updates', () => {
  const { createSyncLifecycleProgressCallback } = require('../src/commands/sync');
  const lifecycleEvents = [];
  const progressUpdates = [];

  const onProgress = createSyncLifecycleProgressCallback({
    provider: 'Claude',
    unit: 'files',
    lifecycle: {
      providerProgress(name, payload) {
        lifecycleEvents.push({ name, payload });
      },
    },
    progress: {
      enabled: true,
      update(message) {
        progressUpdates.push(message);
      },
    },
    renderProgress(payload) {
      return `Parsing Claude ${payload.index}/${payload.total}`;
    },
  });

  onProgress({
    index: 7,
    total: 12,
    filePath: '/Users/example/.claude/projects/demo/session.jsonl',
    eventsAggregated: 44,
    bucketsQueued: 9,
  });

  assert.deepEqual(progressUpdates, ['Parsing Claude 7/12']);
  assert.equal(lifecycleEvents.length, 1);
  assert.equal(lifecycleEvents[0].name, 'Claude');
  assert.equal(lifecycleEvents[0].payload.unit, 'files');
  assert.equal(lifecycleEvents[0].payload.index, 7);
  assert.equal(lifecycleEvents[0].payload.total, 12);
  assert.equal(lifecycleEvents[0].payload.filePath, '/Users/example/.claude/projects/demo/session.jsonl');
  assert.equal(lifecycleEvents[0].payload.eventsAggregated, 44);
  assert.equal(lifecycleEvents[0].payload.bucketsQueued, 9);
});

test('sync lifecycle reports when an existing lock prevents startup sync work', async () => {
  const { cmdSync } = require('../src/commands/sync');
  const previousHome = process.env.HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sync-lock-'));
  const trackerDir = path.join(home, '.vibedeck', 'tracker');
  fs.mkdirSync(trackerDir, { recursive: true });
  fs.writeFileSync(path.join(trackerDir, 'sync.lock'), '', 'utf8');
  const events = [];

  try {
    process.env.HOME = home;
    await cmdSync(['--auto'], {
      lifecycle: {
        providerDone(name, message) {
          events.push({ name, message });
        },
      },
    });
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    fs.rmSync(home, { recursive: true, force: true });
  }

  assert.deepEqual(events, [
    {
      name: 'Sync',
      message: 'another sync is already running; using current local data',
    },
  ]);
});
