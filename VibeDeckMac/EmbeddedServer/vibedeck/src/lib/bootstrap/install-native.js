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
  throw new Error("No writable install target for VibeDeck.app");
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

function getPackageVersion() {
  return (
    process.env.npm_package_version ||
    require('../../../package.json').version ||
    "0.1.2"
  );
}

async function runInstallBootstrap({
  packageManager = "npm",
  version = getPackageVersion(),
  installImpl = installNativeApp,
} = {}) {
  const resolvedVersion = version && version.replace(/^v/, "");
  const spec = resolveNativeArtifactSpec({
    version: resolvedVersion,
    platform: process.platform,
    arch: process.arch,
  });

  if (!spec?.supported) {
    return {
      installed: false,
      packageManager,
      skipped: true,
      reason: spec?.reason || "unsupported_platform",
    };
  }

  if (typeof installImpl !== "function") {
    return {
      installed: false,
      packageManager,
      skipped: true,
      reason: "missing_install_implementation",
    };
  }

  const fallback = () => {
    throw new Error("native artifact install flow not implemented in this phase");
  };

  try {
    return await installImpl({
      version: resolvedVersion,
      packageManager,
      downloadImpl: fallback,
      extractImpl: fallback,
      copyAppImpl: fallback,
      // Keep explicit defaults to avoid a full installer implementation in this phase.
      home: os.homedir(),
    });
  } catch (_err) {
    return {
      installed: false,
      packageManager,
      skipped: true,
      reason: String(_err?.message || _err || "install_failed"),
    };
  }
}

module.exports = {
  chooseInstallTarget,
  installNativeApp,
  runInstallBootstrap,
};
