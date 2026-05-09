'use strict';

const execa = require('execa');

const CACHE_TTL_MS = 60 * 1000;
let cache = null;

async function detectEntire({ timeoutMs = 5000 } = {}) {
  const now = Date.now();
  if (cache && now - cache.stamp < CACHE_TTL_MS) return cache.result;

  let result;
  try {
    const { stdout } = await execa('entire', ['version'], { timeout: timeoutMs });
    result = { present: true, version: String(stdout).trim() };
  } catch {
    result = { present: false, version: null };
  }

  cache = { result, stamp: now };
  return result;
}

function _resetEntireCacheForTests() {
  cache = null;
}

module.exports = { detectEntire, _resetEntireCacheForTests };

