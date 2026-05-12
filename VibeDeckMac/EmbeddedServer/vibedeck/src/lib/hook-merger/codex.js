const fs = require('node:fs');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');

function formatTomlStringArray(arr) {
  return `[${arr.map((s) => JSON.stringify(String(s))).join(', ')}]`;
}

function stripInlineComment(rhs) {
  const s = String(rhs || '');
  let inString = false;
  let quote = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!inString) {
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        continue;
      }
      if (ch === '#') return s.slice(0, i);
      continue;
    }
    if (ch === quote) {
      inString = false;
      quote = null;
    }
  }
  return s;
}

function parseTomlStringLiteral(rhs) {
  const trimmed = stripInlineComment(rhs).trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return null;
}

function parseTomlStringArray(literal) {
  // Minimal parser for ["a", "b"] string arrays.
  // Assumes there are no escapes in strings (good enough for our usage).
  const rhs = String(literal || '').trim();
  if (!rhs.startsWith('[') || !rhs.endsWith(']')) return null;
  const inner = rhs.slice(1, -1).trim();
  if (!inner) return [];

  const parts = [];
  let current = '';
  let inString = false;
  let quote = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (!inString) {
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        current = '';
      }
      continue;
    }
    if (ch === quote) {
      parts.push(current);
      inString = false;
      quote = null;
      continue;
    }
    current += ch;
  }

  return parts.length > 0 ? parts : null;
}

function readTomlArrayLiteral(lines, startIndex, rhs) {
  const first = stripInlineComment(rhs).trim();
  if (!first.startsWith('[')) return null;

  let inString = false;
  let quote = null;
  let depth = 0;
  let sawOpen = false;

  function scanChunk(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (!inString) {
        if (ch === '"' || ch === "'") {
          inString = true;
          quote = ch;
          continue;
        }
        if (ch === '[') {
          depth += 1;
          sawOpen = true;
          continue;
        }
        if (ch === ']') {
          depth -= 1;
          if (sawOpen && depth === 0) return i;
        }
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = null;
      }
    }
    return -1;
  }

  const parts = [first];
  let endPos = scanChunk(first);
  if (endPos !== -1) return first.slice(0, endPos + 1).trim();

  for (let j = startIndex + 1; j < lines.length; j++) {
    const line = lines[j];
    endPos = scanChunk(line);
    if (endPos !== -1) {
      parts.push(line.slice(0, endPos + 1));
      return parts.join('\n').trim();
    }
    parts.push(line);
  }

  return null;
}

function findTomlArrayBlockEnd(lines, startIndex, rhs) {
  const first = stripInlineComment(rhs).trim();
  if (!first.startsWith('[')) return startIndex;

  let inString = false;
  let quote = null;
  let depth = 0;
  let sawOpen = false;

  function scanChunk(chunk) {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i];
      if (!inString) {
        if (ch === '"' || ch === "'") {
          inString = true;
          quote = ch;
          continue;
        }
        if (ch === '[') {
          depth += 1;
          sawOpen = true;
          continue;
        }
        if (ch === ']') {
          depth -= 1;
          if (sawOpen && depth === 0) return true;
        }
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = null;
      }
    }
    return false;
  }

  if (scanChunk(first)) return startIndex;
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (scanChunk(lines[j])) return j;
  }
  return startIndex;
}

function extractNotifyValues(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!m) continue;

    const rhs = stripInlineComment(m[1] || '').trim();
    if (!rhs) throw new Error('Malformed notify value');

    if (rhs.startsWith('[')) {
      const literal = readTomlArrayLiteral(lines, i, rhs);
      if (!literal) throw new Error('Malformed notify array');
      const parsed = parseTomlStringArray(literal);
      if (!parsed) throw new Error('Malformed notify array');
      out.push(...parsed);
      i = findTomlArrayBlockEnd(lines, i, rhs);
      continue;
    }

    const parsed = parseTomlStringLiteral(rhs);
    if (parsed == null) throw new Error('Malformed notify string');
    out.push(parsed);
  }

  return out;
}

function removeNotifyAssignments(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!m) {
      out.push(line);
      continue;
    }

    const rhs = stripInlineComment(m[1] || '').trim();
    if (rhs.startsWith('[')) {
      i = findTomlArrayBlockEnd(lines, i, rhs);
    }
  }

  return out.join('\n').replace(/\n+$/, '\n');
}

function injectNotifyArray(text, notifyArray) {
  const cleaned = removeNotifyAssignments(text);
  const lines = cleaned.split(/\r?\n/);
  const notifyLine = `notify = ${formatTomlStringArray(notifyArray)}`;

  // Insert at top-level, before the first table header.
  const firstTableIdx = lines.findIndex((l) => /^\s*\[/.test(l));
  const headerIdx = firstTableIdx === -1 ? lines.length : firstTableIdx;
  lines.splice(headerIdx, 0, notifyLine);

  return lines.join('\n').replace(/\n+$/, '\n');
}

function entriesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function validateTomlWithNotify(content) {
  // Validate that notify can be re-extracted and the file isn't malformed
  // in the ways we care about (broken notify assignment).
  extractNotifyValues(content);
}

function buildInstallPayload(configPath) {
  const exists = fs.existsSync(configPath);
  const raw = exists ? fs.readFileSync(configPath, 'utf8') : '';

  const notify = extractNotifyValues(raw);
  const normalized = Array.isArray(notify) ? notify : [];
  const { entire, unknown } = signature.classifyEntries(normalized, 'toml');

  const ours = [signature.canonicalCommandPath()];
  const nextNotify = ours.concat(entire, unknown);

  const currentOnly = normalized.filter((v) => typeof v === 'string');
  if (entriesEqual(nextNotify, currentOnly) && /^\s*notify\s*=/.test(raw)) {
    return null;
  }

  const content = injectNotifyArray(raw, nextNotify);
  return { path: configPath, content, validate: validateTomlWithNotify };
}

function buildRemovePayload(configPath) {
  const exists = fs.existsSync(configPath);
  if (!exists) return null;

  const raw = fs.readFileSync(configPath, 'utf8');
  const notify = extractNotifyValues(raw);
  const normalized = Array.isArray(notify) ? notify : [];
  const { ours, entire, unknown } = signature.classifyEntries(normalized, 'toml');

  const nextNotify = entire.concat(unknown);
  if (entriesEqual(nextNotify, normalized)) return null;

  // If the file's notify consisted solely of our injected hook, remove the notify
  // assignment entirely (restore the "notify absent" state).
  if (ours.length > 0 && nextNotify.length === 0) {
    const content = removeNotifyAssignments(raw);
    return { path: configPath, content, validate: validateTomlWithNotify };
  }

  const content = injectNotifyArray(raw, nextNotify);
  return { path: configPath, content, validate: validateTomlWithNotify };
}

async function install(configPath) {
  const payload = buildInstallPayload(configPath);
  if (!payload) return { changed: false };
  await runBatch([payload]);
  return { changed: true };
}

async function remove(configPath) {
  const payload = buildRemovePayload(configPath);
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
