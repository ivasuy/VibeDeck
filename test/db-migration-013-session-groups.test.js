const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-session-groups-'));
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

test('migration 013 creates session group edge and skip tables', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all()
        .map((row) => row.name);
      assert.ok(tables.includes('vibedeck_session_group_edges'));
      assert.ok(tables.includes('vibedeck_session_group_skips'));

      for (const name of [
        'provider',
        'session_group_id',
        'root_session_id',
        'child_session_id',
        'root_thread_id',
        'child_thread_id',
        'relation_proof',
        'depth',
        'agent_id',
        'agent_label',
        'agent_role',
        'source_path',
        'created_at',
        'updated_at',
      ]) {
        assert.ok(tableColumns(db, 'vibedeck_session_group_edges').includes(name), `missing edge column ${name}`);
      }

      for (const name of [
        'provider',
        'child_session_id',
        'child_thread_id',
        'skip_reason',
        'source_path',
        'observed_at',
        'created_at',
        'updated_at',
      ]) {
        assert.ok(tableColumns(db, 'vibedeck_session_group_skips').includes(name), `missing skip column ${name}`);
      }
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('session group edge uniqueness is by provider and child session', () => {
  const tmp = makeDb();
  try {
    ensureSchema(tmp.dbPath);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      const now = '2026-05-23T00:00:00.000Z';
      const insert = db.prepare(`
        INSERT INTO vibedeck_session_group_edges (
          provider, session_group_id, root_session_id, child_session_id,
          relation_proof, depth, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run('codex', 'codex:root-a', 'root-a', 'child-a', 'codex_thread_spawn', 1, now, now);
      assert.throws(
        () => insert.run('codex', 'codex:root-b', 'root-b', 'child-a', 'codex_thread_spawn', 1, now, now),
        /UNIQUE|constraint/i,
      );
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
