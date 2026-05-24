const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-session-enrichment-'));
  return {
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function tableColumns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
}

for (const table of ['vibedeck_session_events', 'vibedeck_sessions', 'vibedeck_session_buckets', 'vibedeck_branch_usage_facts']) {
  test(`migration 012 adds enrichment columns to ${table}`, () => {
    const tmp = makeDb();
    try {
      ensureSchema(tmp.dbPath);
      const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
      try {
        const names = tableColumns(db, table);
        for (const name of [
          'cache_creation_5m_input_tokens',
          'cache_creation_1h_input_tokens',
          'web_search_requests',
          'tool_call_count',
          'tools_json',
          'activity_json',
        ]) {
          assert.ok(names.includes(name), `${table} missing ${name}`);
        }
      } finally {
        db.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
}
