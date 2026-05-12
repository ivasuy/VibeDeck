const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-mig-010-"));
  return {
    dir,
    dbPath: path.join(dir, "test.db"),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("migration 010 creates vibedeck_entire_checkpoint_matches schema and supports unmatched rows", () => {
  const tmp = makeTempDbPath();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      const cols = db.prepare("PRAGMA table_info('vibedeck_entire_checkpoint_matches')").all();
      const names = cols.map((row) => row.name);
      for (const required of [
        "repo_root",
        "checkpoint_group_id",
        "match_status",
        "match_confidence",
        "reason",
        "candidate_count",
      ]) {
        assert.ok(names.includes(required), `missing expected column: ${required}`);
      }

      db.prepare(`
        INSERT INTO vibedeck_entire_checkpoint_matches (
          repo_root, checkpoint_group_id, checkpoint_id, metadata_path,
          match_status, match_confidence, reason, candidate_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "/repo",
        "e2/abdc1ec6",
        "e2abdc1ec6",
        "e2/abdc1ec6/metadata.json",
        "unmatched",
        "unmatched",
        "no_matching_session",
        0,
        "2026-05-12T00:00:00.000Z",
        "2026-05-12T00:00:00.000Z",
      );

      const row = db.prepare(`
        SELECT match_status, match_confidence
        FROM vibedeck_entire_checkpoint_matches
        WHERE repo_root = ? AND checkpoint_group_id = ?
      `).get("/repo", "e2/abdc1ec6");
      assert.equal(row.match_status, "unmatched");
      assert.equal(row.match_confidence, "unmatched");
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
