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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-m002-"));
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

test("migration 002 creates session buckets + branch windows; enforces FK and defaults", () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);

    const m001 = require("../src/lib/db/migrations/001-vibedeck-sessions");
    const m002 = require("../src/lib/db/migrations/002-session-buckets-and-windows");
    registerMigration(m001);
    registerMigration(m002);
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath);

    const buckets = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_session_buckets'",
      )
      .get();
    const windows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vibedeck_session_branch_windows'",
      )
      .get();
    assert.ok(buckets, "vibedeck_session_buckets table should exist");
    assert.ok(windows, "vibedeck_session_branch_windows table should exist");

    // FK should reject orphan inserts (provider, session_id) not present in vibedeck_sessions.
    assert.throws(() => {
      db.prepare(
        `
          INSERT INTO vibedeck_session_buckets (
            provider, session_id, bucket_provider, bucket_model, bucket_hour_start, proportion
          ) VALUES (
            'codex', 'missing', 'codex', 'gpt-5.2', '2026-05-09T00:00:00Z', 1.0
          )
        `,
      ).run();
    }, /foreign key|constraint/i);

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

    // proportion defaults to 1.0 when omitted.
    db.prepare(
      `
        INSERT INTO vibedeck_session_buckets (
          provider, session_id, bucket_provider, bucket_model, bucket_hour_start
        ) VALUES (
          'codex', 'abc123', 'codex', 'gpt-5.2', '2026-05-09T00:00:00Z'
        )
      `,
    ).run();
    const proportion = db
      .prepare(
        `
          SELECT proportion
          FROM vibedeck_session_buckets
          WHERE provider = 'codex' AND session_id = 'abc123'
        `,
      )
      .get().proportion;
    assert.equal(proportion, 1.0);

    const windowCols = db
      .prepare("PRAGMA table_info('vibedeck_session_branch_windows')")
      .all()
      .map((row) => row.name);
    const expectedWindowCols = [
      "id",
      "provider",
      "session_id",
      "branch",
      "window_start",
      "window_end",
      "prorated_tokens",
      "prorated_cost_usd",
    ];
    assert.deepEqual(windowCols, expectedWindowCols);

    db.close();
  } finally {
    tmp.cleanup();
  }
});

