const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { run } = require("../src/cli");

test("project-readme-sync command runs service and prints results", async () => {
  const servicePath = path.join(__dirname, "../src/lib/project-readme-sync/service.js");
  const originalService = require.cache[servicePath];
  let out = "";
  const previousExitCode = process.exitCode;
  const previousStdout = process.stdout.write;

  try {
    require.cache[servicePath] = {
      exports: {
        runProjectReadmeSync: async () => ({
          readmePath: "/tmp/example/README.md",
          bannerPath: "/tmp/example/project-readme-banner.svg",
        }),
      },
      filename: servicePath,
      loaded: true,
      id: servicePath,
      children: [],
    };

    process.stdout.write = (chunk) => {
      out += String(chunk || "");
      return true;
    };

    await run(["project-readme-sync"]);

    assert.equal(process.exitCode, 0);
    assert.match(out, /Project README sync: updated/);
    assert.match(out, /README: \/tmp\/example\/README\.md/);
    assert.match(out, /Banner: \/tmp\/example\/project-readme-banner\.svg/);
  } finally {
    if (originalService) {
      require.cache[servicePath] = originalService;
    } else {
      delete require.cache[servicePath];
    }
    process.exitCode = previousExitCode;
    process.stdout.write = previousStdout;
  }
});

test("project-readme-sync command rejects extra args with usage and code 1", async () => {
  const servicePath = path.join(__dirname, "../src/lib/project-readme-sync/service.js");
  const originalService = require.cache[servicePath];
  let err = "";
  let called = false;
  const previousExitCode = process.exitCode;
  const previousStdout = process.stdout.write;
  const previousStderr = process.stderr.write;

  try {
    require.cache[servicePath] = {
      exports: {
        runProjectReadmeSync: async () => {
          called = true;
          return {
            readmePath: "/tmp/example/README.md",
            bannerPath: "/tmp/example/project-readme-banner.svg",
          };
        },
      },
      filename: servicePath,
      loaded: true,
      id: servicePath,
      children: [],
    };

    process.stdout.write = () => true;
    process.stderr.write = (chunk) => {
      err += String(chunk || "");
      return true;
    };

    await run(["project-readme-sync", "unexpected"]);

    assert.equal(process.exitCode, 1);
    assert.ok(!called);
    assert.equal(err, "Usage: vibedeck project-readme-sync\n");
  } finally {
    if (originalService) {
      require.cache[servicePath] = originalService;
    } else {
      delete require.cache[servicePath];
    }
    process.exitCode = previousExitCode;
    process.stdout.write = previousStdout;
    process.stderr.write = previousStderr;
  }
});
