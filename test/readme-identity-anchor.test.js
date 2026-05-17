const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const readme = readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

test('README opens with the Phase 1 identity anchor', () => {
  const opening = readme.slice(0, 1000);

  assert.match(opening, /VibeDeck shows you what every AI coding tool on your machine is burning/i);
  assert.match(opening, /Local-first/i);
  assert.match(opening, /multi-provider/i);
  assert.match(opening, /Mac-native/i);
  assert.match(opening, /branch-aware/i);
});

test('README does not lead with old broad product clutter', () => {
  const opening = readme.slice(0, 2000);

  assert.doesNotMatch(opening, /engineering teams one place/i);
  assert.doesNotMatch(opening, /skills/i);
  assert.doesNotMatch(opening, /checkpoints/i);
  assert.doesNotMatch(opening, /optimize/i);
  assert.doesNotMatch(opening, /yield/i);
  assert.doesNotMatch(opening, /every dollar is exact/i);
});
