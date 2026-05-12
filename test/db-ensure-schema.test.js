const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-ensure-schema-"));
  return {
    dir,
    dbPath: path.join(dir, "test.db"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function listTables(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
  } finally {
    db.close();
  }
}

test("ensureSchema creates all vibedeck_* tables on a fresh DB", () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require("../src/lib/db");
    ensureSchema(tmp.dbPath);

    const tables = listTables(tmp.dbPath);
    const vibedeckTables = [
      "vibedeck_sessions",
      "vibedeck_session_buckets",
      "vibedeck_session_branch_windows",
      "vibedeck_session_entire_links",
      "vibedeck_entire_checkpoint_matches",
      "vibedeck_repos",
      "vibedeck_skills",
      "vibedeck_head_history",
    ];

    assert.ok(tables.includes("schema_version"), "schema_version should exist");
    for (const name of vibedeckTables) {
      assert.ok(tables.includes(name), `missing expected table: ${name}`);
    }
  } finally {
    tmp.cleanup();
  }
});

test("ensureSchema is idempotent across multiple calls", () => {
  const tmp = makeTempDbPath();
  try {
    const { ensureSchema } = require("../src/lib/db");
    ensureSchema(tmp.dbPath);
    const tablesAfterFirst = listTables(tmp.dbPath);

    ensureSchema(tmp.dbPath);
    ensureSchema(tmp.dbPath);
    const tablesAfterThird = listTables(tmp.dbPath);

    assert.deepEqual(tablesAfterThird, tablesAfterFirst);
  } finally {
    tmp.cleanup();
  }
});
