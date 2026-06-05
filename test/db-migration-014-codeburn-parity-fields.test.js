const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-parity-'));
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

for (const table of ['vibedeck_session_events', 'vibedeck_sessions']) {
  test(`migration 014 adds event/session Codeburn fields to ${table}`, () => {
    const tmp = makeDb();
    try {
      ensureSchema(tmp.dbPath);
      const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
      try {
        const names = columns(db, table);
        for (const name of ['task_category', 'tools_sequence_json', 'skills_json', 'fast_mode']) {
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

for (const table of ['vibedeck_session_buckets', 'vibedeck_branch_usage_facts']) {
  test(`migration 014 adds aggregate Codeburn fields to ${table}`, () => {
    const tmp = makeDb();
    try {
      ensureSchema(tmp.dbPath);
      const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
      try {
        const names = columns(db, table);
        for (const name of ['task_category', 'skills_json', 'fast_mode']) {
          assert.ok(names.includes(name), `${table} missing ${name}`);
        }
        assert.ok(!names.includes('tools_sequence_json'), `${table} must not aggregate ordered tool sequence`);
      } finally {
        db.close();
      }
    } finally {
      tmp.cleanup();
    }
  });
}
