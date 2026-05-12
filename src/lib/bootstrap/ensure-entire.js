'use strict';

const os = require("node:os");
const execa = require("execa");
const { detectEntire, entireStatus } = require("../entire-bridge");

function resolveEntireInstallPlan({ packageManager, hasBrew, platform = process.platform }) {
  if (platform !== "darwin") return { supported: false, method: "skip" };
  if (packageManager === "brew") return { supported: true, method: "brew-cask" };
  if (hasBrew) return { supported: true, method: "brew-cask" };
  return { supported: true, method: "official-script" };
}

async function runEntireLogin({ execaImpl = execa } = {}) {
  await execaImpl("entire", ["login"], { stdio: "inherit", timeout: 5 * 60 * 1000 });
  return { ok: true };
}

function parseEntireLoginStatus(result = {}) {
  if (typeof result === "string") {
    const value = result.toLowerCase();
    return !value.includes("not logged in") && !value.includes("login required") && !value.includes("not authenticated");
  }

  if (result == null || typeof result !== "object") {
    return false;
  }

  if (typeof result.exitCode === "number" && result.exitCode !== 0) return false;

  const output = `${String(result.stdout || "")} ${String(result.stderr || "")}`.toLowerCase();
  if (output.includes("not logged in") || output.includes("login required")) return false;
  if (output.includes("not authenticated")) return false;
  return true;
}

async function getEntireBootstrapStatus({
  statusImpl = entireStatus,
  statusRepoRoot = os.homedir(),
  detectImpl = detectEntire,
} = {}) {
  const detection = await detectImpl();
  if (!detection?.present) {
    return {
      installed: false,
      version: null,
      logged_in: false,
    };
  }

  let statusResult = {};
  try {
    statusResult = await statusImpl(statusRepoRoot);
  } catch (_err) {
    statusResult = { exitCode: 1, stdout: "", stderr: String(_err?.message || "status check failed") };
  }

  return {
    installed: true,
    version: detection.version || null,
    logged_in: parseEntireLoginStatus(statusResult),
  };
}

module.exports = {
  resolveEntireInstallPlan,
  runEntireLogin,
  getEntireBootstrapStatus,
};
