const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');

test('App routes Live to / and /dashboard, Usage to /usage, Branches, and has no Entire page route', () => {
  const app = fs.readFileSync('dashboard/src/App.jsx', 'utf8');
  assert.match(app, /LivePage/);
  assert.match(app, /isUsagePath/);
  assert.match(app, /BranchesPage/);
  assert.doesNotMatch(app, /EntirePage/);
  assert.doesNotMatch(app, /isEntirePath/);
  assert.doesNotMatch(app, /RemovedDashboardRouteRedirect/);
});

test('Sidebar preserves collapse storage and has no Entire nav item', () => {
  const sidebar = fs.readFileSync('dashboard/src/ui/openai/components/Sidebar.jsx', 'utf8');
  assert.match(sidebar, /tt\.sidebarCollapsed/);
  assert.match(sidebar, /id: "live"/);
  assert.match(sidebar, /to: "\/live"/);
  assert.match(sidebar, /nav\.branches/);
  assert.match(sidebar, /nav\.optimize/);
  assert.doesNotMatch(sidebar, /nav\.entire/);
});
