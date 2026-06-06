const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../src/cli");

test("cli help lists only active public command surfaces", async () => {
  let out = "";
  const prev = process.stdout.write;
  try {
    process.stdout.write = (chunk) => ((out += String(chunk || "")), true);
    await run(["-h"]);
  } finally {
    process.stdout.write = prev;
  }

  assert.match(out, /project-readme-sync/);
  assert.match(out, /optimize/);
  assert.doesNotMatch(out, /entire/i);
});

test("removed command surfaces are rejected", async () => {
  await assert.rejects(() => run(["entire", "login"]), /Unknown command: entire/);
});
