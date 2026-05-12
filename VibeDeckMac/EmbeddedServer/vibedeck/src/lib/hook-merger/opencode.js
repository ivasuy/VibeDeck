const fs = require('node:fs');
const path = require('node:path');

const { runBatch } = require('./atomic-batch');
const signature = require('./signature');

const PLUGIN_MARKER = 'VIBEDECK_OPENCODE_PLUGIN';

function resolvePluginDir(repoRoot) {
  return path.join(repoRoot, '.opencode', 'plugins');
}

function resolvePluginPath(repoRoot) {
  return path.join(resolvePluginDir(repoRoot), 'vibedeck.ts');
}

function buildPluginTS({ notifyPath }) {
  const safeNotifyPath = typeof notifyPath === 'string' ? notifyPath : '';
  return (
    `// ${PLUGIN_MARKER}\n` +
    `const notifyPath = ${JSON.stringify(safeNotifyPath)};\n` +
    `export const VibeDeckPlugin = async ({ $ }) => {\n` +
    `  return {\n` +
    `    event: async ({ event }) => {\n` +
    `      if (!event || event.type !== 'session.updated') return;\n` +
    `      try {\n` +
    `        if (!notifyPath) return;\n` +
    `        const proc = $\`/usr/bin/env node ${"${notifyPath}"} --source=opencode\`;\n` +
    `        if (proc && typeof proc.catch === 'function') proc.catch(() => {});\n` +
    `      } catch (_) {}\n` +
    `    }\n` +
    `  };\n` +
    `};\n`
  );
}

function buildInstallPayload(repoRoot) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const pluginPath = resolvePluginPath(repoRoot);
  const next = buildPluginTS({ notifyPath: signature.canonicalCommandPath() });
  const existing = fs.existsSync(pluginPath) ? fs.readFileSync(pluginPath, 'utf8') : null;

  if (existing === next) return null;
  return { path: pluginPath, content: next, validate: () => {} };
}

function buildRemovePayload(repoRoot) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const pluginPath = resolvePluginPath(repoRoot);
  const existing = fs.existsSync(pluginPath) ? fs.readFileSync(pluginPath, 'utf8') : null;
  if (existing == null) return null;
  if (typeof existing === 'string' && existing.includes(PLUGIN_MARKER)) {
    return { path: pluginPath, op: 'delete', content: '', validate: () => {} };
  }
  return null;
}

async function install(repoRoot) {
  const payload = buildInstallPayload(repoRoot);
  if (!payload) return { changed: false, pluginPath: resolvePluginPath(repoRoot) };
  await runBatch([payload]);
  return { changed: true, pluginPath: payload.path };
}

async function remove(repoRoot) {
  const payload = buildRemovePayload(repoRoot);
  if (!payload) return { changed: false, pluginPath: resolvePluginPath(repoRoot) };
  await runBatch([payload]);
  return { changed: true, pluginPath: payload.path };
}

module.exports = {
  buildInstallPayload,
  buildRemovePayload,
  install,
  remove,
  resolvePluginDir,
  resolvePluginPath,
  PLUGIN_MARKER,
  buildPluginTS,
};
