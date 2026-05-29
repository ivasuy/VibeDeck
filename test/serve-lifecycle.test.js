'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

test('serve startup lifecycle reporter prints visible startup phases', () => {
  const { createServeLifecycleReporter } = require('../src/commands/serve');
  let logs = '';
  const reporter = createServeLifecycleReporter({
    stdout: {
      write(chunk) {
        logs += chunk;
      },
    },
  });

  reporter.phase('Preparing local database...');
  reporter.phase('Starting branch watcher...');
  reporter.phase('Refreshing local runtime...');
  reporter.phase('Syncing provider logs...');
  reporter.provider('Codex', 'scanning sessions');
  reporter.provider('Claude', 'scanning projects');
  reporter.provider('Cursor', 'checking local usage');
  reporter.phase('Rebuilding branch/project indexes...');
  reporter.phase('Starting dashboard server...');
  reporter.ready('http://127.0.0.1:7690');

  assert.match(logs, /Preparing local database/);
  assert.match(logs, /Starting branch watcher/);
  assert.match(logs, /Refreshing local runtime/);
  assert.match(logs, /Syncing provider logs/);
  assert.match(logs, /  Codex: scanning sessions/);
  assert.match(logs, /  Claude: scanning projects/);
  assert.match(logs, /  Cursor: checking local usage/);
  assert.match(logs, /Rebuilding branch\/project indexes/);
  assert.match(logs, /Starting dashboard server/);
  assert.match(logs, /Dashboard ready: http:\/\/127\.0\.0\.1:7690/);
});

test('serve startup lifecycle reporter prints first-paint readiness timing', () => {
  const { createServeLifecycleReporter } = require('../src/commands/serve');
  let logs = '';
  const reporter = createServeLifecycleReporter({
    stdout: {
      write(chunk) {
        logs += chunk;
      },
    },
  });

  reporter.ready('http://127.0.0.1:7690', { startedAtMs: 1_000, nowMs: 1_375 });

  assert.match(logs, /Dashboard ready: http:\/\/127\.0\.0\.1:7690/);
  assert.match(logs, /First paint ready: 375ms/);
});

test('serve schedules initial sync in the background so first paint is not blocked', async () => {
  const { startServeSyncInBackground } = require('../src/commands/serve');
  let logs = '';
  let syncStarted = false;
  let releaseSync;
  const syncReleased = new Promise((resolve) => {
    releaseSync = resolve;
  });

  const scheduled = startServeSyncInBackground({
    syncEnabled: true,
    lifecycle: {
      phase(message) {
        logs += `${message}\n`;
      },
    },
    cmdSyncFn: async () => {
      syncStarted = true;
      await syncReleased;
    },
    stdout: {
      write(chunk) {
        logs += chunk;
      },
    },
  });

  assert.equal(syncStarted, false);
  assert.equal(typeof scheduled?.then, 'function');
  assert.match(logs, /Syncing provider logs in background/);

  await Promise.resolve();
  assert.equal(syncStarted, true);
  releaseSync();
  await scheduled;
});

test('serve startup lifecycle reporter prints real provider progress with current file proof', () => {
  const { createServeLifecycleReporter } = require('../src/commands/serve');
  let logs = '';
  const reporter = createServeLifecycleReporter({
    stdout: {
      write(chunk) {
        logs += chunk;
      },
    },
  });

  reporter.provider('Codex', 'found 3 session files');
  reporter.providerProgress('Codex', {
    index: 2,
    total: 3,
    unit: 'files',
    filePath: '/Users/example/.codex/sessions/2026/05/17/session-abc.jsonl',
    eventsAggregated: 19,
    bucketsQueued: 4,
  });
  reporter.providerDone('Codex', 'scanned 3 files · 19 events · 4 buckets');

  assert.match(logs, /Codex: found 3 session files/);
  assert.match(logs, /Codex: 2\/3 files/);
  assert.match(logs, /session-abc\.jsonl/);
  assert.match(logs, /19 events/);
  assert.match(logs, /4 buckets/);
  assert.match(logs, /Codex: scanned 3 files · 19 events · 4 buckets/);
});
