const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { readJson } = require("./fs");

/**
 * Auto-detect installed AI CLIs and complete missing VibeDeck hook setup.
 */

const AI_CLIS = [
  {
    name: "codex",
    displayName: "Codex",
    checkInstalled: checkCodexInstalled,
    checkConfigured: checkCodexConfigured,
    configure: configureCodex,
  },
  {
    name: "claude-code",
    displayName: "Claude Code", 
    checkInstalled: checkClaudeCodeInstalled,
    checkConfigured: checkClaudeCodeConfigured,
    configure: configureClaudeCode,
  },
  {
    name: "opencode",
    displayName: "OpenCode",
    checkInstalled: checkOpencodeInstalled,
    checkConfigured: checkOpencodeConfigured,
    configure: configureOpencode,
  },
  {
    name: "every-code",
    displayName: "Every Code",
    checkInstalled: checkEveryCodeInstalled,
    checkConfigured: checkEveryCodeConfigured,
    configure: configureEveryCode,
  },
  {
    name: "openclaw",
    displayName: "OpenClaw",
    checkInstalled: checkOpenclawInstalled,
    checkConfigured: checkOpenclawConfigured,
    configure: configureOpenclaw,
  },
];

/**
 * Detect every supported AI CLI and optionally configure missing hooks.
 * @param {Object} options
 * @param {string} options.home - home directory
 * @param {boolean} options.silent - suppress console output
 * @param {boolean} options.autoConfigure - configure automatically when true
 */
async function checkAndActivate({ home = os.homedir(), silent = true, autoConfigure = true } = {}) {
  const results = [];
  
  for (const cli of AI_CLIS) {
    try {
      const isInstalled = await cli.checkInstalled({ home });
      if (!isInstalled) continue;
      
      const isConfigured = await cli.checkConfigured({ home });
      if (isConfigured) continue;
      
      if (autoConfigure) {
        const success = await cli.configure({ home, silent });
        results.push({
          name: cli.name,
          displayName: cli.displayName,
          action: success ? "configured" : "failed",
        });
        
        if (!silent && success) {
          console.log(`Configured ${cli.displayName} integration`);
        }
      } else {
        results.push({
          name: cli.name,
          displayName: cli.displayName,
          action: "pending",
        });
        
        if (!silent) {
          console.log(`${cli.displayName} is not configured. Run 'vibedeck init' to configure it.`);
        }
      }
    } catch (err) {
      if (!silent) {
        console.error(`Failed to check ${cli.displayName}:`, err.message);
      }
    }
  }
  
  return results;
}

// ===== Codex detection and setup =====

async function checkCodexInstalled({ home }) {
  const configPath = path.join(home, ".codex", "config.toml");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkCodexConfigured({ home }) {
  const configPath = path.join(home, ".codex", "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf8");
    return content.includes("vibedeck") || content.includes("notify");
  } catch {
    return false;
  }
}

async function configureCodex({ home, silent }) {
  try {
    const { upsertCodexNotify } = require("./codex-config");
    const notifyCmd = path.join(home, ".vibedeck", "bin", "notify.cjs");
    const codexConfigPath = path.join(home, ".codex", "config.toml");
    const notifyOriginalPath = path.join(home, ".vibedeck", "backups", "codex-notify-original.json");
    
    await upsertCodexNotify({
      codexConfigPath,
      notifyCmd,
      notifyOriginalPath,
    });
    return true;
  } catch (err) {
    if (!silent) console.error("Failed to configure Codex:", err.message);
    return false;
  }
}

// ===== Claude Code detection and setup =====

async function checkClaudeCodeInstalled({ home }) {
  const settingsPath = path.join(home, ".claude", "settings.json");
  try {
    await fs.access(settingsPath);
    return true;
  } catch {
    return false;
  }
}

async function checkClaudeCodeConfigured({ home }) {
  const settingsPath = path.join(home, ".claude", "settings.json");
  try {
    const settings = await readJson(settingsPath);
    const hooks = settings?.hooks?.SessionStart || [];
    return hooks.some(h =>
      h.hooks?.some(hook => hook.command?.includes("vibedeck"))
    );
  } catch {
    return false;
  }
}

