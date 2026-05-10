const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('styles define VibeDeck brand tokens for light and dark themes', () => {
  const css = fs.readFileSync('dashboard/src/styles.css', 'utf8');
  assert.match(css, /--vd-accent/);
  assert.match(css, /--vd-live/);
  assert.match(css, /:root\.dark[\s\S]*--vd-accent/);
});

test('sidebar shows VibeDeck brand and preserves theme controls', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /VibeDeck/);
  assert.match(sidebar, /ThemePill/);
});
