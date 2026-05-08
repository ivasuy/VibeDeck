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

test('node engine still >=20', () => {
  assert.match(pkg.engines.node, /^>=20/);
});
