'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

/** @type {Map<string, Map<number, {component: string, version: number, up: Function}>>} */
const registry = new Map();

function openDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  return db;
}

function initSchema(dbPath) {
  const db = openDb(dbPath);
  try {
    const cols = db
      .prepare("PRAGMA table_info('schema_version')")
      .all()
      .map((r) => r.name);
    const hasTable = cols.length > 0;
    const hasUpdatedAt = cols.includes('updated_at');
    const hasAppliedAt = cols.includes('applied_at');

    if (hasTable && hasUpdatedAt && !hasAppliedAt) {
      db.exec('DROP TABLE schema_version;');
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        component TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
  } finally {
    db.close();
  }
}

function getSchemaVersion(dbPath, component) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db
      .prepare('SELECT version FROM schema_version WHERE component = ?')
      .get(component);
    if (!row) return 0;
    return row.version || 0;
  } finally {
    db.close();
  }
}

function registerMigration(migration) {
  if (!migration || typeof migration !== 'object') {
    throw new TypeError('migration must be an object');
  }
  const { component, version, up } = migration;
  if (typeof component !== 'string' || component.trim() === '') {
    throw new TypeError('migration.component must be a non-empty string');
  }
  if (!Number.isInteger(version) || version <= 0) {
    throw new TypeError('migration.version must be a positive integer');
  }
  if (typeof up !== 'function') {
    throw new TypeError('migration.up must be a function');
  }

  const normalizedComponent = component.trim();
  let byVersion = registry.get(normalizedComponent);
  if (!byVersion) {
    byVersion = new Map();
    registry.set(normalizedComponent, byVersion);
  }
  if (byVersion.has(version)) {
    throw new Error(
      `migration already registered for component "${normalizedComponent}" version ${version}`,
    );
  }
  byVersion.set(version, { component: normalizedComponent, version, up });
}

function runPendingMigrations(dbPath) {
  const db = openDb(dbPath);
  let didBackup = false;
  let appliedCount = 0;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        component TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);

    /** @type {Array<{component: string, version: number, up: Function}>} */
    const pending = [];

    for (const [component, byVersion] of registry.entries()) {
      const row = db
        .prepare('SELECT version FROM schema_version WHERE component = ?')
        .get(component);
      const currentVersion = row ? row.version || 0 : 0;

      for (const [version, migration] of byVersion.entries()) {
        if (version > currentVersion) pending.push(migration);
      }
    }

    pending.sort((a, b) => {
      if (a.component < b.component) return -1;
      if (a.component > b.component) return 1;
      return a.version - b.version;
    });

    for (const migration of pending) {
      if (!didBackup) {
        const backupPath = `${dbPath}.bak.${new Date().toISOString()}`;
        fs.copyFileSync(dbPath, backupPath);
        didBackup = true;
      }

      const appliedAt = new Date().toISOString();
      db.exec('BEGIN');
      try {
        migration.up(db);
        db.prepare(
          `
            INSERT INTO schema_version (component, version, applied_at)
            VALUES (?, ?, ?)
            ON CONFLICT(component) DO UPDATE SET
              version = excluded.version,
              applied_at = excluded.applied_at
          `,
        ).run(migration.component, migration.version, appliedAt);
        db.exec('COMMIT');
        appliedCount += 1;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // ignore rollback errors; rethrow original
        }
        throw err;
      }
    }

    return { applied: appliedCount };
  } finally {
    db.close();
  }
}

function _resetRegistryForTests() {
  registry.clear();
}

module.exports = {
  initSchema,
  getSchemaVersion,
  registerMigration,
  runPendingMigrations,
  _resetRegistryForTests,
};
