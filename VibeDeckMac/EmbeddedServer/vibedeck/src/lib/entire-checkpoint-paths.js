'use strict';

function decodeCheckpointPath(value) {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeCheckpointPath(value) {
  return decodeCheckpointPath(value).replace(/\\/g, '/');
}

function isValidCheckpointPath(value) {
  const normalized = normalizeCheckpointPath(value);
  if (!normalized) return false;
  if (normalized.includes('\0')) return false;
  if (/^[A-Za-z]:/.test(normalized)) return false;
  if (normalized.startsWith('/')) return false;

  const segments = normalized.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return false;
  }

  return true;
}

module.exports = {
  normalizeCheckpointPath,
  isValidCheckpointPath,
};
