const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSessionEventProcessor } = require("../src/commands/sync");

async function waitFor(predicate) {
  for (let i = 0; i < 10; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("sync session events are processed serially and can be drained", async () => {
  const started = [];
  const finished = [];
  const releases = [];
  const processor = createSessionEventProcessor(async (event) => {
    started.push(event.id);
    await new Promise((resolve) => releases.push(resolve));
    finished.push(event.id);
  });

  processor.onSessionEvent({ id: "first" });
  processor.onSessionEvent({ id: "second" });

  await Promise.resolve();
  assert.deepEqual(started, ["first"]);
  assert.deepEqual(finished, []);

  releases[0]();
  await waitFor(() => started.length === 2);
  assert.deepEqual(started, ["first", "second"]);
  assert.deepEqual(finished, ["first"]);

  releases[1]();
  const drain = await processor.drain();

  assert.deepEqual(finished, ["first", "second"]);
  assert.deepEqual(drain.errors, []);
});

test("sync session event drain waits after processor errors and continues later events", async () => {
  const finished = [];
  const processor = createSessionEventProcessor(async (event) => {
    if (event.id === "bad") throw new Error("expected failure");
    finished.push(event.id);
  });

  processor.onSessionEvent({ id: "good-before" });
  processor.onSessionEvent({ id: "bad" });
  processor.onSessionEvent({ id: "good-after" });

  const drain = await processor.drain();

  assert.deepEqual(finished, ["good-before", "good-after"]);
  assert.equal(drain.errors.length, 1);
  assert.equal(drain.errors[0].message, "expected failure");
});
