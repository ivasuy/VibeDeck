const os = require('node:os');
const path = require('node:path');

function getDataDirFallback() {
  return path.join(os.homedir(), '.vibedeck');
}

function canonicalCommandPath() {
  let dataDir = null;
  try {
    // eslint-disable-next-line global-require
    const trackerPaths = require('../tracker-paths');
    if (trackerPaths && typeof trackerPaths.getDataDir === 'function') {
      dataDir = trackerPaths.getDataDir();
    }
  } catch {
    // ignore
  }
  if (!dataDir) dataDir = getDataDirFallback();
  return path.join(dataDir, 'app', 'hooks', 'notify.cjs');
}

const COMMAND_SUFFIX = path.join('.vibedeck', 'app', 'hooks', 'notify.cjs');

function _entryCommandStrings(entry) {
  // Every command-string an entry carries: the flat legacy `entry.command`
  // shape plus the canonical Claude-style `entry.hooks[].command` shape.
  const out = [];
  if (!entry || typeof entry !== 'object') return out;
  if (typeof entry.command === 'string') out.push(entry.command);
  if (Array.isArray(entry.hooks)) {
    for (const h of entry.hooks) {
      if (h && typeof h.command === 'string') out.push(h.command);
    }
  }
  return out;
}

function isVibedeckEntryJSON(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry._vibedeck === 'v1') return true;
  for (const cmd of _entryCommandStrings(entry)) {
    if (cmd.includes(COMMAND_SUFFIX)) return true;
  }
  return false;
}

function isEntireEntryJSON(entry) {
  for (const cmd of _entryCommandStrings(entry)) {
    if (/entire\s+hook\s+session-end/i.test(cmd) || /\bentire\b.*\bhook\b/i.test(cmd)) return true;
  }
  return false;
}

function isVibedeckCommandStringTOML(cmd) {
  if (typeof cmd !== 'string') return false;
  return cmd.includes(COMMAND_SUFFIX);
}

function isEntireCommandStringTOML(cmd) {
  if (typeof cmd !== 'string') return false;
  return /entire\s+hook\s+session-end/i.test(cmd) || /\bentire\b.*\bhook\b/i.test(cmd);
}

function classifyEntries(entries, format) {
  const ours = [];
  const entire = [];
  const unknown = [];

  const list = Array.isArray(entries) ? entries : [];

  if (format === 'toml') {
    for (const entry of list) {
      if (isVibedeckCommandStringTOML(entry)) ours.push(entry);
      else if (isEntireCommandStringTOML(entry)) entire.push(entry);
      else unknown.push(entry);
    }
    return { ours, entire, unknown };
  }

  if (format !== 'json') throw new Error(`Unsupported format: ${format}`);

  for (const entry of list) {
    if (isVibedeckEntryJSON(entry)) ours.push(entry);
    else if (isEntireEntryJSON(entry)) entire.push(entry);
    else unknown.push(entry);
  }

  return { ours, entire, unknown };
}

module.exports = {
  canonicalCommandPath,
  isVibedeckEntryJSON,
  isEntireEntryJSON,
  isVibedeckCommandStringTOML,
  isEntireCommandStringTOML,
  classifyEntries,
};

