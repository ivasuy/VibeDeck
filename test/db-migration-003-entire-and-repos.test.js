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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-m003-"));
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

test("migration 003 creates Entire links + repos state cache tables with expected PKs", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    const m001 = require("../src/lib/db/migrations/001-vibedeck-sessions");
    const m002 = require("../src/lib/db/migrations/002-session-buckets-and-windows");
    const m003 = require("../src/lib/db/migrations/003-entire-links-and-repos");
    registerMigration(m001);
    registerMigration(m002);
    registerMigration(m003);
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);

    const repos = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_repos'",
      )
      .get();
    const links = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_session_entire_links'",
      )
      .get();
    assert.ok(repos, "vibedeck_repos table should exist");
    assert.ok(links, "vibedeck_session_entire_links table should exist");

    const repoCols = db
      .prepare("PRAGMA table_info('vibedeck_repos')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(repoCols, [
      "repo_root",
      "entire_state",
      "entire_checked_at",
      "entire_version",
    ]);

    db.prepare(
      `
        INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
        VALUES ('/repo', 'ok', '2026-05-09T00:00:00Z', '1.2.3')
      `,
    ).run();
    assert.throws(() => {
      db.prepare(
        `
          INSERT INTO vibedeck_repos (repo_root, entire_state, entire_checked_at, entire_version)
          VALUES ('/repo', 'ok', '2026-05-09T00:00:00Z', '1.2.3')
        `,
      ).run();
    }, /constraint/i);

    const linkCols = db
      .prepare("PRAGMA table_info('vibedeck_session_entire_links')")
      .all()
      .map((row) => row.name);
    assert.deepEqual(linkCols, [
      "provider",
      "session_id",
      "entire_session_id",
      "entire_checkpoint_ids",
      "match_confidence",
    ]);

    db.close();
  } finally {
    tmp.cleanup();
  }
});

