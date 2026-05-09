const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const copilot = require('../src/lib/hook-merger/copilot');

function tmpFile(initial) {
  // Copilot is OpenTelemetry-based today, but for collision-safe session boundary hooks
  // we standardize on a Claude-like JSON hook file under `.github/hooks/copilot.json`.
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-copilot-')), 'copilot.json');
  if (initial != null) fs.writeFileSync(f, initial);
  return f;
}

test('1. empty file: install adds vibedeck entry', async () => {
  const f = tmpFile(null);
  await copilot.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1').length, 1);
});

test('2. existing Entire entry preserved alongside vibedeck', async () => {
  const f = tmpFile(
    JSON.stringify({ hooks: { SessionEnd: [{ command: '/usr/local/bin/entire hook session-end' }] } }, null, 2),
  );
  await copilot.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  const entire = json.hooks.SessionEnd.filter((e) => /entire/.test(e.command || ''));
  const ours = json.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1');
  assert.strictEqual(entire.length, 1);
  assert.strictEqual(ours.length, 1);
});

test('3. existing user-manual entry preserved', async () => {
  const f = tmpFile(JSON.stringify({ hooks: { SessionEnd: [{ command: 'echo hi' }] } }, null, 2));
  await copilot.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(json.hooks.SessionEnd.length, 2);
});

test('4. re-install with current signature is a no-op (idempotent)', async () => {
  const f = tmpFile(null);
  await copilot.install(f);
  const before = fs.readFileSync(f, 'utf8');
  await copilot.install(f);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before);
});

test('5. malformed JSON aborts and never overwrites', async () => {
  const f = tmpFile('{ this is not json');
  await assert.rejects(() => copilot.install(f));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), '{ this is not json');
});

test('6. remove deletes only ours; entire and user entries untouched', async () => {
  const f = tmpFile(null);
  await copilot.install(f);
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  json.hooks.SessionEnd.push({ command: '/usr/local/bin/entire hook session-end' });
  json.hooks.SessionEnd.push({ command: 'echo manual' });
  fs.writeFileSync(f, JSON.stringify(json, null, 2));
  await copilot.remove(f);
  const out = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(out.hooks.SessionEnd.filter((e) => e._vibedeck === 'v1').length, 0);
  assert.strictEqual(out.hooks.SessionEnd.length, 2);
});

