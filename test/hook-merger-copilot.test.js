// GitHub Copilot CLI hooks schema note:
// Verified against GitHub Copilot CLI hooks docs (docs.github.com) as of 2026-05-09.
// Files: `<repoRoot>/.github/hooks/*.json` (multi-file). We exclusively own `vibedeck.json`.
// Schema:
//   { "version": 1, "hooks": { "sessionEnd": [ { "type": "command", "bash": "node /abs/notify.cjs", "powershell": "node 'C:\\path\\notify.cjs'" } ] } }

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const copilot = require('../src/lib/hook-merger/copilot');

function tmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-copilot-repo-'));
}

function vibedeckPath(repoRoot) {
  return path.join(repoRoot, '.github', 'hooks', 'vibedeck.json');
}

function otherToolPath(repoRoot) {
  return path.join(repoRoot, '.github', 'hooks', 'other-tool.json');
}

test('1. install() creates `.github/hooks/vibedeck.json` with correct schema', async () => {
  const repoRoot = tmpRepo();
  await copilot.install(repoRoot);

  const json = JSON.parse(fs.readFileSync(vibedeckPath(repoRoot), 'utf8'));
  assert.strictEqual(json.version, 1);
  assert.ok(json.hooks && typeof json.hooks === 'object');
  assert.ok(Array.isArray(json.hooks.sessionEnd));
  assert.strictEqual(json.hooks.sessionEnd.length, 1);
  assert.strictEqual(json.hooks.sessionEnd[0].type, 'command');
  assert.ok(json.hooks.sessionEnd[0].bash);
  assert.ok(json.hooks.sessionEnd[0].powershell);
});

test('2. install() does not touch other `.github/hooks/*.json` files', async () => {
  const repoRoot = tmpRepo();
  fs.mkdirSync(path.dirname(otherToolPath(repoRoot)), { recursive: true });
  fs.writeFileSync(otherToolPath(repoRoot), '{\"hello\":\"world\"}\\n');

  const before = fs.readFileSync(otherToolPath(repoRoot));
  await copilot.install(repoRoot);
  const after = fs.readFileSync(otherToolPath(repoRoot));
  assert.deepStrictEqual(after, before);
});

test('3. install() is idempotent (mtime unchanged when content already correct)', async () => {
  const repoRoot = tmpRepo();
  await copilot.install(repoRoot);
  const beforeStat = fs.statSync(vibedeckPath(repoRoot));
  await copilot.install(repoRoot);
  const afterStat = fs.statSync(vibedeckPath(repoRoot));
  assert.strictEqual(afterStat.mtimeMs, beforeStat.mtimeMs);
});

test('4. remove() deletes only vibedeck.json; other hook files untouched', async () => {
  const repoRoot = tmpRepo();
  fs.mkdirSync(path.dirname(otherToolPath(repoRoot)), { recursive: true });
  fs.writeFileSync(otherToolPath(repoRoot), '{\"hello\":\"world\"}\\n');
  const otherBefore = fs.readFileSync(otherToolPath(repoRoot));

  await copilot.install(repoRoot);
  await copilot.remove(repoRoot);

  assert.ok(!fs.existsSync(vibedeckPath(repoRoot)));
  assert.deepStrictEqual(fs.readFileSync(otherToolPath(repoRoot)), otherBefore);
});

test('5. install() creates `.github/hooks/` if missing', async () => {
  const repoRoot = tmpRepo();
  assert.ok(!fs.existsSync(path.join(repoRoot, '.github', 'hooks')));
  await copilot.install(repoRoot);
  assert.ok(fs.existsSync(vibedeckPath(repoRoot)));
});

test('6. remove() on a repo without vibedeck.json is a no-op', async () => {
  const repoRoot = tmpRepo();
  await copilot.remove(repoRoot);
  assert.ok(!fs.existsSync(vibedeckPath(repoRoot)));
});
