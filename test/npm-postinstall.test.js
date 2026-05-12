const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldRunBootstrap, run } = require("../scripts/npm-postinstall");

test("npm postinstall skips bootstrap off macOS", () => {
  assert.equal(shouldRunBootstrap({ platform: "linux", isGlobal: true }), false);
});

test("npm postinstall runs bootstrap on global macOS install", () => {
  assert.equal(shouldRunBootstrap({ platform: "darwin", isGlobal: true }), true);
});

test("npm postinstall skips bootstrap for local install", () => {
  assert.equal(shouldRunBootstrap({ platform: "darwin", isGlobal: false }), false);
});

test("npm postinstall defaults to non-darwin skip and doesn't invoke installer", async () => {
  let ran = false;

  await run({
    platform: "linux",
    interactive: true,
    installImpl: async () => {
      ran = true;
      return { installed: true };
    },
  });

  assert.equal(ran, false);
});

test("npm postinstall runs installer on global macOS interactive install", async () => {
  let ran = false;

  const result = await run({
    platform: "darwin",
    isGlobal: true,
    interactive: true,
    installImpl: async () => {
      ran = true;
      return { installed: true };
    },
  });

  assert.equal(ran, true);
  assert.equal(result.installed, true);
});

test("npm postinstall skips installer when non-interactive", async () => {
  let ran = false;

  const result = await run({
    platform: "darwin",
    isGlobal: true,
    interactive: false,
    installImpl: async () => {
      ran = true;
      return { installed: true };
    },
  });

  assert.equal(ran, false);
  assert.equal(result.skipped, true);
});
