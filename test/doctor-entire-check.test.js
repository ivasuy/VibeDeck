const assert = require("node:assert/strict");
const { test } = require("node:test");

const { runDoctorChecks } = require("../src/lib/doctor");

test("runDoctorChecks includes an Entire CLI presence check", async () => {
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    diagnostics: null,
    fetch: globalThis.fetch,
    paths: {},
  });

  assert.ok(Array.isArray(checks));
  const entireCheck = checks.find((c) => /entire/i.test(String(c?.id || "")));
  assert.ok(entireCheck, "expected a check with id matching /entire/i");
  assert.equal(typeof entireCheck.status, "string");
  assert.equal(typeof entireCheck.detail, "string");
});

