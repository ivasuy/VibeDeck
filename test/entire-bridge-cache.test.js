const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  listCheckpointsCached,
  _resetCheckpointCacheForTests,
  _getInternalStats,
} = require("../src/lib/entire-bridge");

function sh(cwd, argv) {
  execFileSync(argv[0], argv.slice(1), { cwd, stdio: "ignore" });
}

function makeRepoWithCheckpointBranch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-entire-cache-"));
  sh(dir, ["git", "init"]);
  sh(dir, ["git", "config", "user.email", "test@example.com"]);
  sh(dir, ["git", "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  sh(dir, ["git", "add", "README.md"]);
  sh(dir, ["git", "commit", "-m", "init"]);

  sh(dir, ["git", "checkout", "--orphan", "entire/checkpoints/v1"]);
  sh(dir, ["git", "rm", "-rf", "."]);
  fs.mkdirSync(path.join(dir, "checkpoints"), { recursive: true });
  fs.writeFileSync(path.join(dir, "checkpoints", "a.json"), '{"a":1}\n');
  sh(dir, ["git", "add", "checkpoints/a.json"]);
  sh(dir, ["git", "commit", "-m", "checkpoint"]);

  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("listCheckpointsCached memoizes ls-tree reads per branch tip", async () => {
  const repo = makeRepoWithCheckpointBranch();
  try {
    _resetCheckpointCacheForTests();

    const r1 = await listCheckpointsCached(repo.dir);
    const r2 = await listCheckpointsCached(repo.dir);
    assert.equal(r1.available, true);
    assert.equal(r2.available, true);

    const stats = _getInternalStats();
    assert.equal(stats.gitListCalls, 1);
  } finally {
    repo.cleanup();
  }
});

