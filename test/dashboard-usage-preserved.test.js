const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

test("existing DashboardPage still imports core analytics components", () => {
  const page = fs.readFileSync("dashboard/src/pages/DashboardPage.jsx", "utf8");
  assert.match(page, /useTrendData/);
  assert.match(page, /useUsageModelBreakdown/);
  assert.match(page, /useVibeDeckLiveSessions/);
  assert.match(page, /DashboardView/);
});

test("DashboardView still renders summary, provider breakdown, and recent activity paths", () => {
  const view = fs.readFileSync("dashboard/src/ui/matrix-a/views/DashboardView.jsx", "utf8");
  assert.match(view, /SparklineBars/);
  assert.match(view, /ProviderBreakdown/);
  assert.match(view, /RecentActivity/);
});

test("App routes dashboard and usage paths to DashboardPage and keeps live sessions on /live", () => {
  const app = fs.readFileSync("dashboard/src/App.jsx", "utf8");
  assert.match(app, /const isDashboardPath = normalizedPath === "\/" \|\| normalizedPath === "\/dashboard";/);
  assert.match(app, /const isLivePath = normalizedPath === "\/live";/);
  assert.match(app, /const isUsagePath = normalizedPath === "\/usage";/);
  assert.match(app, /let PageComponent = DashboardPage;/);
  assert.match(app, /if \(isRemovedLimitsPath\) {\s*PageComponent = RemovedLimitsRedirect;\s*} else if \(isDashboardPath \|\| isUsagePath\) {\s*PageComponent = DashboardPage;\s*} else if \(isLivePath\) {\s*PageComponent = LivePage;\s*}/s);
});
