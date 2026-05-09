const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const sig = require('../src/lib/hook-merger/signature');

test('isVibedeckEntryJSON matches by _vibedeck field', () => {
  assert.strictEqual(sig.isVibedeckEntryJSON({ _vibedeck: 'v1', command: 'x' }), true);
  assert.strictEqual(sig.isVibedeckEntryJSON({ command: 'x' }), false);
});

test('isVibedeckEntryJSON matches by canonical command path glob', () => {
  const cmd = path.join(require('os').homedir(), '.vibedeck', 'app', 'hooks', 'notify.cjs');
  assert.strictEqual(sig.isVibedeckEntryJSON({ command: cmd }), true);
});

test('isEntireEntryJSON detects entire hook entries', () => {
  assert.strictEqual(sig.isEntireEntryJSON({ command: '/usr/local/bin/entire hook session-end' }), true);
  assert.strictEqual(sig.isEntireEntryJSON({ command: 'echo hi' }), false);
});

test('canonicalCommandPath uses ~/.vibedeck/app/hooks/notify.cjs', () => {
  const got = sig.canonicalCommandPath();
  assert.ok(got.endsWith('/.vibedeck/app/hooks/notify.cjs'), got);
});

test('isVibedeckEntryJSON detects nested hooks[].command shape', () => {
  const cmd = path.join(require('os').homedir(), '.vibedeck', 'app', 'hooks', 'notify.cjs');
  assert.strictEqual(
    sig.isVibedeckEntryJSON({ hooks: [{ type: 'command', command: cmd }] }),
    true,
  );
});

test('isEntireEntryJSON detects nested hooks[].command shape', () => {
  assert.strictEqual(
    sig.isEntireEntryJSON({
      hooks: [{ type: 'command', command: '/usr/local/bin/entire hook session-end' }],
    }),
    true,
  );
});

test('classifyEntries buckets {ours, entire, unknown} including nested-shape entries', () => {
  const cmd = path.join(require('os').homedir(), '.vibedeck', 'app', 'hooks', 'notify.cjs');
  const entries = [
    { _vibedeck: 'v1', command: 'a' },
    { command: '/usr/local/bin/entire hook session-end' },
    { command: 'user-custom' },
    { hooks: [{ type: 'command', command: cmd }] },
    { hooks: [{ type: 'command', command: '/usr/local/bin/entire hook session-end' }] },
  ];
  const out = sig.classifyEntries(entries, 'json');
  assert.strictEqual(out.ours.length, 2);
  assert.strictEqual(out.entire.length, 2);
  assert.strictEqual(out.unknown.length, 1);
});

