const assert = require("node:assert/strict");
const test = require("node:test");

const { chooseInstallTarget } = require("../src/lib/bootstrap/install-native");

test("chooseInstallTarget prefers /Applications before user Applications", async () => {
  const target = await chooseInstallTarget({
    targets: ["/Applications/VibeDeck.app", "/Users/test/Applications/VibeDeck.app"],
    canWrite: async (candidate) => candidate.startsWith("/Applications"),
  });
  assert.equal(target, "/Applications/VibeDeck.app");
});

test("chooseInstallTarget falls back to user Applications when system Applications is unavailable", async () => {
  const target = await chooseInstallTarget({
    targets: ["/Applications/VibeDeck.app", "/Users/test/Applications/VibeDeck.app"],
    canWrite: async (candidate) => candidate.startsWith("/Users/test"),
  });
  assert.equal(target, "/Users/test/Applications/VibeDeck.app");
});
