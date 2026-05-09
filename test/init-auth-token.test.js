const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const { cmdInit } = require("../src/commands/init");

test("init issues local auth token at ~/.vibedeck/auth.token with mode 0600", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-init-auth-"));
  const prevHome = process.env.HOME;
  const prevCodexHome = process.env.CODEX_HOME;
  const prevOpencode = process.env.OPENCODE_CONFIG_DIR;
  const prevToken = process.env.TOKENTRACKER_DEVICE_TOKEN;

  try {
    process.env.HOME = tmp;
    process.env.CODEX_HOME = path.join(tmp, ".codex");
    process.env.OPENCODE_CONFIG_DIR = path.join(tmp, ".config", "opencode");
    delete process.env.TOKENTRACKER_DEVICE_TOKEN;

    await cmdInit(["--yes", "--no-auth", "--no-open", "--skip-entire-login", "--base-url", "https://example.invalid"]);

    const tokenPath = path.join(tmp, ".vibedeck", "auth.token");
    const stat = await fs.stat(tokenPath);
    assert.equal(stat.mode & 0o777, 0o600);
    const token = String(await fs.readFile(tokenPath, "utf8")).trim();
    assert.match(token, /^[a-f0-9]{64}$/);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = prevCodexHome;
    if (prevOpencode === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = prevOpencode;
    if (prevToken === undefined) delete process.env.TOKENTRACKER_DEVICE_TOKEN;
    else process.env.TOKENTRACKER_DEVICE_TOKEN = prevToken;
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

