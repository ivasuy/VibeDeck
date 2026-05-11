const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  listCheckpoints,
  readCheckpoint,
} = require("../src/lib/entire-bridge");

function sh(cwd, argv) {
  execFileSync(argv[0], argv.slice(1), { cwd, stdio: "ignore" });
}

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-entire-git-"));
  sh(dir, ["git", "init"]);
  sh(dir, ["git", "config", "user.email", "test@example.com"]);
  sh(dir, ["git", "config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, "README.md"), "x\n");
  sh(dir, ["git", "add", "README.md"]);
  sh(dir, ["git", "commit", "-m", "init"]);
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("listCheckpoints reports branch present and lists files; readCheckpoint parses JSON", async () => {
  const repo = makeTempRepo();
  try {
    sh(repo.dir, ["git", "checkout", "--orphan", "entire/checkpoints/v1"]);
    sh(repo.dir, ["git", "rm", "-rf", "."]);

    const filePath = "checkpoints/synth.json";
    fs.mkdirSync(path.join(repo.dir, "checkpoints"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, filePath),
      JSON.stringify({ ok: true, n: 1 }),
    );
    sh(repo.dir, ["git", "add", filePath]);
    sh(repo.dir, ["git", "commit", "-m", "checkpoint"]);

    const listed = await listCheckpoints(repo.dir);
    assert.equal(listed.available, true);
    assert.ok(listed.files.includes(filePath));

    const json = await readCheckpoint(repo.dir, filePath);
    assert.equal(json.path, "checkpoints/synth.json");
    assert.equal(json.file_name, "synth.json");
    assert.equal(json.kind, "json");
    assert.equal(json.parse_error, null);
    assert.deepEqual(json.parsed, { ok: true, n: 1 });
    assert.equal(json.raw, '{"ok":true,"n":1}');
    assert.equal(json.line_count, 1);
    assert.equal(json.size_bytes, 17);
  } finally {
    repo.cleanup();
  }
});

test("listCheckpoints reports branch_not_fetched when checkpoints branch is absent", async () => {
  const repo = makeTempRepo();
  try {
    const listed = await listCheckpoints(repo.dir);
    assert.deepEqual(listed, { available: false, reason: "branch_not_fetched" });
  } finally {
    repo.cleanup();
  }
});
