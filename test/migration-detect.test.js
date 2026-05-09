const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const migration = require('../src/lib/migration');

function tmpHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-migration-'));
}

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function withTempHome(fn) {
  const home = tmpHome();
  const prevHome = process.env.HOME;
  const prevVd = process.env.VIBEDECK_HOME;
  process.env.HOME = home;
  process.env.VIBEDECK_HOME = home;
  try {
    return fn({ home });
  } finally {
    process.env.HOME = prevHome;
    process.env.VIBEDECK_HOME = prevVd;
    resetDir(home);
  }
}

function writeSqliteDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE IF NOT EXISTS tt_sentinel (id INTEGER PRIMARY KEY, note TEXT)');
  db.prepare('INSERT INTO tt_sentinel(note) VALUES (?)').run('hello');
  db.close();
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

test('detectTokenTrackerInstall returns null when ~/.tokentracker is absent', () => {
  withTempHome(({ home }) => {
    resetDir(path.join(home, '.tokentracker'));
    const det = migration.detectTokenTrackerInstall();
    assert.strictEqual(det, null);
  });
});

test('detectTokenTrackerInstall returns { dataDir, dbPath, hasDb: true } when present with db', () => {
  withTempHome(({ home }) => {
    const ttDir = path.join(home, '.tokentracker');
    const dbPath = path.join(ttDir, 'db.sqlite');
    writeSqliteDb(dbPath);
    const det = migration.detectTokenTrackerInstall();
    assert.ok(det);
    assert.strictEqual(det.dataDir, ttDir);
    assert.strictEqual(det.dbPath, dbPath);
    assert.strictEqual(det.hasDb, true);
  });
});

test('migrateFromTokenTracker copies db to ~/.vibedeck/tracker/vibedeck.sqlite3', () => {
  withTempHome(({ home }) => {
    const ttDir = path.join(home, '.tokentracker');
    const srcDb = path.join(ttDir, 'db.sqlite');
    writeSqliteDb(srcDb);
    const beforeHash = sha256File(srcDb);

    const det = migration.detectTokenTrackerInstall();
    const result = migration.migrateFromTokenTracker(det);
    const target = path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
    assert.strictEqual(result.target_db, target);
    assert.ok(fs.existsSync(target));

    const afterHash = sha256File(srcDb);
    assert.strictEqual(afterHash, beforeHash, 'source DB must remain byte-identical');

    const db = new DatabaseSync(target);
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='vibedeck_sessions'")
      .get();
    db.close();
    assert.ok(row, 'ensureSchema should create vibedeck_sessions on the target copy');
  });
});

test('migrateFromTokenTracker writes install.json recording the choice', () => {
  withTempHome(({ home }) => {
    const ttDir = path.join(home, '.tokentracker');
    const srcDb = path.join(ttDir, 'db.sqlite');
    writeSqliteDb(srcDb);
    migration.migrateFromTokenTracker(migration.detectTokenTrackerInstall());
    const installPath = path.join(home, '.vibedeck', 'install.json');
    const json = JSON.parse(fs.readFileSync(installPath, 'utf8'));
    assert.strictEqual(json.mode, 'migrate');
    assert.strictEqual(json.source_db, srcDb);
    assert.strictEqual(json.target_db, path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3'));
    assert.ok(json.decided_at);
  });
});

test('coexistDecision writes install.json with mode \"coexist\"', () => {
  withTempHome(({ home }) => {
    migration.coexistDecision();
    const json = JSON.parse(fs.readFileSync(path.join(home, '.vibedeck', 'install.json'), 'utf8'));
    assert.strictEqual(json.mode, 'coexist');
    assert.ok(json.decided_at);
  });
});

test('freshStart writes install.json with mode \"fresh\"', () => {
  withTempHome(({ home }) => {
    migration.freshStart();
    const json = JSON.parse(fs.readFileSync(path.join(home, '.vibedeck', 'install.json'), 'utf8'));
    assert.strictEqual(json.mode, 'fresh');
    assert.ok(json.decided_at);
  });
});

test('detectAndPrompt is a no-op if install.json already records a decision', async () => {
  await withTempHome(async ({ home }) => {
    fs.mkdirSync(path.join(home, '.vibedeck'), { recursive: true });
    fs.writeFileSync(
      path.join(home, '.vibedeck', 'install.json'),
      `${JSON.stringify({ mode: 'fresh', decided_at: new Date().toISOString() }, null, 2)}\n`,
    );
    const ui = {
      info() {
        throw new Error('ui.info should not be called when already decided');
      },
      async select() {
        throw new Error('ui.select should not be called when already decided');
      },
    };
    const res = await migration.detectAndPrompt({ ui });
    assert.deepStrictEqual(res, { skipped: true, reason: 'already_decided' });
  });
});

