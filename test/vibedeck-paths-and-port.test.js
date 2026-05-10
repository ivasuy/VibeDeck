const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');

test('default data dir is ~/.vibedeck', async () => {
  const { resolveTrackerPaths } = require('../src/lib/tracker-paths');
  const paths = await resolveTrackerPaths();
  assert.strictEqual(paths.rootDir, path.join(os.homedir(), '.vibedeck'));
});

test('default port is 7690', () => {
  // The DEFAULT_PORT is defined in src/commands/serve.js
  // We read module source to verify the constant value
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '../src/commands/serve.js'), 'utf8');
  const match = src.match(/const DEFAULT_PORT\s*=\s*(\d+)/);
  assert.ok(match, 'DEFAULT_PORT constant not found in serve.js');
  assert.strictEqual(Number(match[1]), 7690);
});

test('serve banner uses VibeDeck branding and explains no-sync', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '../src/commands/serve.js'), 'utf8');
  assert.match(src, /VibeDeck dashboard running at:/);
  assert.match(src, /Sync: disabled \(\-\-no-sync\); run without --no-sync for live data refresh\./);
  assert.doesNotMatch(src, /tokentracker dashboard running at:/);
});
