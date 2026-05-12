const path = require('node:path');

const { runBatch } = require('./atomic-batch');

const claude = require('./claude');
const codebuddy = require('./codebuddy');
const codex = require('./codex');
const cursor = require('./cursor');
const gemini = require('./gemini');
const factory = require('./factory');
const copilot = require('./copilot');
const opencode = require('./opencode');

const MERGERS = {
  claude,
  codebuddy,
  codex,
  cursor,
  gemini,
  factory,
  copilot,
  opencode,
};

function normalizeProviders(providers) {
  const list = Array.isArray(providers) ? providers : [];
  const out = [];
  const seen = new Set();
  for (const p of list) {
    const name = String(p || '').trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function resolveProviderTarget(provider, paths) {
  if (!paths || typeof paths !== 'object') throw new Error('paths is required');
  const raw = paths[provider];
  if (provider === 'opencode' || provider === 'copilot') {
    const repoRoot = String(raw || '').trim();
    if (!repoRoot) throw new Error(`paths.${provider} must be a repo root`);
    return path.resolve(repoRoot);
  }
  const filePath = String(raw || '').trim();
  if (!filePath) throw new Error(`paths.${provider} must be a file path`);
  return path.resolve(filePath);
}

async function installAll({ providers, paths }) {
  const list = normalizeProviders(providers);
  const payloads = [];

  for (const provider of list) {
    const merger = MERGERS[provider];
    if (!merger) throw new Error(`Unsupported provider: ${provider}`);
    if (typeof merger.buildInstallPayload !== 'function') {
      throw new Error(`Provider merger missing buildInstallPayload: ${provider}`);
    }
    const target = resolveProviderTarget(provider, paths);
    const payload = merger.buildInstallPayload(target);
    if (payload) payloads.push(payload);
  }

  await runBatch(payloads);
  return { changed: payloads.length > 0 };
}

async function removeAll({ providers, paths }) {
  const list = normalizeProviders(providers);
  const payloads = [];

  for (const provider of list) {
    const merger = MERGERS[provider];
    if (!merger) throw new Error(`Unsupported provider: ${provider}`);
    if (typeof merger.buildRemovePayload !== 'function') {
      throw new Error(`Provider merger missing buildRemovePayload: ${provider}`);
    }
    const target = resolveProviderTarget(provider, paths);
    const payload = merger.buildRemovePayload(target);
    if (payload) payloads.push(payload);
  }

  await runBatch(payloads);
  return { changed: payloads.length > 0 };
}

module.exports = {
  installAll,
  removeAll,
};
