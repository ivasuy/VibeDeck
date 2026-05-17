'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

test('serve shutdown is idempotent and only closes the server once', () => {
  const { createServeShutdownHandler } = require('../src/commands/serve');
  const server = new EventEmitter();
  let closeCalls = 0;
  let closeAllCalls = 0;
  let exitCalls = 0;
  let logs = '';

  server.close = (callback) => {
    closeCalls += 1;
    callback?.();
  };
  server.closeAllConnections = () => {
    closeAllCalls += 1;
  };

  const shutdown = createServeShutdownHandler({
    server,
    syncInterval: { closed: false },
    reaperInterval: { closed: false },
    clearIntervalFn(interval) {
      interval.closed = true;
    },
    stopHeadWatcherFn: async () => {},
    setTimeoutFn: () => ({ unref() {} }),
    exitFn: () => {
      exitCalls += 1;
    },
    stdout: {
      write(chunk) {
        logs += chunk;
      },
    },
  });

  shutdown();
  shutdown();
  shutdown();

  assert.equal(closeCalls, 1);
  assert.equal(closeAllCalls, 1);
  assert.equal(exitCalls, 1);
  assert.equal(logs.match(/Shutting down/g)?.length, 1);
});
