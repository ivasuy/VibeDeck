'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const { test } = require('node:test');

test('openInBrowser does not block serve readiness with synchronous macOS browser detection', () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalExecFileSync = cp.execFileSync;
  const originalSpawn = cp.spawn;
  let execFileSyncCalls = 0;
  let spawnCalls = 0;

  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: 'darwin',
  });
  cp.execFileSync = () => {
    execFileSyncCalls += 1;
    return '';
  };
  cp.spawn = () => {
    spawnCalls += 1;
    return { unref() {} };
  };

  try {
    const { openInBrowser } = require('../src/lib/browser-auth');
    openInBrowser('http://127.0.0.1:7690');
  } finally {
    cp.execFileSync = originalExecFileSync;
    cp.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', originalPlatform);
  }

  assert.equal(execFileSyncCalls, 0);
  assert.equal(spawnCalls, 1);
});
