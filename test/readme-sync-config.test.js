const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseRepoRef,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  writeGitHubToken,
  readGitHubToken,
  removeReadmeSyncState,
} = require("../src/lib/readme-sync/config");

test("parseRepoRef accepts owner/repo", () => {
  assert.deepEqual(parseRepoRef("ivasuy/vibedeck"), {
    owner: "ivasuy",
    repo: "vibedeck",
  });
});

test("parseRepoRef rejects malformed repo refs", () => {
  assert.throws(() => parseRepoRef("ivasuy"), /owner\/repo/);
  assert.throws(() => parseRepoRef("ivasuy/"), /owner\/repo/);
});

test("config and token round-trip under VIBEDECK_HOME", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-sync-"));
  const prevHome = process.env.VIBEDECK_HOME;

  try {
    process.env.VIBEDECK_HOME = tmp;
    await writeReadmeSyncConfig({
      enabled: true,
      repo_owner: "ivasuy",
      repo_name: "ivasuy",
      branch: "main",
      readme_path: "README.md",
      svg_path: "github-readme-banner.svg",
      marker_start: "<!-- vibedeck:stats:start -->",
      marker_end: "<!-- vibedeck:stats:end -->",
    });
    await writeGitHubToken("ghp_test_token");

    const config = await readReadmeSyncConfig();
    const token = await readGitHubToken();
    const tokenMode = fs.statSync(path.join(tmp, "github.token")).mode & 0o777;

    assert.equal(config.enabled, true);
    assert.equal(config.repo_owner, "ivasuy");
    assert.equal(token, "ghp_test_token");
    assert.equal(tokenMode, 0o600);

    await removeReadmeSyncState();
    assert.equal(await readReadmeSyncConfig(), null);
    assert.equal(await readGitHubToken(), null);
  } finally {
    if (prevHome === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prevHome;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
