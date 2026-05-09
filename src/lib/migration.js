'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function _ttDataDir() {
  return path.join(os.homedir(), '.tokentracker');
}

function _vdDataDir() {
  return path.join(process.env.VIBEDECK_HOME || os.homedir(), '.vibedeck');
}

function _installJsonPath() {
  return path.join(_vdDataDir(), 'install.json');
}

function detectTokenTrackerInstall() {
  const dataDir = _ttDataDir();
  if (!fs.existsSync(dataDir)) return null;
  const candidates = [
    path.join(dataDir, 'tracker', 'tokentracker.sqlite3'),
    path.join(dataDir, 'db.sqlite'),
  ];
  const dbPath = candidates.find((p) => fs.existsSync(p)) || null;
  return { dataDir, dbPath, hasDb: !!dbPath };
}

function readInstallDecision() {
  try {
    return JSON.parse(fs.readFileSync(_installJsonPath(), 'utf8'));
  } catch {
    return null;
  }
}

function _writeInstallDecision(decision) {
  fs.mkdirSync(_vdDataDir(), { recursive: true });
  fs.writeFileSync(
    _installJsonPath(),
    `${JSON.stringify({ ...decision, decided_at: new Date().toISOString() }, null, 2)}\n`,
  );
}

function migrateFromTokenTracker(detection) {
  if (!detection || !detection.hasDb) throw new Error('migrateFromTokenTracker: no source DB');
  const { ensureSchema } = require('./db');
  const targetDir = path.join(_vdDataDir(), 'tracker');
  fs.mkdirSync(targetDir, { recursive: true });
  const target = path.join(targetDir, 'vibedeck.sqlite3');
  fs.copyFileSync(detection.dbPath, target);
  ensureSchema(target);
  _writeInstallDecision({ mode: 'migrate', source_db: detection.dbPath, target_db: target });
  return { target_db: target };
}

function freshStart() {
  _writeInstallDecision({ mode: 'fresh' });
}

function coexistDecision() {
  _writeInstallDecision({ mode: 'coexist' });
}

async function detectAndPrompt({ ui }) {
  if (readInstallDecision()) return { skipped: true, reason: 'already_decided' };
  const det = detectTokenTrackerInstall();
  if (!det) {
    _writeInstallDecision({ mode: 'fresh', reason: 'no_tokentracker' });
    return { skipped: true, reason: 'no_tokentracker' };
  }
  ui.info(`Detected existing TokenTracker install at ${det.dataDir}.`);
  const choice = await ui.select('How should VibeDeck handle this?', [
    { value: 'migrate', label: 'Migrate (copy data into ~/.vibedeck — old install untouched)' },
    { value: 'fresh', label: 'Fresh start (ignore old data)' },
    { value: 'coexist', label: 'Coexist (run side-by-side on different ports / data dirs)' },
  ]);
  if (choice === 'migrate') return migrateFromTokenTracker(det);
  if (choice === 'fresh') {
    freshStart();
    return { mode: 'fresh' };
  }
  coexistDecision();
  return { mode: 'coexist' };
}

module.exports = {
  detectTokenTrackerInstall,
  readInstallDecision,
  migrateFromTokenTracker,
  freshStart,
  coexistDecision,
  detectAndPrompt,
};

