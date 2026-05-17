'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

test('serve shutdown prints cleanup phases and only closes the server once on first interrupt', () => {
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

  assert.equal(closeCalls, 1);
  assert.equal(closeAllCalls, 1);
  assert.equal(exitCalls, 1);
  assert.match(logs, /Shutting down VibeDeck/);
  assert.match(logs, /Stopping background sync/);
  assert.match(logs, /Stopping branch watcher/);
  assert.match(logs, /Closing dashboard server/);
  assert.match(logs, /Closing 0 open connection\(s\)/);
  assert.match(logs, /Shutdown complete/);
  assert.equal(logs.match(/Shutting down VibeDeck/g)?.length, 1);
});

test('serve shutdown warns on repeated interrupt then force exits on the next interrupt', () => {
  const { createServeShutdownHandler } = require('../src/commands/serve');
  const server = new EventEmitter();
  const sockets = new Set([
    { ended: false, destroyed: false, end() { this.ended = true; }, destroy() { this.destroyed = true; } },
    { ended: false, destroyed: false, end() { this.ended = true; }, destroy() { this.destroyed = true; } },
  ]);
  let closeCalls = 0;
  let closeAllCalls = 0;
  let exitCalls = [];
  let logs = '';

  server.close = () => {
    closeCalls += 1;
  };
  server.closeAllConnections = () => {
    closeAllCalls += 1;
  };

  const shutdown = createServeShutdownHandler({
    server,
    sockets,
    setTimeoutFn: () => ({ unref() {} }),
    exitFn: (code) => {
      exitCalls.push(code);
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
  assert.equal(closeAllCalls, 2);
  assert.deepEqual(exitCalls, [0]);
  assert.match(logs, /Shutdown already in progress\. Press Ctrl\+C again to force exit\./);
  for (const socket of sockets) {
    assert.equal(socket.ended, true);
    assert.equal(socket.destroyed, true);
  }
});
