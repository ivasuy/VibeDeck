const assert = require("node:assert/strict");
const cp = require("node:child_process");
const path = require("node:path");
const { test } = require("node:test");

const { run } = require("../src/cli");

test("help output uses VibeDeck identifiers", async () => {
  const prevWrite = process.stdout.write;
  let out = "";

  try {
    process.stdout.write = (chunk) => {
      out += String(chunk || "");
      return true;
    };

    await run(["-h"]);
  } finally {
    process.stdout.write = prevWrite;
  }

  assert.match(out, /vibedeck/);
  assert.ok(!out.includes("@vibescore/tracker"));
  assert.match(out, /doctor/);
  assert.match(out, /readme-sync/);
  assert.match(out, /project-readme-sync/);
});

test("src/cli.js can be executed directly with node", () => {
  const result = cp.spawnSync(process.execPath, [path.join(__dirname, "../src/cli.js"), "--help"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /vibedeck/);
  assert.match(result.stdout, /project-readme-sync/);
});
