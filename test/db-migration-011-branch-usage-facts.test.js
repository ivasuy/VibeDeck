const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-branch-facts-migration-'));
  return {
    dir,
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('migration 011 creates branch usage facts projection', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const cols = db.prepare("PRAGMA table_info('vibedeck_branch_usage_facts')").all();
      const names = cols.map((row) => row.name);
      assert.deepEqual(names, [
        'provider',
        'session_id',
        'scope_key',
        'project_state',
        'project_key',
        'project_ref',
        'cwd',
        'repo_root',
        'repo_common_dir',
        'parent_repo',
        'branch',
        'attribution_branch',
        'branch_kind',
        'branch_resolution_tier',
        'confidence',
        'model',
        'first_observed_at',
        'last_observed_at',
        'event_count',
        'total_tokens',
        'input_tokens',
        'cached_input_tokens',
        'cache_creation_input_tokens',
        'output_tokens',
        'reasoning_output_tokens',
        'conversation_count',
        'total_cost_usd',
        'cost_estimated',
        'cost_quality',
        'token_reconciled',
        'cost_reconciled',
        'created_at',
        'updated_at',
      ]);

      const indexes = db
        .prepare("PRAGMA index_list('vibedeck_branch_usage_facts')")
        .all()
        .map((row) => row.name)
        .sort();
      assert.ok(indexes.includes('idx_branch_usage_facts_activity'));
      assert.ok(indexes.includes('idx_branch_usage_facts_project'));
      assert.ok(indexes.includes('idx_branch_usage_facts_session'));
      assert.ok(indexes.includes('sqlite_autoindex_vibedeck_branch_usage_facts_1'));
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
