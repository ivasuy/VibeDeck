'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');

test('serve shutdown prints cleanup phases and only closes the server once on first interrupt', async () => {
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
  await new Promise((resolve) => setImmediate(resolve));

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

test('serve shutdown prints concrete resource cleanup proof for open sockets', async () => {
  const { createServeShutdownHandler } = require('../src/commands/serve');
  const server = new EventEmitter();
  const socket = new EventEmitter();
  socket.remoteAddress = '127.0.0.1';
  socket.remotePort = 54231;
  socket.ended = false;
  socket.destroyed = false;
  socket.end = () => {
    socket.ended = true;
    socket.emit('close');
  };
  socket.destroy = () => {
    socket.destroyed = true;
  };
  const sockets = new Set([socket]);
  let logs = '';
  let exitCalls = 0;

  server.closeAllConnections = () => {};
  server.close = (callback) => {
    callback?.();
  };

  const shutdown = createServeShutdownHandler({
    server,
    sockets,
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
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(exitCalls, 1);
  assert.equal(socket.ended, true);
  assert.match(logs, /background sync timer cleared/);
  assert.match(logs, /session reaper timer cleared/);
  assert.match(logs, /branch watcher stopped/);
  assert.match(logs, /connection 1: 127\.0\.0\.1:54231 ending/);
  assert.match(logs, /connection 1: 127\.0\.0\.1:54231 closed/);
  assert.match(logs, /dashboard server closed/);
});
