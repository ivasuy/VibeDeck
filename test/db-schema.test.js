const assert = require("node:assert/strict");
const { test, beforeEach } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const {
  initSchema,
  getSchemaVersion,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
} = require("../src/lib/db/schema");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-schema-"));
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

test("initSchema creates schema_version; getSchemaVersion returns 0 on empty db", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'",
      )
      .get();
    db.close();
    assert.ok(row, "schema_version table should exist");

    assert.equal(getSchemaVersion(tmp.dbPath, "core"), 0);
  } finally {
    tmp.cleanup();
  }
});

test("registerMigration + runPendingMigrations applies migration and bumps version", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    registerMigration({
      component: "core",
      version: 1,
      up(db) {
        db.exec("CREATE TABLE t1 (id INTEGER PRIMARY KEY);");
      },
    });

    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);
    const t1 = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 't1'",
      )
      .get();
    db.close();

    assert.ok(t1, "migration should have created t1");
    assert.equal(getSchemaVersion(tmp.dbPath, "core"), 1);
  } finally {
    tmp.cleanup();
  }
});

test("runPendingMigrations is idempotent (a migration runs at most once)", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    registerMigration({
      component: "core",
      version: 1,
      up(db) {
        db.exec("CREATE TABLE runs (n INTEGER NOT NULL);");
        db.exec("INSERT INTO runs(n) VALUES (1);");
      },
    });

    runPendingMigrations(tmp.dbPath);
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);
    const count = db.prepare("SELECT COUNT(*) AS c FROM runs").get().c;
    db.close();

    assert.equal(count, 1);
    assert.equal(getSchemaVersion(tmp.dbPath, "core"), 1);
  } finally {
    tmp.cleanup();
  }
});

test("runPendingMigrations creates a backup file before applying migrations", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    registerMigration({
      component: "core",
      version: 1,
      up(db) {
        db.exec("CREATE TABLE backup_check (id INTEGER PRIMARY KEY);");
      },
    });

    runPendingMigrations(tmp.dbPath);

    const backups = fs
      .readdirSync(tmp.dir)
      .filter((name) => name.startsWith("test.db.bak."));
    assert.ok(backups.length >= 1, "expected at least one backup file");
  } finally {
    tmp.cleanup();
  }
});

