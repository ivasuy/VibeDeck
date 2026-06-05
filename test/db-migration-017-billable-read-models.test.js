'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-billable-read-models-'));
  return {
    dbPath: path.join(dir, 'vibedeck.sqlite3'),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info('${table}')`).all().map((row) => row.name);
}

test('billable read-model migrations add billable totals to canonical read models', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      for (const table of [
        'vibedeck_session_events',
        'vibedeck_session_buckets',
        'vibedeck_branch_usage_facts',
      ]) {
        assert.ok(columns(db, table).includes('billable_total_tokens'), `${table} missing billable_total_tokens`);
      }
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
