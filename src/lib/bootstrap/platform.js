'use strict';

const os = require("node:os");
const path = require("node:path");

function isMacOS(platform = process.platform) {
  return platform === "darwin";
}

function isInteractiveInstall({ stdin = process.stdin, stdout = process.stdout } = {}) {
  return Boolean(stdin && stdin.isTTY && stdout && stdout.isTTY);
}

function resolveNativeInstallTargets({ home = os.homedir() } = {}) {
  return [
    "/Applications/VibeDeckMac.app",
    path.join(home, "Applications", "VibeDeckMac.app"),
  ];
}

module.exports = {
  isMacOS,
  isInteractiveInstall,
  resolveNativeInstallTargets,
};
