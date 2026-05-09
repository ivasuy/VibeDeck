const os = require('node:os');
const path = require('node:path');

const claude = require('./claude');

function defaultSettingsPath() {
  return path.join(os.homedir(), '.codebuddy', 'settings.json');
}

/**
 * CodeBuddy is a Claude-Code fork that uses the same JSON schema as Claude:
 * `hooks.SessionEnd[]`. This merger intentionally re-uses the Claude merger logic
 * (signature-aware entry detection) but points at CodeBuddy's default config path.
 */
async function install(settingsPath = defaultSettingsPath()) {
  return claude.install(settingsPath);
}

async function remove(settingsPath = defaultSettingsPath()) {
  return claude.remove(settingsPath);
}

module.exports = {
  buildInstallPayload: (settingsPath = defaultSettingsPath()) => claude.buildInstallPayload(settingsPath),
  buildRemovePayload: (settingsPath = defaultSettingsPath()) => claude.buildRemovePayload(settingsPath),
  install,
  remove,
  defaultSettingsPath,
};
