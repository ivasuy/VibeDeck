const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const WORKFLOW_PATH = path.join(
  __dirname,
  "..",
  ".github",
  "workflows",
  "release-main.yml"
);

function loadWorkflow() {
  return fs.readFileSync(WORKFLOW_PATH, "utf8");
}

test("release-main workflow file exists", () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH));
});

test("workflow triggers after npm publish completes", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("workflow_run:"));
  assert.ok(content.includes('workflows: ["npm publish"]'));
  assert.ok(content.includes("types: [completed]"));
});

test("workflow checks out the exact npm-publish commit sha", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("github.event.workflow_run.head_sha"));
});

test("workflow verifies mac version alignment before releasing", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("Verify mac version alignment"));
  assert.ok(content.includes("MARKETING_VERSION"));
});

test("workflow skips when the GitHub release already exists", () => {
  const content = loadWorkflow();
  assert.ok(content.includes('gh release view "v$VERSION"'));
  assert.ok(content.includes("should_build_release=false"));
  assert.ok(content.includes("skipping native asset rebuild"));
});

test("workflow builds mac release assets and creates a GitHub release", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("brew install xcodegen"));
  assert.ok(content.includes("bundle-node.sh"));
  assert.ok(content.includes("create-dmg.sh"));
  assert.ok(content.includes("VibeDeck-${VERSION}-universal.zip"));
  assert.ok(content.includes('gh release create "v${VERSION}"'));
});

test("workflow updates the Homebrew tap using configured token and repo", () => {
  const content = loadWorkflow();
  assert.ok(content.includes("HOMEBREW_TAP_REPO"));
  assert.ok(content.includes("HOMEBREW_TAP_TOKEN"));
  assert.ok(content.includes("sha256sum"));
  assert.ok(content.includes("Formula/vibedeck.rb"));
  assert.ok(content.includes("git clone"));
  assert.ok(content.includes("git diff --cached --quiet --exit-code"));
  assert.ok(content.includes("git push"));
});

test("workflow has release ordering: determine -> build_release -> update_homebrew", () => {
  const content = loadWorkflow();
  const determine = content.indexOf("determine:");
  const buildRelease = content.indexOf("build_release:");
  const updateHomebrew = content.indexOf("update_homebrew:");
  assert.ok(determine >= 0);
  assert.ok(buildRelease > determine);
  assert.ok(updateHomebrew > buildRelease);
  assert.ok(content.includes("needs: determine"));
  assert.ok(content.includes("needs: [determine, build_release]"));
  assert.ok(content.includes("needs.build_release.result == 'skipped'"));
});
