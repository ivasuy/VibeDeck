const assert = require('node:assert/strict');
const { test, beforeEach } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const {
  initSchema,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
} = require('../src/lib/db/schema');

function makeTempDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-m008-'));
  return {
    dir,
    dbPath: path.join(dir, 'test.db'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

test('migration 008 creates vibedeck_session_events and new session ledger columns', () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);
    registerMigration(require('../src/lib/db/migrations/001-vibedeck-sessions'));
    registerMigration(require('../src/lib/db/migrations/002-session-buckets-and-windows'));
    registerMigration(require('../src/lib/db/migrations/008-session-event-ledger'));
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    const eventCols = db
      .prepare("PRAGMA table_info('vibedeck_session_events')")
      .all()
      .map((row) => row.name);
    const sessionCols = db
      .prepare("PRAGMA table_info('vibedeck_sessions')")
      .all()
      .map((row) => row.name);

    assert.deepEqual(eventCols, [
      'provider',
      'session_id',
      'event_key',
      'kind',
      'observed_at',
      'started_at',
      'ended_at',
      'end_reason',
      'cwd',
      'repo_root',
      'repo_common_dir',
      'parent_repo',
      'branch',
      'branch_resolution_tier',
      'confidence',
      'model',
      'delta_tokens',
      'input_tokens',
      'cached_input_tokens',
      'cache_creation_input_tokens',
      'output_tokens',
      'reasoning_output_tokens',
      'conversation_count',
      'total_tokens',
      'created_at',
    ]);
    assert.ok(sessionCols.includes('last_observed_at'));
    assert.ok(sessionCols.includes('cost_estimated'));
    assert.ok(sessionCols.includes('cost_quality'));
    db.close();
  } finally {
    tmp.cleanup();
  }
});
