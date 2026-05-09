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

function buildInstallPayload(hooksPath) {
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
    return null;
  }

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const content = `${JSON.stringify(nextHooks, null, 2)}\n`;

  return { path: hooksPath, content, validate: (s) => JSON.parse(s) };
}

function buildRemovePayload(hooksPath) {
  const exists = fs.existsSync(hooksPath);
  if (!exists) return null;

  const raw = fs.readFileSync(hooksPath, 'utf8');
  const current = JSON.parse(raw);

  const hooks = normalizeObject(current);
  const entries = normalizeArray(hooks.SessionEnd);

  const nextEntries = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  if (entriesEqual(nextEntries, entries)) return null;

  const nextHooks = { ...hooks, SessionEnd: nextEntries };
  const content = `${JSON.stringify(nextHooks, null, 2)}\n`;

  return { path: hooksPath, content, validate: (s) => JSON.parse(s) };
}

async function install(hooksPath) {
  const payload = buildInstallPayload(hooksPath);
  if (!payload) return { changed: false };
  await runBatch([payload]);
  return { changed: true };
}

async function remove(hooksPath) {
  const payload = buildRemovePayload(hooksPath);
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
