const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSessionEventProcessor } = require("../src/commands/sync");

test("createSessionEventProcessor records event context for failures", async () => {
  const processor = createSessionEventProcessor(async () => {
    throw new Error("boom");
  });

  processor.onSessionEvent({
    provider: "codex",
    session_id: "s1",
    kind: "update",
    observed_at: "2026-05-12T00:00:00.000Z",
  });

  const drain = await processor.drain();
  assert.equal(drain.errors.length, 1);
  assert.equal(drain.errors[0].provider, "codex");
  assert.equal(drain.errors[0].session_id, "s1");
  assert.equal(drain.errors[0].kind, "update");
  assert.equal(drain.errors[0].observed_at, "2026-05-12T00:00:00.000Z");
  assert.match(drain.errors[0].message, /boom/);
});
