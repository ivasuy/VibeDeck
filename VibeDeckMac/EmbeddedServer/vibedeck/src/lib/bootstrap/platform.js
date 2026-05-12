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
    "/Applications/VibeDeck.app",
    path.join(home, "Applications", "VibeDeck.app"),
  ];
}

module.exports = {
  isMacOS,
  isInteractiveInstall,
  resolveNativeInstallTargets,
};
