const assert = require("node:assert/strict");
const test = require("node:test");

const { collectMissingPrerequisites, runFirstRunBootstrapIfNeeded } = require("../src/lib/bootstrap/orchestrator");

test("orchestrator reports missing entire login and readme sync config", async () => {
  const missing = await collectMissingPrerequisites({
    bootstrapState: {
      native_app: { installed: true },
      entire: { installed: true, logged_in: false },
    },
    readmeSyncConfig: null,
    githubToken: null,
    platform: "darwin",
  });
  assert.deepEqual(missing, ["entire_login", "readme_sync"]);
});

test("orchestrator reports missing native app and readme prereqs on non-login state", async () => {
  const missing = await collectMissingPrerequisites({
    bootstrapState: {
      native_app: { installed: false },
      entire: { installed: false, logged_in: false },
    },
    readmeSyncConfig: { enabled: false },
    githubToken: null,
    platform: "darwin",
  });
  assert.deepEqual(missing, ["native_app", "entire_install", "readme_sync"]);
});

test("runFirstRunBootstrapIfNeeded declines setup and continues", async () => {
  let fixed = 0;
  const result = await runFirstRunBootstrapIfNeeded({
    platform: "darwin",
    missing: ["native_app", "entire_login"],
    isInteractive: true,
    promptImpl: async () => false,
    fixers: {
      native_app: async () => {
        fixed += 1;
      },
      entire_login: async () => {
        fixed += 1;
      },
    },
  });

  assert.equal(result.prompted, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missing, ["native_app", "entire_login"]);
  assert.equal(fixed, 0);
});

test("runFirstRunBootstrapIfNeeded treats cancel as decline", async () => {
  let fixed = 0;
  const result = await runFirstRunBootstrapIfNeeded({
    platform: "darwin",
    missing: ["native_app", "entire_login"],
    isInteractive: true,
    promptImpl: async () => null,
    fixers: {
      native_app: async () => {
        fixed += 1;
      },
      entire_login: async () => {
        fixed += 1;
      },
    },
  });

  assert.equal(result.prompted, true);
  assert.equal(result.accepted, false);
  assert.deepEqual(result.missing, ["native_app", "entire_login"]);
  assert.equal(fixed, 0);
});
