'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { initSchema, registerMigration, runPendingMigrations } = require('./schema');

const m001 = require('./migrations/001-vibedeck-sessions');
const m002 = require('./migrations/002-session-buckets-and-windows');
const m003 = require('./migrations/003-entire-links-and-repos');
const m004 = require('./migrations/004-skills-and-head-history');
const m005 = require('./migrations/005-attribution-overrides');
const m006 = require('./migrations/006-session-token-buckets');
const m007 = require('./migrations/007-known-repo-suppression');
const m008 = require('./migrations/008-session-event-ledger');
const m009 = require('./migrations/009-session-bucket-facts');
const m010 = require('./migrations/010-entire-checkpoint-matches');

let registered = false;
function registerAll() {
  if (registered) return;
  registerMigration(m001);
  registerMigration(m002);
  registerMigration(m003);
  registerMigration(m004);
  registerMigration(m005);
  registerMigration(m006);
  registerMigration(m007);
  registerMigration(m008);
  registerMigration(m009);
  registerMigration(m010);
  registered = true;
}

function ensureSchema(dbPath) {
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new TypeError('ensureSchema: dbPath must be a non-empty string');
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  initSchema(dbPath);
  registerAll();
  runPendingMigrations(dbPath);
}

module.exports = { ensureSchema };
