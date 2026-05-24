'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { cmdOptimize } = require('../src/commands/optimize');
const { run } = require('../src/cli');

test('optimize command writes JSON scan result for temp database', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-opt-cli-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  const prevDbPath = process.env.VIBEDECK_DB_PATH;
  const prevWrite = process.stdout.write;
  let out = '';
  try {
    ensureSchema(dbPath);
    process.env.VIBEDECK_DB_PATH = dbPath;
    process.stdout.write = (chunk, enc, cb) => {
      out += Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
      if (typeof cb === 'function') cb();
      return true;
    };

    const code = await cmdOptimize(['--scan', '--json']);

    assert.equal(code, 0);
    const body = JSON.parse(out);
    assert.equal(body.ok, true);
    assert.ok(body.run_id);
    assert.ok(body.health_grade);
  } finally {
    process.stdout.write = prevWrite;
    if (prevDbPath === undefined) delete process.env.VIBEDECK_DB_PATH;
    else process.env.VIBEDECK_DB_PATH = prevDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cli registers optimize command and help text', async () => {
  const prevWrite = process.stdout.write;
  let out = '';
  try {
    process.stdout.write = (chunk, enc, cb) => {
      out += Buffer.isBuffer(chunk) ? chunk.toString(enc || 'utf8') : String(chunk);
      if (typeof cb === 'function') cb();
      return true;
    };

    await run(['--help']);
  } finally {
    process.stdout.write = prevWrite;
  }

  assert.match(out, /npx vibedeck-cli \[--debug\] optimize \[--scan\] \[--json\]/);
});
