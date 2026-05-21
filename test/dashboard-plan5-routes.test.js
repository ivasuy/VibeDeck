const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('App routes Live to / and /dashboard, Usage to /usage, Branches, and hides Entire', () => {
  const app = fs.readFileSync('dashboard/src/App.jsx', 'utf8');
  assert.match(app, /LivePage/);
  assert.match(app, /isUsagePath/);
  assert.match(app, /BranchesPage/);
  assert.doesNotMatch(app, /EntirePage/);
  assert.match(app, /isEntirePath/);
  assert.match(app, /RemovedDashboardRouteRedirect/);
});

test('Sidebar preserves collapse storage and hides the paused Entire nav item', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /tt\.sidebarCollapsed/);
  assert.match(sidebar, /nav\.live/);
  assert.match(sidebar, /nav\.usage/);
  assert.match(sidebar, /nav\.branches/);
  assert.doesNotMatch(sidebar, /nav\.entire/);
});