async function configureClaudeCode({ home, silent }) {
  try {
    const settingsPath = path.join(home, ".claude", "settings.json");
    const settings = (await readJson(settingsPath)) || {};
    
    if (!settings.hooks) settings.hooks = {};
    if (!settings.hooks.SessionStart) settings.hooks.SessionStart = [];
    
    const exists = settings.hooks.SessionStart.some(h => 
      h.matcher === "startup" &&
      h.hooks?.some(hook => hook.command?.includes("vibedeck activate-if-needed"))
    );
    
    if (!exists) {
      settings.hooks.SessionStart.push({
        matcher: "startup",
        hooks: [{
          type: "command",
          command: "vibedeck activate-if-needed --silent 2>/dev/null || true"
        }]
      });
      
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");
    }
    return true;
  } catch (err) {
    if (!silent) console.error("Failed to configure Claude Code:", err.message);
    return false;
  }
}

// ===== OpenCode detection and setup =====

async function checkOpencodeInstalled({ home }) {
  const configPath = path.join(home, ".config", "opencode", "opencode.json");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkOpencodeConfigured({ home }) {
  const pluginDir = path.join(home, ".config", "opencode", "plugins");
  try {
    const files = await fs.readdir(pluginDir);
    return files.some(f => f.includes("vibedeck"));
  } catch {
    return false;
  }
}

async function configureOpencode({ home, silent }) {
  try {
    const pluginDir = path.join(home, ".config", "opencode", "plugins");
    await fs.mkdir(pluginDir, { recursive: true });
    
    const pluginPath = path.join(pluginDir, "vibedeck-activation.js");
    const pluginCode = `export const VibeDeckActivation = async ({ $ }) => {
  return {
    "session.created": async () => {
      await $'vibedeck activate-if-needed --silent'.quiet().nothrow();
    }
  };
};`;
    
    await fs.writeFile(pluginPath, pluginCode, "utf8");
    return true;
  } catch (err) {
    if (!silent) console.error("Failed to configure OpenCode:", err.message);
    return false;
  }
}

// ===== Every Code detection and setup =====

async function checkEveryCodeInstalled({ home }) {
  const configPath = path.join(home, ".code", "config.toml");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkEveryCodeConfigured({ home }) {
  const configPath = path.join(home, ".code", "config.toml");
  try {
    const content = await fs.readFile(configPath, "utf8");
    return content.includes("vibedeck");
  } catch {
    return false;
  }
}

async function configureEveryCode({ home, silent }) {
  try {
    const configPath = path.join(home, ".code", "config.toml");
    let content = "";
    try {
      content = await fs.readFile(configPath, "utf8");
    } catch {
      content = "";
    }
    
    const notifyCmd = path.join(home, ".vibedeck", "bin", "notify.cjs");
    const notifyLine = `notify = ["/usr/bin/env", "node", "${notifyCmd}"]`;

    if (!content.includes("vibedeck")) {
      content = content.trim() + "\n\n# vibedeck integration\n" + notifyLine + "\n";
      await fs.writeFile(configPath, content, "utf8");
    }
    return true;
  } catch (err) {
    if (!silent) console.error("Failed to configure Every Code:", err.message);
    return false;
  }
}

module.exports = {
  checkAndActivate,
  AI_CLIS,
};

// ===== OpenClaw detection and setup =====

async function checkOpenclawInstalled({ home }) {
  const configPath = path.join(home, ".openclaw", "openclaw.json");
  try {
    await fs.access(configPath);
    return true;
  } catch {
    return false;
  }
}

async function checkOpenclawConfigured({ home }) {
  const { probeOpenclawSessionPluginState } = require("./openclaw-session-plugin");
  const { resolveTrackerPaths } = require("./tracker-paths");
  try {
    const { trackerDir } = await resolveTrackerPaths({ home });
    const state = await probeOpenclawSessionPluginState({ home, trackerDir, env: process.env });
    return state?.configured === true;
  } catch {
    return false;
  }
}

async function configureOpenclaw({ home, silent }) {
  try {
    const { installOpenclawSessionPlugin } = require("./openclaw-session-plugin");
    const { resolveTrackerPaths } = require("./tracker-paths");
    const { trackerDir } = await resolveTrackerPaths({ home });
    
    const result = await installOpenclawSessionPlugin({
      home,
      trackerDir,
      packageName: "vibedeck-cli",
      env: process.env,
    });
    
    return result?.configured === true;
  } catch (err) {
    if (!silent) console.error("Failed to configure OpenClaw:", err.message);
    return false;
  }
}
