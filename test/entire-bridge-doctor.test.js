const test = require("node:test");
const assert = require("node:assert");

test("entireDoctor returns { exitCode, stdout, stderr } shape", async (t) => {
  const bridge = require("../src/lib/entire-bridge");
  if (typeof bridge.entireDoctor !== "function") t.fail("entireDoctor not exported");
  const result = await bridge.entireDoctor("/tmp");
  assert.ok("exitCode" in result && "stdout" in result && "stderr" in result);
});

