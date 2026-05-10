const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('styles define VibeDeck brand tokens for light and dark themes', () => {
  const css = fs.readFileSync('dashboard/src/styles.css', 'utf8');
  assert.match(css, /--vd-accent/);
  assert.match(css, /--vd-accent-strong/);
  assert.match(css, /--vd-live/);
  assert.match(css, /--vd-branch/);
  assert.match(css, /--vd-warning/);
  assert.match(css, /--vd-danger/);
  assert.match(css, /:root\.dark[\s\S]*--vd-accent/);
  assert.match(css, /:root\.dark[\s\S]*--vd-accent-strong/);
  assert.match(css, /:root\.dark[\s\S]*--vd-live/);
  assert.match(css, /:root\.dark[\s\S]*--vd-branch/);
  assert.match(css, /:root\.dark[\s\S]*--vd-warning/);
  assert.match(css, /:root\.dark[\s\S]*--vd-danger/);
});

test('sidebar shows VibeDeck brand and preserves theme controls', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /copy\("brand\.name"\)/);
  assert.match(sidebar, /ThemePill/);
});
