const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");

test("existing DashboardPage still imports core analytics components", () => {
  const page = fs.readFileSync("dashboard/src/pages/DashboardPage.jsx", "utf8");
  assert.match(page, /useActivityHeatmap/);
  assert.match(page, /useTrendData/);
  assert.match(page, /useUsageModelBreakdown/);
  assert.match(page, /DashboardView/);
});

test("DashboardView still renders UsageOverview, DataDetails, TrendMonitor path", () => {
  const view = fs.readFileSync("dashboard/src/ui/matrix-a/views/DashboardView.jsx", "utf8");
  assert.match(view, /UsageOverview/);
  assert.match(view, /DataDetails/);
  assert.match(view, /TrendMonitor/);
});

test("App routes /usage to DashboardPage and keeps / and /dashboard on LivePage", () => {
  const app = fs.readFileSync("dashboard/src/App.jsx", "utf8");
  assert.match(app, /const isLivePath = normalizedPath === "\/" \|\| normalizedPath === "\/dashboard";/);
  assert.match(app, /const isUsagePath = normalizedPath === "\/usage";/);
  assert.match(app, /let PageComponent = LivePage;/);
  assert.match(app, /if \(isUsagePath\) {\s*PageComponent = DashboardPage;\s*}/s);
});
