const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const codex = require('../src/lib/hook-merger/codex');
const signature = require('../src/lib/hook-merger/signature');

function tmpFile(initial) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codex-')), 'config.toml');
  if (initial != null) fs.writeFileSync(f, initial);
  return f;
}

function parseNotifyArray(text) {
  const m = text.match(/^\s*notify\s*=\s*(\[[^\]]*\])\s*$/m);
  if (!m) return null;
  return JSON.parse(m[1]);
}

test('1. empty file: install adds vibedeck notify entry', async () => {
  const f = tmpFile(null);
  await codex.install(f);
  const notify = parseNotifyArray(fs.readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(notify));
  assert.ok(notify.includes(signature.canonicalCommandPath()));
});

test('2. existing Entire entry preserved alongside vibedeck', async () => {
  const f = tmpFile('notify = ["entire hook session-end"]\n');
  await codex.install(f);
  const notify = parseNotifyArray(fs.readFileSync(f, 'utf8'));
  assert.ok(notify.includes('entire hook session-end'));
  assert.ok(notify.includes(signature.canonicalCommandPath()));
});

test('3. existing user-manual entry preserved', async () => {
  const f = tmpFile('notify = ["echo hi"]\n');
  await codex.install(f);
  const notify = parseNotifyArray(fs.readFileSync(f, 'utf8'));
  assert.strictEqual(notify.length, 2);
  assert.ok(notify.includes('echo hi'));
});

test('4. re-install with current signature is a no-op (idempotent)', async () => {
  const f = tmpFile(null);
  await codex.install(f);
  const before = fs.readFileSync(f, 'utf8');
  await codex.install(f);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), before);
});

test('5. malformed TOML aborts and never overwrites', async () => {
  const f = tmpFile('notify = ["unterminated"\n');
  await assert.rejects(() => codex.install(f));
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'notify = ["unterminated"\n');
});

test('6. remove deletes only ours; entire and user entries untouched', async () => {
  const f = tmpFile('notify = ["echo manual", "entire hook session-end"]\n');
  await codex.install(f);
  await codex.remove(f);
  const notify = parseNotifyArray(fs.readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(notify));
  assert.ok(!notify.includes(signature.canonicalCommandPath()));
  assert.ok(notify.includes('entire hook session-end'));
  assert.ok(notify.includes('echo manual'));
});

test('7. notify defined as a single string is promoted to array, then merged', async () => {
  const f = tmpFile('notify = "echo single"\n');
  await codex.install(f);
  const notify = parseNotifyArray(fs.readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(notify));
  assert.ok(notify.includes(signature.canonicalCommandPath()));
  assert.ok(notify.includes('echo single'));
});

test('8. remove restores notify-absent state when we were the only notify entry', async () => {
  const f = tmpFile('name = "x"\n');
  await codex.install(f);
  await codex.remove(f);
  const out = fs.readFileSync(f, 'utf8');
  assert.strictEqual(parseNotifyArray(out), null);
  assert.ok(out.includes('name = "x"'));
});
