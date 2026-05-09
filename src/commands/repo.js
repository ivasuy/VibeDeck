'use strict';
const path = require('node:path');
const os = require('node:os');
const { DatabaseSync } = require('node:sqlite');

function _dbPath() {
  const home = process.env.VIBEDECK_HOME || os.homedir();
  return path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
}

function migrateRepoPath(dbPath, { from, to }) {
  if (!path.isAbsolute(from) || !path.isAbsolute(to)) {
    throw new Error('repo migrate: both paths must be absolute');
  }
  const db = new DatabaseSync(dbPath);
  let updates = 0;
  try {
    db.exec('BEGIN');
    const stmts = [
      'UPDATE vibedeck_sessions SET repo_root = ? WHERE repo_root = ?',
      'UPDATE vibedeck_repos SET repo_root = ? WHERE repo_root = ?',
      'UPDATE vibedeck_head_history SET repo_root = ? WHERE repo_root = ?',
    ];
    for (const sql of stmts) {
      const r = db.prepare(sql).run(to, from);
      updates += Number(r.changes || 0);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.close();
  }
  return { rowsUpdated: updates };
}

async function run(argv = []) {
  const [sub, ...rest] = argv;
  if (sub !== 'migrate') {
    process.stderr.write('Usage: vibedeck repo migrate <old-path> <new-path>\n');
    return 1;
  }
  const [from, to] = rest;
  if (!from || !to) {
    process.stderr.write('Usage: vibedeck repo migrate <old-path> <new-path>\n');
    return 1;
  }
  try {
    const result = migrateRepoPath(_dbPath(), { from, to });
    process.stdout.write(`Updated ${result.rowsUpdated} row(s).\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    return 1;
  }
}

module.exports = { run, migrateRepoPath };

