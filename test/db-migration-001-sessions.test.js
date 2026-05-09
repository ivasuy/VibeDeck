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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-m001-"));
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

test("migration 001 creates vibedeck_sessions with expected columns and composite PK", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    const m001 = require("../src/lib/db/migrations/001-vibedeck-sessions");
    registerMigration(m001);
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_sessions'",
      )
      .get();
    assert.ok(table, "vibedeck_sessions table should exist");

    const cols = db
      .prepare("PRAGMA table_info('vibedeck_sessions')")
      .all()
      .map((row) => row.name);
    const expected = [
      "provider",
      "session_id",
      "started_at",
      "ended_at",
      "end_reason",
      "cwd",
      "repo_root",
      "repo_common_dir",
      "parent_repo",
      "branch",
      "branch_resolution_tier",
      "confidence",
      "override_user",
      "model",
      "total_tokens",
      "total_cost_usd",
      "created_at",
      "updated_at",
    ];
    assert.deepEqual(cols, expected);

    db.prepare(
      `
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo, branch,
          branch_resolution_tier, confidence, override_user, model,
          total_tokens, total_cost_usd, created_at, updated_at
        ) VALUES (
          'codex', 'abc123', '2026-05-09T00:00:00Z', NULL, NULL,
          '/tmp', '/repo', NULL, NULL, 'main',
          'tier1', 'high', NULL, 'gpt-5.2',
          10, 0.01, '2026-05-09T00:00:00Z', '2026-05-09T00:00:00Z'
        )
      `,
    ).run();

    assert.throws(() => {
      db.prepare(
        `
          INSERT INTO vibedeck_sessions (
            provider, session_id, started_at, ended_at, end_reason,
            cwd, repo_root, repo_common_dir, parent_repo, branch,
            branch_resolution_tier, confidence, override_user, model,
            total_tokens, total_cost_usd, created_at, updated_at
          ) VALUES (
            'codex', 'abc123', '2026-05-09T00:00:00Z', NULL, NULL,
            '/tmp', '/repo', NULL, NULL, 'main',
            'tier1', 'high', NULL, 'gpt-5.2',
            10, 0.01, '2026-05-09T00:00:00Z', '2026-05-09T00:00:00Z'
          )
        `,
      ).run();
    }, /constraint/i);

    db.close();

    assert.equal(getSchemaVersion(tmp.dbPath, "vibedeck-sessions"), 1);
  } finally {
    tmp.cleanup();
  }
});

