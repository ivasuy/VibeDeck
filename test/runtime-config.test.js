const assert = require("node:assert/strict");
const { test } = require("node:test");

const { resolveRuntimeConfig } = require("../src/lib/runtime-config");

test("resolveRuntimeConfig prefers CLI flags over config and env", () => {
  const result = resolveRuntimeConfig({
    cli: { dashboardUrl: "https://cli.dashboard" },
    config: { dashboardUrl: "https://config.dashboard" },
    env: { TOKENTRACKER_DEBUG: "1" },
  });

  assert.equal(result.dashboardUrl, "https://cli.dashboard");
  assert.equal(result.sources.dashboardUrl, "cli");
  assert.equal(result.debug, true);
});

test("resolveRuntimeConfig ignores non-TOKENTRACKER env inputs", () => {
  const result = resolveRuntimeConfig({
    env: {
      VIBESCORE_BASE_URL: "https://legacy.example",
      VIBESCORE_DEVICE_TOKEN: "legacy",
    },
  });

  assert.equal(result.dashboardUrl, "https://www.vibedeck.cc");
  assert.equal(result.sources.dashboardUrl, "default");
});

test("resolveRuntimeConfig normalizes timeout and flags", () => {
  const result = resolveRuntimeConfig({
    env: {
      TOKENTRACKER_HTTP_TIMEOUT_MS: "500",
      TOKENTRACKER_DEBUG: "1",
      TOKENTRACKER_AUTO_RETRY_NO_SPAWN: "1",
    },
  });

  assert.equal(result.httpTimeoutMs, 1000);
  assert.equal(result.debug, true);
  assert.equal(result.autoRetryNoSpawn, true);
});
