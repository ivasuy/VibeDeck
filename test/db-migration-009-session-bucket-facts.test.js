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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-m009-'));
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

test('migration 009 expands vibedeck_session_buckets into a durable bucket fact table', () => {
  const tmp = makeTempDbPath();
  try {
    initSchema(tmp.dbPath);
    registerMigration(require('../src/lib/db/migrations/001-vibedeck-sessions'));
    registerMigration(require('../src/lib/db/migrations/002-session-buckets-and-windows'));
    registerMigration(require('../src/lib/db/migrations/009-session-bucket-facts'));
    runPendingMigrations(tmp.dbPath);

    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    const cols = db
      .prepare("PRAGMA table_info('vibedeck_session_buckets')")
      .all()
      .map((row) => row.name);
    for (const name of [
      'input_tokens',
      'cached_input_tokens',
      'cache_creation_input_tokens',
      'output_tokens',
      'reasoning_output_tokens',
      'conversation_count',
      'total_tokens',
      'total_cost_usd',
      'cost_estimated',
      'cost_quality',
      'last_observed_at',
    ]) {
      assert.ok(cols.includes(name), `${name} column missing`);
    }
    db.close();
  } finally {
    tmp.cleanup();
  }
});
