const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

test('package is named vibedeck-cli', () => {
  assert.strictEqual(pkg.name, 'vibedeck-cli');
});

test('bin exposes vibedeck command', () => {
  assert.ok(pkg.bin && typeof pkg.bin === 'object', 'bin must be an object');
  assert.ok('vibedeck' in pkg.bin, 'bin.vibedeck must exist');
});

test('node engine is >=22.5 (node:sqlite)', () => {
  assert.match(pkg.engines.node, /^>=22\.5/);
});
