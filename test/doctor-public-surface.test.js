const assert = require("node:assert/strict");
const { test } = require("node:test");

const { runDoctorChecks } = require("../src/lib/doctor");

test("doctor checks do not report removed command surfaces", async () => {
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    diagnostics: null,
    fetch: globalThis.fetch,
    paths: {},
  });

  assert.ok(Array.isArray(checks));
  assert.equal(checks.some((check) => /entire/i.test(String(check?.id || ""))), false);
});
