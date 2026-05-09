const fs = require('node:fs');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');
const { buildGeminiHookCommand } = require('../gemini-config');

const DEFAULT_EVENT = 'SessionEnd';
const DEFAULT_HOOK_NAME = 'tokentracker';
const DEFAULT_MATCHER = 'exit|clear|logout|prompt_input_exit|other';

function normalizeObject(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function normalizeArray(raw) {
  return Array.isArray(raw) ? raw.slice() : [];
}

function canonicalEntry() {
  const notifyPath = signature.canonicalCommandPath();
  const hookCommand = buildGeminiHookCommand(notifyPath);
  return {
    _vibedeck: 'v1',
    matcher: DEFAULT_MATCHER,
    hooks: [
      {
        name: DEFAULT_HOOK_NAME,
        type: 'command',
        command: hookCommand,
      },
    ],
  };
}

function entriesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function buildInstallPayload(settingsPath) {
  const exists = fs.existsSync(settingsPath);
  let current = {};
  if (exists) {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    current = JSON.parse(raw);
  }

  const settings = normalizeObject(current);
  const tools = normalizeObject(settings.tools);
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[DEFAULT_EVENT]);

  const kept = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  const nextEntries = kept.concat([canonicalEntry()]);

  const nextTools = tools.enableHooks === true ? tools : { ...tools, enableHooks: true };
  const nextHooks = { ...hooks, [DEFAULT_EVENT]: nextEntries };
  const nextSettings = { ...settings, tools: nextTools, hooks: nextHooks };

  if (entriesEqual(nextSettings, settings) && settings.hooks && hooks[DEFAULT_EVENT]) {
    return null;
  }

  const content = `${JSON.stringify(nextSettings, null, 2)}\n`;
  return { path: settingsPath, content, validate: (s) => JSON.parse(s) };
}

function buildRemovePayload(settingsPath) {
  const exists = fs.existsSync(settingsPath);
  if (!exists) return null;

  const raw = fs.readFileSync(settingsPath, 'utf8');
  const current = JSON.parse(raw);

  const settings = normalizeObject(current);
  const hooks = normalizeObject(settings.hooks);
  const entries = normalizeArray(hooks[DEFAULT_EVENT]);

  const nextEntries = entries.filter((e) => !signature.isVibedeckEntryJSON(e));
  if (entriesEqual(nextEntries, entries)) return null;

  const nextHooks = { ...hooks, [DEFAULT_EVENT]: nextEntries };
  const nextSettings = { ...settings, hooks: nextHooks };
  const content = `${JSON.stringify(nextSettings, null, 2)}\n`;

  return { path: settingsPath, content, validate: (s) => JSON.parse(s) };
}

async function install(settingsPath) {
  const payload = buildInstallPayload(settingsPath);
  if (!payload) return { changed: false };
  await runBatch([payload]);
  return { changed: true };
}

async function remove(settingsPath) {
  const payload = buildRemovePayload(settingsPath);
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
