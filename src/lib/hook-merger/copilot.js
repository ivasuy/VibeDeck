const fs = require('node:fs');
const path = require('node:path');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');

function normalizeObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function hooksFilePath(repoRoot) {
  return path.join(repoRoot, '.github', 'hooks', 'vibedeck.json');
}

function buildCommands() {
  const canonical = signature.canonicalCommandPath();
  const bash = `node ${canonical}`;
  const windowsPath = path.win32.normalize(canonical);
  const powershell = `node '${windowsPath}'`;
  return { bash, powershell };
}

function buildHookJson() {
  const { bash, powershell } = buildCommands();
  return {
    version: 1,
    hooks: {
      sessionEnd: [
        {
          _vibedeck: 'v1',
          type: 'command',
          bash,
          powershell,
        },
      ],
    },
  };
}

function validateHooksJsonString(s) {
  const j = JSON.parse(s);
  if (!j || typeof j !== 'object') throw new Error('copilot hooks must be an object');
  if (j.version !== 1) throw new Error('copilot hooks version must be 1');
  const hooks = normalizeObject(j.hooks);
  if (!Array.isArray(hooks.sessionEnd)) throw new Error('copilot hooks.hooks.sessionEnd must be an array');
  return j;
}

function buildInstallPayload(repoRoot) {
  const root = path.resolve(String(repoRoot || ''));
  const filePath = hooksFilePath(root);

  const nextObj = buildHookJson();
  const content = `${JSON.stringify(nextObj, null, 2)}\n`;

  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === content) return null;
  }

  return { path: filePath, content, validate: validateHooksJsonString };
}

function buildRemovePayload(repoRoot) {
  const root = path.resolve(String(repoRoot || ''));
  const filePath = hooksFilePath(root);
  if (!fs.existsSync(filePath)) return null;
  return {
    path: filePath,
    op: 'delete',
    validate: () => {},
  };
}

async function install(repoRoot) {
  const payload = buildInstallPayload(repoRoot);
  if (!payload) return { changed: false };
  await runBatch([payload]);
  return { changed: true };
}

async function remove(repoRoot) {
  const payload = buildRemovePayload(repoRoot);
  if (!payload) return { changed: false };
  await runBatch([payload]);
  return { changed: true };
}

module.exports = {
  buildInstallPayload,
  buildRemovePayload,
  install,
  remove,
};

