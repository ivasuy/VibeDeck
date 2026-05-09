const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  detectEntire,
  validateAgentName,
  validateBranchName,
  enableEntire,
} = require("../src/lib/entire-bridge");

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

  const res = await enableEntire(process.cwd(), []);
  assert.equal(typeof res.exitCode, "number");
  assert.equal(typeof res.stdout, "string");
  assert.equal(typeof res.stderr, "string");
});

