'use strict';

const path = require("node:path");
const fs = require("node:fs/promises");
const os = require("node:os");
const { resolveNativeInstallTargets } = require("./platform");
const { resolveNativeArtifactSpec } = require("./release-manifest");

async function defaultCanWrite(candidate) {
  const parentDir = path.dirname(candidate);
  try {
    await fs.access(parentDir);
    return true;
  } catch {
    return false;
  }
}

async function chooseInstallTarget({ targets, canWrite = defaultCanWrite }) {
  for (const candidate of targets) {
    if (await canWrite(candidate)) return candidate;
  }
  throw new Error("No writable install target for VibeDeckMac.app");
}

async function installNativeApp({
  version,
  home = os.homedir(),
  canWrite = defaultCanWrite,
  downloadImpl,
  extractImpl,
  copyAppImpl,
}) {
  const spec = resolveNativeArtifactSpec({ version, platform: "darwin", arch: process.arch });
  if (!spec.supported) throw new Error(spec.reason || "unsupported platform");

  const target = await chooseInstallTarget({
    targets: resolveNativeInstallTargets({ home }),
    canWrite,
  });

  const archivePath = await downloadImpl(spec);
  const appPath = await extractImpl(archivePath);
  await copyAppImpl(appPath, target);

  return {
    installed: true,
    target,
    version,
    artifact: spec.fileName,
  };
}

module.exports = {
  chooseInstallTarget,
  installNativeApp,
};
