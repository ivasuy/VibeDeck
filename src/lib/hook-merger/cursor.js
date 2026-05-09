const fs = require('node:fs');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');
const { buildHookCommand } = require('../claude-config');

function normalizeObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function normalizeArray(raw) {
  return Array.isArray(raw) ? raw.slice() : [];
}

function canonicalEntry() {
  const notifyPath = signature.canonicalCommandPath();
  return {
    _vibedeck: 'v1',
    command: buildHookCommand(notifyPath, 'cursor'),
  };
}

function entriesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function install(hooksPath) {
  const exists = fs.existsSync(hooksPath);
  let current = {};
  if (exists) {
    const raw = fs.readFileSync(hooksPath, 'utf8');
    current = JSON.parse(raw);
  }

  const hooks = normalizeObject(current);
  const entries = normalizeArray(hooks.SessionEnd);

  const kept = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  const nextEntries = kept.concat([canonicalEntry()]);

  if (entriesEqual(nextEntries, entries) && hooks.SessionEnd) {
    return { changed: false };
  }

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const content = `${JSON.stringify(nextHooks, null, 2)}\n`;

  await runBatch([{ path: hooksPath, content, validate: (s) => JSON.parse(s) }]);
  return { changed: true };
}

async function remove(hooksPath) {
  const exists = fs.existsSync(hooksPath);
  if (!exists) return { changed: false };

  const raw = fs.readFileSync(hooksPath, 'utf8');
  const current = JSON.parse(raw);

  const hooks = normalizeObject(current);
  const entries = normalizeArray(hooks.SessionEnd);

  const nextEntries = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  if (entriesEqual(nextEntries, entries)) return { changed: false };

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const content = `${JSON.stringify(nextHooks, null, 2)}\n`;

  await runBatch([{ path: hooksPath, content, validate: (s) => JSON.parse(s) }]);
  return { changed: true };
}

module.exports = {
  install,
  remove,
};

