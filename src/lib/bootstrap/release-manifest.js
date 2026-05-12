'use strict';

function resolveNativeArtifactSpec({ version, platform = process.platform, arch = process.arch }) {
  if (platform !== "darwin") {
    return {
      supported: false,
      reason: "platform_not_supported",
    };
  }

  const archTag = arch === "x64" ? "universal" : "universal";
  const fileName = `VibeDeckMac-${version}-${archTag}.zip`;

  return {
    supported: true,
    kind: "zip",
    fileName,
    url: `https://github.com/ivasuy/vibedeck/releases/download/v${version}/${fileName}`,
  };
}

module.exports = { resolveNativeArtifactSpec };
