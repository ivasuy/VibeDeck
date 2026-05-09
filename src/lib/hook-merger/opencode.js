const fs = require('node:fs/promises');
const path = require('node:path');

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

async function install(repoRoot) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const pluginPath = resolvePluginPath(repoRoot);
  const next = buildPluginTS({ notifyPath: signature.canonicalCommandPath() });
  const existing = await fs.readFile(pluginPath, 'utf8').catch(() => null);

  if (existing === next) return { changed: false, pluginPath };

  await fs.mkdir(path.dirname(pluginPath), { recursive: true });
  await fs.writeFile(pluginPath, next, 'utf8');
  return { changed: true, pluginPath };
}

async function remove(repoRoot) {
  if (!repoRoot) throw new Error('repoRoot is required');
  const pluginPath = resolvePluginPath(repoRoot);
  const existing = await fs.readFile(pluginPath, 'utf8').catch(() => null);
  if (existing == null) return { changed: false, pluginPath };
  if (typeof existing === 'string' && existing.includes(PLUGIN_MARKER)) {
    await fs.unlink(pluginPath).catch(() => {});
    return { changed: true, pluginPath };
  }
  return { changed: false, pluginPath };
}

module.exports = {
  install,
  remove,
  resolvePluginDir,
  resolvePluginPath,
  PLUGIN_MARKER,
  buildPluginTS,
};

