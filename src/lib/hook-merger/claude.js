const fs = require('node:fs');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');
const { buildClaudeHookCommand } = require('../claude-config');

function normalizeObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function normalizeArray(raw) {
  return Array.isArray(raw) ? raw.slice() : [];
}

function canonicalEntry() {
  const notifyPath = signature.canonicalCommandPath();
  const hookCommand = buildClaudeHookCommand(notifyPath);
  return {
    _vibedeck: 'v1',
    hooks: [{ type: 'command', command: hookCommand }],
  };
}

function entriesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function install(settingsPath) {
  const exists = fs.existsSync(settingsPath);
  let current = {};
  if (exists) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    current = JSON.parse(raw);
  }

  const settings = normalizeObject(current);
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks.SessionEnd);

  const kept = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  const nextEntries = kept.concat([canonicalEntry()]);

  if (entriesEqual(nextEntries, entries) && settings.hooks && hooks.SessionEnd) {
    return { changed: false };
  }

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const nextSettings = { ...settings, hooks: nextHooks };
  const content = `${JSON.stringify(nextSettings, null, 2)}\n`;

  await runBatch([{ path: settingsPath, content, validate: (s) => JSON.parse(s) }]);
  return { changed: true };
}

async function remove(settingsPath) {
  const exists = fs.existsSync(settingsPath);
  if (!exists) return { changed: false };

  const raw = fs.readFileSync(settingsPath, 'utf8');
  const current = JSON.parse(raw);

  const settings = normalizeObject(current);
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks.SessionEnd);

  const nextEntries = entries.filter((e) => !(e && typeof e === 'object' && e._vibedeck === 'v1'));
  if (entriesEqual(nextEntries, entries)) return { changed: false };

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const nextSettings = { ...settings, hooks: nextHooks };
  const content = `${JSON.stringify(nextSettings, null, 2)}\n`;

  await runBatch([{ path: settingsPath, content, validate: (s) => JSON.parse(s) }]);
  return { changed: true };
}

module.exports = {
  install,
  remove,
};

