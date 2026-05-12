const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const {
  readCanonicalCompleteness,
  summarizeCanonicalCompletenessForSessions,
} = require("../src/lib/sessions/canonical-completeness");

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

test("session-scoped completeness ignores unrelated missing bucket facts", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-complete-scoped-"));
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
      ) VALUES
      (
        'codex', 'active-scoped', '2026-05-12T01:00:00.000Z', NULL, NULL,
        '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
        'main', 'A', 'high', NULL,
        'gpt-5.5', 2000, 2.5, '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z'
      ),
      (
        'cursor', 'old-1', '2026-04-01T01:00:00.000Z', '2026-04-01T01:05:00.000Z', 'complete',
        '/old/repo1', '/old/repo1', NULL, '/old/repo1',
        'main', 'A', 'high', NULL,
        'cursor-model', 1000, NULL, '2026-04-01T01:00:00.000Z', '2026-04-01T01:05:00.000Z'
      ),
      (
        'cursor', 'old-2', '2026-04-02T01:00:00.000Z', '2026-04-02T01:05:00.000Z', 'complete',
        '/old/repo2', '/old/repo2', NULL, '/old/repo2',
        'main', 'A', 'high', NULL,
        'cursor-model', 1200, NULL, '2026-04-02T01:00:00.000Z', '2026-04-02T01:05:00.000Z'
      );

      INSERT INTO vibedeck_session_buckets (
        provider, session_id, bucket_provider, bucket_model, bucket_hour_start, proportion
      ) VALUES (
        'codex', 'active-scoped', 'codex', 'gpt-5.5', '2026-05-12T01:00:00.000Z', 1.0
      );
    `);
    db.close();

    const global = readCanonicalCompleteness(dbPath);
    assert.equal(global.complete, false);

    const scoped = summarizeCanonicalCompletenessForSessions(dbPath, [
      { provider: "codex", session_id: "active-scoped" },
    ]);
    assert.equal(scoped.complete, true);
    assert.equal(scoped.session_count, 1);
    assert.equal(scoped.sessions_missing_bucket_facts, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
