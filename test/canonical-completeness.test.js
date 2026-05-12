const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { readCanonicalCompleteness } = require("../src/lib/sessions/canonical-completeness");

test("canonical completeness is false when sessions exist without bucket facts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-complete-"));
  const dbPath = path.join(dir, "vibedeck.sqlite3");
  try {
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    db.exec(`
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd, created_at, updated_at
      ) VALUES (
        'codex', 'missing-bucket', '2026-05-12T00:00:00.000Z', '2026-05-12T00:01:00.000Z', 'complete',
        '/repo', '/repo', NULL, '/repo',
        'main', 'A', 'high', NULL,
        'gpt-5.5', 1000, NULL, '2026-05-12T00:00:00.000Z', '2026-05-12T00:01:00.000Z'
      );
    `);
    db.close();

    const result = readCanonicalCompleteness(dbPath);
    assert.equal(result.complete, false);
    assert.equal(result.sessions_missing_bucket_facts, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
