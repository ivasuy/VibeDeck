const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../src/cli");

test("cli help and command surface include vibedeck entire login", async () => {
  let out = "";
  const prev = process.stdout.write;
  try {
    process.stdout.write = (chunk) => ((out += String(chunk || "")), true);
    await run(["-h"]);
  } finally {
    process.stdout.write = prev;
  }
  assert.match(out, /entire/);
});
