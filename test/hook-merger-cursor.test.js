// Cursor hooks schema note:
// Verified against Cursor hooks docs (cursor.com/docs/hooks) as of 2026-05-09.
// File: `<repoRoot>/.cursor/hooks.json`
// Schema:
//   { "version": 1, "hooks": { "sessionEnd": [ { "type": "command", "command": "/abs/path.sh" } ] } }

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cursor = require('../src/lib/hook-merger/cursor');

function tmpFile(initial) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cursor-')), 'hooks.json');
  if (initial != null) fs.writeFileSync(f, initial);
  return f;
}

test('1. empty file: install adds vibedeck entry', async () => {
  const f = tmpFile(null);
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.version, 1);
  assert.ok(json.hooks && typeof json.hooks === 'object');
  assert.ok(Array.isArray(json.hooks.sessionEnd));
  assert.strictEqual(json.hooks.sessionEnd.filter((e) => e && e._vibedeck === 'v1').length, 1);
});

test('2. existing Entire entry preserved alongside vibedeck', async () => {
  const f = tmpFile(
    JSON.stringify(
      { version: 1, hooks: { sessionEnd: [{ type: 'command', command: '/usr/local/bin/entire hook session-end' }] } },
      null,
      2
    )
  );
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entire = json.hooks.sessionEnd.filter((e) => /entire/.test(e.command || ''));
  const ours = json.hooks.sessionEnd.filter((e) => e && e._vibedeck === 'v1');
  assert.strictEqual(entire.length, 1);
  assert.strictEqual(ours.length, 1);
});

test('3. existing user-manual entry preserved', async () => {
  const f = tmpFile(JSON.stringify({ version: 1, hooks: { sessionEnd: [{ command: 'echo hi' }] } }, null, 2));
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.hooks.sessionEnd.length, 2);
});

test('4. re-install with current signature is a no-op (idempotent)', async () => {
  const f = tmpFile(null);
  await cursor.install(f);
  const before = fs.readFileSync(f, 'utf8');
  await cursor.install(f);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before);
});

test('5. malformed JSON aborts and never overwrites', async () => {
  const f = tmpFile('{ this is not json');
  await assert.rejects(() => cursor.install(f));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ this is not json');
});

test('6. schema version != 1 aborts and never overwrites', async () => {
  const initial = JSON.stringify({ version: 2, hooks: { sessionEnd: [] } }, null, 2);
  const f = tmpFile(initial);
  await assert.rejects(() => cursor.install(f));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), initial);
});

test('7. remove deletes only ours; entire and user entries untouched', async () => {
  const f = tmpFile(null);
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  json.hooks.sessionEnd.push({ type: 'command', command: '/usr/local/bin/entire hook session-end' });
  json.hooks.sessionEnd.push({ command: 'echo manual' });
  fs.writeFileSync(f, JSON.stringify(json, null, 2));
  await cursor.remove(f);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(out.hooks.sessionEnd.filter((e) => e && e._vibedeck === 'v1').length, 0);
  assert.strictEqual(out.hooks.sessionEnd.length, 2);
});
