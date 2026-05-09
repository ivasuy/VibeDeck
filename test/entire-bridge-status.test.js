const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { ensureSchema } = require("../src/lib/db");
const { getRepoState } = require("../src/lib/db/repos");
const { getEntireRepoStatus } = require("../src/lib/entire-bridge");

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function writeSettings(repoRoot, json) {
  const p = path.join(repoRoot, ".entire");
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "settings.json"), JSON.stringify(json));
}

test("getEntireRepoStatus implements four states and persists vibedeck_repos.entire_state", async () => {
  const tmp = makeTempDir("vibedeck-entire-status-");
  try {
    const dbPath = path.join(tmp.dir, "vibedeck.sqlite3");
    ensureSchema(dbPath);

    // not_enabled: no .entire/settings.json
    const repoNotEnabled = path.join(tmp.dir, "repo-not-enabled");
    fs.mkdirSync(repoNotEnabled, { recursive: true });

    // not_enabled: present-but-disabled
    const repoDisabled = path.join(tmp.dir, "repo-disabled");
    fs.mkdirSync(repoDisabled, { recursive: true });
    writeSettings(repoDisabled, { enabled: false });

    // enabled_no_commits: enabled, but no checkpoints branch
    const repoEnabledNoCommits = path.join(tmp.dir, "repo-enabled-no-commits");
    fs.mkdirSync(repoEnabledNoCommits, { recursive: true });
    writeSettings(repoEnabledNoCommits, { enabled: true });

    // active: enabled + checkpoints branch exists (repo must be a git repo)
    const repoActive = path.join(tmp.dir, "repo-active");
    fs.mkdirSync(repoActive, { recursive: true });
    writeSettings(repoActive, { enabled: true });

    const s1 = await getEntireRepoStatus(repoNotEnabled, {
      persist: true,
      dbPathOverrideForTests: dbPath,
      detectionOverrideForTests: { present: true, version: "0.0.0" },
      checkpointsTipOverrideForTests: null,
    });
    assert.equal(s1.state, "not_enabled");

    const s2 = await getEntireRepoStatus(repoDisabled, {
      persist: true,
      dbPathOverrideForTests: dbPath,
      detectionOverrideForTests: { present: true, version: "0.0.0" },
      checkpointsTipOverrideForTests: null,
    });
    assert.equal(s2.state, "not_enabled");

    const s3 = await getEntireRepoStatus(repoEnabledNoCommits, {
      persist: true,
      dbPathOverrideForTests: dbPath,
      detectionOverrideForTests: { present: true, version: "0.0.0" },
      checkpointsTipOverrideForTests: null,
    });
    assert.equal(s3.state, "enabled_no_commits");

    const s4 = await getEntireRepoStatus(repoActive, {
      persist: true,
      dbPathOverrideForTests: dbPath,
      detectionOverrideForTests: { present: true, version: "0.0.0" },
      checkpointsTipOverrideForTests: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    });
    assert.equal(s4.state, "active");

    const row = getRepoState(dbPath, repoActive);
    assert.ok(row, "expected vibedeck_repos row to exist");
    assert.equal(row.entire_state, "active");
  } finally {
    tmp.cleanup();
  }
});

