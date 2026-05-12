'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const {
  ensureDir,
  readJsonStrict,
  writeJson,
  writeFileAtomic,
  chmod600IfPossible,
} = require('../fs');

function resolveReadmeSyncRoot() {
  return process.env.VIBEDECK_HOME || path.join(os.homedir(), '.vibedeck');
}

function resolveReadmeSyncPaths() {
  const rootDir = resolveReadmeSyncRoot();
  return {
    rootDir,
    configPath: path.join(rootDir, 'readme-sync.json'),
    tokenPath: path.join(rootDir, 'github.token'),
  };
}

function parseRepoRef(repoRef) {
  const raw = String(repoRef || '').trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
  if (!match) throw new Error('Expected --repo owner/repo');
  return { owner: match[1], repo: match[2] };
}

async function readReadmeSyncConfig() {
  const { configPath } = resolveReadmeSyncPaths();
  const result = await readJsonStrict(configPath);
  return result.status === 'ok' ? result.value : null;
}

async function writeReadmeSyncConfig(config) {
  const { rootDir, configPath } = resolveReadmeSyncPaths();
  await ensureDir(rootDir);
  await writeJson(configPath, config);
}

async function readGitHubToken() {
  const { tokenPath } = resolveReadmeSyncPaths();
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    const token = raw.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

async function writeGitHubToken(token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Expected non-empty --token');
  const { rootDir, tokenPath } = resolveReadmeSyncPaths();
  await ensureDir(rootDir);
  await writeFileAtomic(tokenPath, `${value}\n`);
  await chmod600IfPossible(tokenPath);
}

async function removeReadmeSyncState() {
  const { configPath, tokenPath } = resolveReadmeSyncPaths();
  await fs.unlink(configPath).catch(() => {});
  await fs.unlink(tokenPath).catch(() => {});
}

module.exports = {
  parseRepoRef,
  resolveReadmeSyncPaths,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  readGitHubToken,
  writeGitHubToken,
  removeReadmeSyncState,
};
