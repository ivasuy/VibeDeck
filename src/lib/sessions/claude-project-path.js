'use strict';

const fs = require('node:fs');
const path = require('node:path');

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function resolveExistingProjectPath(tokens, basePath, index) {
  if (index >= tokens.length) return basePath;
  for (let end = tokens.length; end > index; end -= 1) {
    const segment = tokens.slice(index, end).join('-');
    const nextPath = path.join(basePath, segment);
    if (!isDirectory(nextPath)) continue;
    const resolved = resolveExistingProjectPath(tokens, nextPath, end);
    if (resolved) return resolved;
  }
  return null;
}

function decodeClaudeProjectPathFromSessionFile(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return null;
  const parts = path.normalize(filePath).split(path.sep);
  const projectIdx = parts.lastIndexOf('projects');
  if (projectIdx === -1 || projectIdx + 1 >= parts.length) return null;

  const encoded = parts[projectIdx + 1];
  if (typeof encoded !== 'string' || !encoded.startsWith('-')) return null;

  const tokens = encoded.split('-').filter(Boolean);
  if (tokens.length === 0) return null;

  return resolveExistingProjectPath(tokens, path.sep, 0) || path.join(path.sep, ...tokens);
}

module.exports = { decodeClaudeProjectPathFromSessionFile };
