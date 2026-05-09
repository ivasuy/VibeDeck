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
    type: 'command',
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

function toCursorSchemaV1(parsed) {
  const raw = normalizeObject(parsed);

  if (Object.prototype.hasOwnProperty.call(raw, 'version')) {
    if (raw.version !== 1) {
      const v = raw.version;
      throw new Error(`Unsupported Cursor hooks schema version: ${v}`);
    }
    const hooks = normalizeObject(raw.hooks);
    const sessionEnd = normalizeArray(hooks.sessionEnd);
    return { ...raw, version: 1, hooks: { ...hooks, sessionEnd } };
  }

  // Legacy (Phase B) schema: `{ SessionEnd: [...] }` (no `version`, no `hooks` wrapper).
  const sessionEnd = normalizeArray(raw.SessionEnd);
  const { SessionEnd: _legacySessionEnd, ...rest } = raw;
  return { ...rest, version: 1, hooks: { sessionEnd } };
}

function buildInstallPayload(hooksPath) {
  const exists = fs.existsSync(hooksPath);
  const parsed = exists ? JSON.parse(fs.readFileSync(hooksPath, 'utf8')) : {};
  const current = toCursorSchemaV1(parsed);

  const entries = normalizeArray(current.hooks.sessionEnd);
  const kept = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  const nextEntries = kept.concat([canonicalEntry()]);

  if (entriesEqual(nextEntries, entries)) return null;

  const next = { version: 1, hooks: { ...current.hooks, sessionEnd: nextEntries } };
  const content = `${JSON.stringify(next, null, 2)}\n`;

  return {
    path: hooksPath,
    content,
    validate: (s) => {
      const j = JSON.parse(s);
      if (!j || typeof j !== 'object') throw new Error('cursor hooks must be an object');
      if (j.version !== 1) throw new Error('cursor hooks version must be 1');
      const hooks = normalizeObject(j.hooks);
      if (!Array.isArray(hooks.sessionEnd)) throw new Error('cursor hooks.hooks.sessionEnd must be an array');
      return j;
    },
  };
}

function buildRemovePayload(hooksPath) {
  const exists = fs.existsSync(hooksPath);
  if (!exists) return null;

  const parsed = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
  const current = toCursorSchemaV1(parsed);

  const entries = normalizeArray(current.hooks.sessionEnd);
  const nextEntries = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  if (entriesEqual(nextEntries, entries)) return null;

  const next = { version: 1, hooks: { ...current.hooks, sessionEnd: nextEntries } };
  const content = `${JSON.stringify(next, null, 2)}\n`;

  return {
    path: hooksPath,
    content,
    validate: (s) => {
      const j = JSON.parse(s);
      if (!j || typeof j !== 'object') throw new Error('cursor hooks must be an object');
      if (j.version !== 1) throw new Error('cursor hooks version must be 1');
      const hooks = normalizeObject(j.hooks);
      if (!Array.isArray(hooks.sessionEnd)) throw new Error('cursor hooks.hooks.sessionEnd must be an array');
      return j;
    },
  };
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
