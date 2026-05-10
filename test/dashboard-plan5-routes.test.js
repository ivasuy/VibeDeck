const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('App routes Live to / and /dashboard, Usage to /usage, and includes Branches/Entire', () => {
  const app = fs.readFileSync('dashboard/src/App.jsx', 'utf8');
  assert.match(app, /LivePage/);
  assert.match(app, /isUsagePath/);
  assert.match(app, /BranchesPage/);
  assert.match(app, /EntirePage/);
});

test('Sidebar preserves collapse storage and adds Plan 5 nav items', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /tt\.sidebarCollapsed/);
  assert.match(sidebar, /nav\.live/);
  assert.match(sidebar, /nav\.usage/);
  assert.match(sidebar, /nav\.branches/);
  assert.match(sidebar, /nav\.entire/);
});
