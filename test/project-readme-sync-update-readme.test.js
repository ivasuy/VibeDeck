const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_IMAGE_PATH,
  PROJECT_MARKER_END,
  PROJECT_MARKER_START,
  PROJECT_USAGE_HEADING,
  buildManagedProjectReadmeBlock,
  upsertManagedProjectReadmeBlock,
  writeManagedProjectReadme,
} = require("../src/lib/project-readme-sync/update-readme");

test("buildManagedProjectReadmeBlock renders the project managed block", () => {
  const expected = [
    PROJECT_USAGE_HEADING,
    "",
    PROJECT_MARKER_START,
    `![VibeDeck Project Usage](${DEFAULT_IMAGE_PATH})`,
    PROJECT_MARKER_END,
  ].join("\n");

  assert.equal(buildManagedProjectReadmeBlock(), expected);
});

test("upsertManagedProjectReadmeBlock replaces an existing managed project block", () => {
  const original = [
    "# Project",
    "",
    PROJECT_MARKER_START,
    "![Old Usage](./old.svg)",
    PROJECT_MARKER_END,
    "",
    "Tail",
  ].join("\n");
  const expected = [
    "# Project",
    "",
    PROJECT_USAGE_HEADING,
    "",
    PROJECT_MARKER_START,
    `![VibeDeck Project Usage](${DEFAULT_IMAGE_PATH})`,
    PROJECT_MARKER_END,
    "",
    "Tail",
  ].join("\n");

  const next = upsertManagedProjectReadmeBlock({ readme: original });

  assert.equal(next, expected);
  assert.equal((next.match(new RegExp(PROJECT_MARKER_START, "g")) || []).length, 1);
  assert.equal((next.match(new RegExp(PROJECT_MARKER_END, "g")) || []).length, 1);
});

test("upsertManagedProjectReadmeBlock appends managed block when markers are missing", () => {
  const original = "# Project\n";
  const expectedSuffix = buildManagedProjectReadmeBlock();
  const next = upsertManagedProjectReadmeBlock({ readme: original });

  assert.equal(next, "# Project\n" + expectedSuffix + "\n");
  assert.equal((next.match(new RegExp(PROJECT_MARKER_START, "g")) || []).length, 1);
  assert.equal((next.match(new RegExp(PROJECT_MARKER_END, "g")) || []).length, 1);
});

test("writeManagedProjectReadme rewrites README.md in place", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-readme-sync-"));
  const readmePath = path.join(tmpDir, "README.md");
  const original = [
    "# Project",
    "",
    PROJECT_MARKER_START,
    "![Old Usage](./old.svg)",
    PROJECT_MARKER_END,
  ].join("\n");
  await fs.writeFile(readmePath, original, "utf8");

  try {
    await writeManagedProjectReadme({ readmePath });
    const rewritten = await fs.readFile(readmePath, "utf8");

    assert.ok(rewritten.includes(PROJECT_MARKER_START));
    assert.ok(rewritten.includes(PROJECT_MARKER_END));
    assert.ok(rewritten.includes(PROJECT_USAGE_HEADING));
    assert.equal(rewritten.includes("![Old Usage](./old.svg)"), false);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
