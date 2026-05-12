"use strict";

const { isInteractiveInstall } = require("../src/lib/bootstrap/platform");
const { runInstallBootstrap } = require("../src/lib/bootstrap/install-native");

function isGlobalInstallFromEnv(value = process.env.npm_config_global) {
  if (typeof value === "string") return value.toLowerCase() === "true";
  return Boolean(value);
}

function isNonInteractive({ interactive = isInteractiveInstall() } = {}) {
  return process.env.CI === "1" || process.env.CI === "true" || !interactive;
}

function shouldRunBootstrap({
  platform = process.platform,
  isGlobal = isGlobalInstallFromEnv(),
} = {}) {
  if (platform !== "darwin") return false;
  if (!isGlobal) return false;
  return true;
}

async function run({
  platform = process.platform,
  isGlobal = isGlobalInstallFromEnv(),
  interactive = isInteractiveInstall(),
  packageManager = "npm",
  installImpl = runInstallBootstrap,
} = {}) {
  if (!shouldRunBootstrap({ platform, isGlobal, interactive })) {
    return { skipped: true, reason: "not_applicable" };
  }

  if (isNonInteractive({ interactive })) {
    return { skipped: true, reason: "non_interactive" };
  }

  return installImpl({ packageManager });
}

async function main() {
  await run();
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  shouldRunBootstrap,
  run,
  main,
};
