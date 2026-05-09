const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const opencode = require('../src/lib/hook-merger/opencode');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-opencode-'));
}

function pluginPath(repoRoot, name) {
  return path.join(repoRoot, '.opencode', 'plugins', name);
}

test('1. install creates vibedeck.ts in plugin dir', async () => {
  const repoRoot = tmpRepo();
  await opencode.install(repoRoot);
  assert.ok(fs.existsSync(pluginPath(repoRoot, 'vibedeck.ts')));
});

test('2. existing entire.ts plugin is untouched', async () => {
  const repoRoot = tmpRepo();
  fs.mkdirSync(path.dirname(pluginPath(repoRoot, 'entire.ts')), { recursive: true });
  fs.writeFileSync(pluginPath(repoRoot, 'entire.ts'), '// entire plugin\n');
  await opencode.install(repoRoot);
  assert.strictEqual(fs.readFileSync(pluginPath(repoRoot, 'entire.ts'), 'utf8'), '// entire plugin\n');
});

test('3. existing index.ts is untouched (we do not touch it)', async () => {
  const repoRoot = tmpRepo();
  fs.mkdirSync(path.dirname(pluginPath(repoRoot, 'index.ts')), { recursive: true });
  fs.writeFileSync(pluginPath(repoRoot, 'index.ts'), '// user index\n');
  await opencode.install(repoRoot);
  assert.strictEqual(fs.readFileSync(pluginPath(repoRoot, 'index.ts'), 'utf8'), '// user index\n');
});

test('4. re-install with same content is a no-op (mtime preserved)', async () => {
  const repoRoot = tmpRepo();
  await opencode.install(repoRoot);
  const p = pluginPath(repoRoot, 'vibedeck.ts');
  const before = fs.statSync(p).mtimeMs;
  const beforeContent = fs.readFileSync(p, 'utf8');
  await opencode.install(repoRoot);
  const after = fs.statSync(p).mtimeMs;
  const afterContent = fs.readFileSync(p, 'utf8');
  assert.strictEqual(afterContent, beforeContent);
  assert.strictEqual(after, before);
});

test('5. remove deletes vibedeck.ts only', async () => {
  const repoRoot = tmpRepo();
  fs.mkdirSync(path.dirname(pluginPath(repoRoot, 'entire.ts')), { recursive: true });
  fs.writeFileSync(pluginPath(repoRoot, 'entire.ts'), '// entire plugin\n');
  await opencode.install(repoRoot);
  await opencode.remove(repoRoot);
  assert.strictEqual(fs.existsSync(pluginPath(repoRoot, 'vibedeck.ts')), false);
  assert.strictEqual(fs.existsSync(pluginPath(repoRoot, 'entire.ts')), true);
});

test('6. plugin file content exports the expected named plugin export', async () => {
  const repoRoot = tmpRepo();
  await opencode.install(repoRoot);
  const text = fs.readFileSync(pluginPath(repoRoot, 'vibedeck.ts'), 'utf8');
  assert.ok(/export\s+const\s+VibeDeckPlugin\s*=\s*async\s*\(\s*\{\s*\$\s*\}\s*\)\s*=>/.test(text));
  assert.ok(/--source=opencode/.test(text));
});
