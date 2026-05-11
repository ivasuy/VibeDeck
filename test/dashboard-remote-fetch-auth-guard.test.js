const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");
const hookFiles = [
  "dashboard/src/hooks/use-usage-data.ts",
  "dashboard/src/hooks/use-usage-model-breakdown.ts",
  "dashboard/src/hooks/use-trend-data.ts",
  "dashboard/src/hooks/use-activity-heatmap.ts",
  "dashboard/src/hooks/use-project-usage-summary.ts",
];

async function readHookSource(relativePath) {
  const absPath = path.join(repoRoot, relativePath);
  return fs.readFile(absPath, "utf8");
}

function assertMissingJwtGuard(source, file) {
  const guardRegex =
    /if\s*\(\s*!resolvedToken\s*&&\s*!mockEnabled\s*&&\s*!isLocalMode\s*\)\s*(?:return|\{[\s\S]{0,240}?return)/;
  assert.ok(
    guardRegex.test(source),
    `expected remote auth guard in ${file} ("if (!resolvedToken && !mockEnabled && !isLocalMode) return;")`,
  );
}

test("remote dashboard data hooks do not fetch without auth unless local mode or mock mode is active", async () => {
  for (const file of hookFiles) {
    const source = await readHookSource(file);
    assertMissingJwtGuard(source, file);
  }
});
