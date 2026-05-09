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

function isVibedeckEntryJSON(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry._vibedeck === 'v1') return true;
  if (typeof entry.command !== 'string') return false;
  return entry.command.includes(COMMAND_SUFFIX);
}

function isEntireEntryJSON(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (typeof entry.command !== 'string') return false;
  const cmd = entry.command;
  return /entire\s+hook\s+session-end/i.test(cmd) || /\bentire\b.*\bhook\b/i.test(cmd);
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

