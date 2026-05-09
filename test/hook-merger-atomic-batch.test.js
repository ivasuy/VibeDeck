const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBatch } = require('../src/lib/hook-merger/atomic-batch');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-batch-'));
}

test('happy path — three files renamed atomically', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json');
  const b = path.join(dir, 'b.json');
  const c = path.join(dir, 'c.toml');
  await runBatch([
    { path: a, content: '{"x":1}\n', validate: (s) => JSON.parse(s) },
    { path: b, content: '{"y":2}\n', validate: (s) => JSON.parse(s) },
    { path: c, content: 'name = "z"\n', validate: () => true },
  ]);
  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"x":1}\n');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), '{"y":2}\n');
  assert.strictEqual(fs.readFileSync(c, 'utf8'), 'name = "z"\n');
});

test('phase 1 validation failure aborts before any file is touched', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json');
  fs.writeFileSync(a, '{"orig":true}\n');
  await assert.rejects(() =>
    runBatch([
      { path: a, content: '{"x":1}\n', validate: () => true },
      { path: path.join(dir, 'b.json'), content: 'NOT JSON', validate: (s) => JSON.parse(s) },
    ]),
  );
  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"orig":true}\n');
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('vibedeck-staging'));
  assert.strictEqual(leftovers.length, 0);
});

test('phase 2 mid-flight failure restores all originals', async () => {
  const dir = tmp();
  const a = path.join(dir, 'a.json');
  fs.writeFileSync(a, '{"orig":"a"}\n');
  const b = path.join(dir, 'b.json');
  fs.writeFileSync(b, '{"orig":"b"}\n');

  const cDir = path.join(dir, 'will-disappear');
  fs.mkdirSync(cDir, { recursive: true });
  const c = path.join(cDir, 'c.json');

  await assert.rejects(() =>
    runBatch([
      { path: a, content: '{"new":"a"}\n', validate: (s) => JSON.parse(s) },
      { path: b, content: '{"new":"b"}\n', validate: (s) => JSON.parse(s) },
      {
        path: c,
        content: '{}\n',
        validate: (s) => {
          fs.rmSync(cDir, { recursive: true, force: true });
          return JSON.parse(s);
        },
      },
    ]),
  );

  assert.strictEqual(fs.readFileSync(a, 'utf8'), '{"orig":"a"}\n');
  assert.strictEqual(fs.readFileSync(b, 'utf8'), '{"orig":"b"}\n');
});

test('write to a path whose parent directory does not exist creates it', async () => {
  const dir = tmp();
  const target = path.join(dir, 'deep', 'nested', 'cfg.json');
  await runBatch([{ path: target, content: '{"ok":1}\n', validate: (s) => JSON.parse(s) }]);
  assert.ok(fs.existsSync(target));
});

test('staging tempfiles named .vibedeck-staging-<uuid> and cleaned on success', async () => {
  const dir = tmp();
  const target = path.join(dir, 'cfg.json');
  await runBatch([{ path: target, content: '{}\n', validate: (s) => JSON.parse(s) }]);
  const leftovers = fs.readdirSync(dir).filter((n) => n.includes('vibedeck-staging'));
  assert.deepStrictEqual(leftovers, []);
});

