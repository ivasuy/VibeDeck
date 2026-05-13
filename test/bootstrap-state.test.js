const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  readBootstrapState,
  writeBootstrapState,
  mergeBootstrapState,
} = require("../src/lib/bootstrap/state");

test("bootstrap state round-trips under VIBEDECK_HOME", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-bootstrap-state-"));
  const prev = process.env.VIBEDECK_HOME;

  try {
    process.env.VIBEDECK_HOME = tmp;
    await writeBootstrapState({
      native_app: { installed: true, path: "/Applications/VibeDeck.app", version: "0.1.1" },
      entire: { installed: true, logged_in: false },
      pending: ["entire_login", "readme_sync"],
    });
    const state = await readBootstrapState();
    assert.equal(state.native_app.installed, true);
    assert.equal(state.entire.logged_in, false);

    await mergeBootstrapState({ pending: ["readme_sync"] });
    const merged = await readBootstrapState();
    assert.deepEqual(merged.pending, ["readme_sync"]);
  } finally {
    if (prev === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
