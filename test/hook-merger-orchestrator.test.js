const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const hookMerger = require('../src/lib/hook-merger');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function copilotOwnedPath(repoRoot) {
  return path.join(repoRoot, '.github', 'hooks', 'vibedeck.json');
}

test('installAll across 3 providers: all 3 written or none', async () => {
  const dir = tmpDir('vd-orch-');
  const claudePath = path.join(dir, 'claude.json');
  const cursorPath = path.join(dir, 'cursor.json');
  const geminiPath = path.join(dir, 'gemini.json');

  fs.writeFileSync(cursorPath, '{ not json');
  await assert.rejects(() =>
    hookMerger.installAll({
      providers: ['claude', 'cursor', 'gemini'],
      paths: { claude: claudePath, cursor: cursorPath, gemini: geminiPath },
    }),
  );

  assert.strictEqual(fs.existsSync(claudePath), false);
  assert.strictEqual(fs.readFileSync(cursorPath, 'utf8'), '{ not json');
  assert.strictEqual(fs.existsSync(geminiPath), false);
});

test('partial provider list installs only those', async () => {
  const dir = tmpDir('vd-orch-partial-');
  const claudePath = path.join(dir, 'claude.json');
  const cursorPath = path.join(dir, 'cursor.json');

  await hookMerger.installAll({ providers: ['claude'], paths: { claude: claudePath, cursor: cursorPath } });
  assert.strictEqual(fs.existsSync(claudePath), true);
  assert.strictEqual(fs.existsSync(cursorPath), false);
});

test('removeAll removes only signed entries across all formats', async () => {
  const dir = tmpDir('vd-orch-remove-');
  const claudePath = path.join(dir, 'claude.json');
  const cursorPath = path.join(dir, 'cursor.json');
  const geminiPath = path.join(dir, 'gemini.json');
  const codexPath = path.join(dir, 'codex.toml');
  const factoryPath = path.join(dir, 'factory.json');
  const codebuddyPath = path.join(dir, 'codebuddy.json');
  const copilotPath = dir;

  await hookMerger.installAll({
    providers: ['claude', 'cursor', 'gemini', 'codex', 'factory', 'codebuddy', 'copilot'],
    paths: {
      claude: claudePath,
      cursor: cursorPath,
      gemini: geminiPath,
      codex: codexPath,
      factory: factoryPath,
      codebuddy: codebuddyPath,
      copilot: copilotPath,
    },
  });

  // Add an Entire marker + manual entries to prove removeAll keeps them.
  {
    const json = readJson(claudePath);
    json.hooks.SessionEnd.push({ command: '/usr/local/bin/entire hook session-end' });
    json.hooks.SessionEnd.push({ command: 'echo manual' });
    fs.writeFileSync(claudePath, JSON.stringify(json, null, 2));
  }
  fs.appendFileSync(codexPath, "notify = ['/usr/local/bin/entire hook session-end']\n");

  await hookMerger.removeAll({
    providers: ['claude', 'cursor', 'gemini', 'codex', 'factory', 'codebuddy', 'copilot'],
    paths: {
      claude: claudePath,
      cursor: cursorPath,
      gemini: geminiPath,
      codex: codexPath,
      factory: factoryPath,
      codebuddy: codebuddyPath,
      copilot: copilotPath,
    },
  });

  const claudeOut = readJson(claudePath);
  assert.strictEqual(claudeOut.hooks.SessionEnd.filter((e) => e && e._vibedeck === 'v1').length, 0);
  assert.strictEqual(claudeOut.hooks.SessionEnd.filter((e) => /entire/.test(e.command || '')).length, 1);
  assert.strictEqual(claudeOut.hooks.SessionEnd.filter((e) => /manual/.test(e.command || '')).length, 1);
});

test('install is idempotent across the full set', async () => {
  const dir = tmpDir('vd-orch-idem-');
  const paths = {
    claude: path.join(dir, 'claude.json'),
    cursor: path.join(dir, 'cursor.json'),
    gemini: path.join(dir, 'gemini.json'),
    codex: path.join(dir, 'codex.toml'),
    factory: path.join(dir, 'factory.json'),
    codebuddy: path.join(dir, 'codebuddy.json'),
    copilot: dir,
  };

  await hookMerger.installAll({ providers: Object.keys(paths), paths });
  const before = {};
  for (const [k, p] of Object.entries(paths)) {
    before[k] = fs.readFileSync(k === 'copilot' ? copilotOwnedPath(p) : p, 'utf8');
  }

  await hookMerger.installAll({ providers: Object.keys(paths), paths });
  for (const [k, p] of Object.entries(paths)) {
    assert.strictEqual(fs.readFileSync(k === 'copilot' ? copilotOwnedPath(p) : p, 'utf8'), before[k]);
  }
});
