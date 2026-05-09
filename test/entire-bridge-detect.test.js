const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  detectEntire,
  _resetEntireCacheForTests,
} = require("../src/lib/entire-bridge");

test("detectEntire returns presence/version, caches for 60s, and can be reset", async () => {
  _resetEntireCacheForTests();

  const r1 = await detectEntire({ timeoutMs: 250 });
  const r2 = await detectEntire({ timeoutMs: 250 });

  assert.equal(r1, r2, "second call should return cached object reference");
  assert.equal(typeof r1.present, "boolean");
  assert.ok(
    r1.version === null || typeof r1.version === "string",
    "version must be string or null",
  );

  _resetEntireCacheForTests();
  const r3 = await detectEntire({ timeoutMs: 250 });
  assert.notEqual(r2, r3, "reset should force a refresh (new object)");
});

