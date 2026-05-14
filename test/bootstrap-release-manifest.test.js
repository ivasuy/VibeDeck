const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveNativeArtifactSpec } = require("../src/lib/bootstrap/release-manifest");

test("release manifest resolves macOS zipped app artifact", () => {
  const spec = resolveNativeArtifactSpec({
    version: "0.1.2",
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(spec.kind, "zip");
  assert.match(spec.fileName, /VibeDeck.*\.zip$/);
  assert.match(spec.url, /v0\.1\.2/);
});
