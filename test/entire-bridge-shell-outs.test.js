const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  detectEntire,
  validateAgentName,
  validateBranchName,
  enableEntire,
  rewindCheckpoint,
  cleanEntire,
} = require("../src/lib/entire-bridge");

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return {
    dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("validateAgentName accepts known agent names", () => {
  const ok = [
    "claude-code",
    "codex",
    "gemini",
    "opencode",
    "cursor",
    "factoryai-droid",
    "copilot-cli",
  ];
  for (const name of ok) validateAgentName(name);
});

test("validateAgentName rejects unknown agent names", () => {
  assert.throws(() => validateAgentName("rm -rf /"), /Invalid agent name/i);
  assert.throws(() => validateAgentName("unknown"), /Invalid agent name/i);
});

test("validateBranchName rejects branch names failing git check-ref-format", async () => {
  await assert.rejects(() => validateBranchName(".."), /Invalid branch name/i);
  await assert.rejects(() => validateBranchName(""), /Invalid branch name/i);
});

test("enableEntire returns { exitCode, stdout, stderr } (skips if entire missing)", async (t) => {
  const ent = await detectEntire({ timeoutMs: 500 });
  if (!ent.present) t.skip("entire not on PATH");

  const tmp = makeTempDir("vibedeck-entire-enable-");
  try {
    execFileSync("git", ["init"], { cwd: tmp.dir, stdio: "ignore" });
    const res = await enableEntire(tmp.dir, []);
    assert.equal(typeof res.exitCode, "number");
    assert.equal(typeof res.stdout, "string");
    assert.equal(typeof res.stderr, "string");
  } finally {
    tmp.cleanup();
  }
});

test("rewindCheckpoint rejects without confirm token and validates checkpoint id format", async () => {
  const tmp = makeTempDir("vibedeck-entire-rewind-");
  await assert.rejects(
    () => rewindCheckpoint(tmp.dir, "aaaaaaaaaaaa"),
    /confirm token/i,
  );
  await assert.rejects(
    () => rewindCheckpoint(tmp.dir, "AAAAAAAAAAAA", "ok"),
    /12 lowercase hex chars/i,
  );
  tmp.cleanup();
});

test("rewindCheckpoint rejects missing confirm token before validating id", async () => {
  const bridge = require("../src/lib/entire-bridge");
  await assert.rejects(
    () => bridge.rewindCheckpoint("/tmp", "NOT-HEX", ""),
    (err) => /confirm token/i.test(err.message) && !/checkpoint id/i.test(err.message),
  );
});

test("cleanEntire rejects without confirm token", async () => {
  const tmp = makeTempDir("vibedeck-entire-clean-");
  await assert.rejects(() => cleanEntire(tmp.dir), /confirm token/i);
  await assert.rejects(() => cleanEntire(tmp.dir, ""), /confirm token/i);
  tmp.cleanup();
});
