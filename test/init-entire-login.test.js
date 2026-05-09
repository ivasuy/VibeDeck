const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

function loadInitWithEntireStub({ detectResult }) {
  const entireBridgePath = path.join(__dirname, "..", "src", "lib", "entire-bridge.js");
  const initPath = path.join(__dirname, "..", "src", "commands", "init.js");

  delete require.cache[entireBridgePath];
  delete require.cache[initPath];

  require.cache[entireBridgePath] = {
    id: entireBridgePath,
    filename: entireBridgePath,
    loaded: true,
    exports: {
      detectEntire: async () => detectResult,
    },
  };

  return require(initPath);
}

test("init offers optional entire login when Entire is detected (skippable)", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-init-entire-"));
  const prevHome = process.env.HOME;
  const prevWrite = process.stdout.write;
  let output = "";

  try {
    process.env.HOME = tmp;
    process.stdout.write = (chunk) => {
      output += String(chunk || "");
      return true;
    };

    const { cmdInit } = loadInitWithEntireStub({
      detectResult: { present: true, version: "9.9.9" },
    });

    await cmdInit([
      "--yes",
      "--no-auth",
      "--no-open",
      "--base-url",
      "https://example.invalid",
      "--skip-entire-login",
    ]);

    const clean = stripAnsi(output);
    assert.match(clean, /Entire CLI 9\.9\.9 detected\./);
  } finally {
    process.stdout.write = prevWrite;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    const entireBridgePath = path.join(__dirname, "..", "src", "lib", "entire-bridge.js");
    const initPath = path.join(__dirname, "..", "src", "commands", "init.js");
    delete require.cache[entireBridgePath];
    delete require.cache[initPath];
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
