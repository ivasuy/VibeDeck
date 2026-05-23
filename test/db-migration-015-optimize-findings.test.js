'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('../src/lib/db');

test('migration 015 creates isolated optimize tables and leaves branch facts intact', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-opt-migration-'));
  const dbPath = path.join(dir, 'usage.db');
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'vibedeck_optimize_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    assert.deepEqual(tables, ['vibedeck_optimize_findings', 'vibedeck_optimize_runs']);
    const factCols = db.prepare('PRAGMA table_info(vibedeck_branch_usage_facts)').all().map((r) => r.name);
    assert.ok(factCols.includes('total_cost_usd'));
    assert.ok(!factCols.includes('estimated_cost_waste_usd'));
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
