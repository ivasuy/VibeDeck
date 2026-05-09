const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { initSchema, getSchemaVersion } = require("../src/lib/db/schema");

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-schema-"));
  return path.join(dir, "db.sqlite");
}

test("schema_version exposes applied_at column (not updated_at)", () => {
  const dbPath = tmpDb();
  initSchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const cols = db
    .prepare("PRAGMA table_info('schema_version')")
    .all()
    .map((r) => r.name);
  db.close();
  assert.ok(cols.includes("applied_at"), `expected applied_at; got ${cols.join(",")}`);
  assert.ok(!cols.includes("updated_at"));
});

test("getSchemaVersion does not create -wal/-shm files (read-only open)", () => {
  const dbPath = tmpDb();
  initSchema(dbPath);
  const before = fs.existsSync(`${dbPath}-wal`);
  getSchemaVersion(dbPath, "never-exists");
  const after = fs.existsSync(`${dbPath}-wal`);
  assert.strictEqual(after, before, "getSchemaVersion must not flip WAL on");
});

