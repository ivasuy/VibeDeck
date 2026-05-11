const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const modulePath = pathToFileURL(path.resolve("dashboard/scripts/visual-baseline-config.js")).href;

test("baseline jobs use screenshot mode and dashboard mock data intentionally", async () => {
  const { createBaselineJobs } = await import(modulePath);
  const jobs = createBaselineJobs("http://localhost:5173");

  const appDesktop = jobs.find((job) => job.name === "app-desktop");
  const dashboardDesktop = jobs.find((job) => job.name === "dashboard-desktop");
  const dashboardMobile = jobs.find((job) => job.name === "dashboard-mobile");

  assert.ok(appDesktop, "app-desktop job exists");
  assert.ok(dashboardDesktop, "dashboard-desktop job exists");
  assert.ok(dashboardMobile, "dashboard-mobile job exists");

  assert.ok(appDesktop.url.includes("screenshot=1"));
  assert.ok(!appDesktop.url.includes("mock=1"));
  assert.ok(dashboardDesktop.url.includes("screenshot=1"));
  assert.ok(dashboardDesktop.url.includes("mock=1"));
  assert.ok(dashboardMobile.url.includes("screenshot=1"));
  assert.ok(dashboardMobile.url.includes("mock=1"));
});
