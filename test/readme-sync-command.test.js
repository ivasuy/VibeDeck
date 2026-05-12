const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { run } = require("../src/cli");

test("readme-sync set stores config and status redacts the token", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-sync-cli-"));
  const prevHome = process.env.VIBEDECK_HOME;
  let out = "";
  const prevStdout = process.stdout.write;

  try {
    process.env.VIBEDECK_HOME = tmp;

    process.stdout.write = (chunk) => {
      out += String(chunk || "");
      return true;
    };

    await run([
      "readme-sync",
      "set",
      "--repo",
      "ivasuy/ivasuy",
      "--token",
      "ghp_secret_token",
      "--branch",
      "main",
      "--path",
      "README.md",
    ]);
    await run(["readme-sync", "status"]);
  } finally {
    process.stdout.write = prevStdout;
    if (prevHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  assert.match(out, /enabled/i);
  assert.match(out, /ivasuy\/ivasuy/);
  assert.doesNotMatch(out, /ghp_secret_token/);
  assert.match(out, /token: present/i);
});

test("readme-sync update reports repo and paths", async () => {
  const servicePath = require.resolve("../src/lib/readme-sync/service");
  const originalService = require.cache[servicePath];
  let out = "";
  const prevStdout = process.stdout.write;

  try {
    require.cache[servicePath] = {
      exports: {
        runReadmeSyncUpdate: async () => ({
          repo: "ivasuy/vibedeck",
          branch: "main",
          readme_path: "README.md",
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

    await run(["readme-sync", "update"]);
  } finally {
    if (originalService) {
      require.cache[servicePath] = originalService;
    } else {
      delete require.cache[servicePath];
    }
    process.stdout.write = prevStdout;
  }

  assert.match(out, /README sync: updated/);
  assert.match(out, /Repo: ivasuy\/vibedeck/);
  assert.match(out, /Branch: main/);
  assert.match(out, /README: README\.md/);
});
