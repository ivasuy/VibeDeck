const assert = require("node:assert/strict");
const test = require("node:test");

const { collectMissingPrerequisites, runFirstRunBootstrapIfNeeded } = require("../src/lib/bootstrap/orchestrator");

test("orchestrator reports missing readme sync config", async () => {
  const missing = await collectMissingPrerequisites({
    bootstrapState: {
      native_app: { installed: true },
    },
    readmeSyncConfig: null,
    githubToken: null,
    platform: "darwin",
  });
  assert.deepEqual(missing, ["readme_sync"]);
});

test("orchestrator reports missing native app and readme prereqs", async () => {
  const missing = await collectMissingPrerequisites({
    bootstrapState: {
      native_app: { installed: false },
    },
    readmeSyncConfig: { enabled: false },
    githubToken: null,
    platform: "darwin",
  });
  assert.deepEqual(missing, ["native_app", "readme_sync"]);
});

test("runFirstRunBootstrapIfNeeded declines setup and continues", async () => {
  let fixed = 0;
  const result = await runFirstRunBootstrapIfNeeded({
    platform: "darwin",
    missing: ["native_app", "readme_sync"],
    isInteractive: true,
    promptImpl: async () => false,
    fixers: {
      native_app: async () => {
        fixed += 1;
      },
      readme_sync: async () => {
        fixed += 1;
      },
    },
  });

  assert.equal(result.prompted, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missing, ["native_app", "readme_sync"]);
  assert.equal(fixed, 0);
});

test("runFirstRunBootstrapIfNeeded treats cancel as decline", async () => {
  let fixed = 0;
  const result = await runFirstRunBootstrapIfNeeded({
    platform: "darwin",
    missing: ["native_app", "readme_sync"],
    isInteractive: true,
    promptImpl: async () => null,
    fixers: {
      native_app: async () => {
        fixed += 1;
      },
      readme_sync: async () => {
        fixed += 1;
      },
    },
  });

  assert.equal(result.prompted, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missing, ["native_app", "readme_sync"]);
  assert.equal(fixed, 0);
});
