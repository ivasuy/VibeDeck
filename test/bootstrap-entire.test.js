const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function loadBootstrapAdapter({ detectResult, statusImpl }) {
  const modulePath = path.join(__dirname, "..", "src", "lib", "bootstrap", "ensure-entire.js");
  const bridgePath = path.join(__dirname, "..", "src", "lib", "entire-bridge.js");
  delete require.cache[modulePath];
  delete require.cache[bridgePath];

  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      detectEntire: async () => detectResult,
      entireStatus: statusImpl || (async () => ({ exitCode: 0, stdout: "", stderr: "" })),
    },
  };

  return require(modulePath);
}

test("npm install path prefers Homebrew when brew exists", () => {
  const { resolveEntireInstallPlan } = loadBootstrapAdapter({
    detectResult: { present: false },
  });
  const plan = resolveEntireInstallPlan({
    packageManager: "npm",
    hasBrew: true,
    platform: "darwin",
  });
  assert.equal(plan.method, "brew-cask");
});

test("npm install path falls back to official script without brew", () => {
  const { resolveEntireInstallPlan } = loadBootstrapAdapter({
    detectResult: { present: false },
  });
  const plan = resolveEntireInstallPlan({
    packageManager: "npm",
    hasBrew: false,
    platform: "darwin",
  });
  assert.equal(plan.method, "official-script");
});

test("getEntireBootstrapStatus defaults status check to an absolute repo root", async () => {
  let receivedRoot = null;
  const { getEntireBootstrapStatus } = loadBootstrapAdapter({
    detectResult: { present: true, version: "0.6.1" },
    statusImpl: async (repoRoot) => {
      receivedRoot = repoRoot;
      return {
        exitCode: 0,
        stdout: "login status: ok",
        stderr: "",
      };
    },
  });

  const result = await getEntireBootstrapStatus();
  assert.equal(result.installed, true);
  assert.equal(result.version, "0.6.1");
  assert.equal(result.logged_in, true);
  assert.equal(receivedRoot, os.homedir());
});

test("getEntireBootstrapStatus reports logged out when status output indicates missing login", async () => {
  const { getEntireBootstrapStatus } = loadBootstrapAdapter({
    detectResult: { present: true, version: "0.6.1" },
    statusImpl: async () => ({
      exitCode: 0,
      stdout: "Not logged in",
      stderr: "",
    }),
  });

  const result = await getEntireBootstrapStatus();
  assert.equal(result.logged_in, false);
});
