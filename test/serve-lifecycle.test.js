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

