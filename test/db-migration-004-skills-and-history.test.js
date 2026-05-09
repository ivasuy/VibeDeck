const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  initSchema,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
} = require("../src/lib/db/schema");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-m004-"));
  return {
    dir,
    dbPath: path.join(dir, "test.db"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

test("migration 004 creates skills inventory + head history tables with expected PKs and index", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    const m001 = require("../src/lib/db/migrations/001-vibedeck-sessions");
    const m002 = require("../src/lib/db/migrations/002-session-buckets-and-windows");
    const m003 = require("../src/lib/db/migrations/003-entire-links-and-repos");
    const m004 = require("../src/lib/db/migrations/004-skills-and-head-history");
    registerMigration(m001);
    registerMigration(m002);
    registerMigration(m003);
    registerMigration(m004);
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);

    const skillsCols = db
      .prepare("PRAGMA table_info('vibedeck_skills')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(skillsCols, [
      "provider",
      "name",
      "install_path",
      "source_url",
      "installed_at",
      "last_used_estimate",
    ]);

    const headCols = db
      .prepare("PRAGMA table_info('vibedeck_head_history')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(headCols, [
      "repo_root",
      "worktree_root",
      "transitioned_at",
      "ref_name",
    ]);

    const idx = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_head_history_lookup'",
      )
      .get();
    assert.ok(idx, "expected idx_head_history_lookup index to exist");

    db.close();
  } finally {
    tmp.cleanup();
  }
});

