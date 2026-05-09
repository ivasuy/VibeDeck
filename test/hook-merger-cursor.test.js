// Cursor hooks schema note:
// This repo's Plan 3 defines Cursor hooks at `.cursor/hooks.json` with a
// top-level `SessionEnd` array (no `hooks` wrapper). This test suite locks
// that choice so B3 review can confirm against Cursor's real behavior.

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
  assert.strictEqual(json.SessionEnd.filter((e) => e && e._vibedeck === 'v1').length, 1);
});

test('2. existing Entire entry preserved alongside vibedeck', async () => {
  const f = tmpFile(JSON.stringify({ SessionEnd: [{ command: '/usr/local/bin/entire hook session-end' }] }, null, 2));
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entire = json.SessionEnd.filter((e) => /entire/.test(e.command || ''));
  const ours = json.SessionEnd.filter((e) => e && e._vibedeck === 'v1');
  assert.strictEqual(entire.length, 1);
  assert.strictEqual(ours.length, 1);
});

test('3. existing user-manual entry preserved', async () => {
  const f = tmpFile(JSON.stringify({ SessionEnd: [{ command: 'echo hi' }] }, null, 2));
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.SessionEnd.length, 2);
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

test('6. remove deletes only ours; entire and user entries untouched', async () => {
  const f = tmpFile(null);
  await cursor.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  json.SessionEnd.push({ command: '/usr/local/bin/entire hook session-end' });
  json.SessionEnd.push({ command: 'echo manual' });
  fs.writeFileSync(f, JSON.stringify(json, null, 2));
  await cursor.remove(f);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(out.SessionEnd.filter((e) => e && e._vibedeck === 'v1').length, 0);
  assert.strictEqual(out.SessionEnd.length, 2);
});

