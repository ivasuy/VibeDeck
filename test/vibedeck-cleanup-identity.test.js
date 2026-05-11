const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  ".claude",
  ".dual-graph",
  "node_modules",
  "dashboard/node_modules",
  "dashboard/dist",
  "dist",
  "docs/superpowers",
  "VibeDeckMac/build",
  ".dual-graph-context",
]);

const TEXT_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".csv",
  ".html",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

const REMOVED_PATHS = [
  ".env.example",
  ".mailmap",
  "LICENSE",
  "Software Engineering Protocol.md",
  "software-engineering-protocol.skill",
  "dashboard/.env.example",
  "dashboard/.mcp.json",
  "dashboard/skills-lock.json",
  "skills-lock.json",
  "interaction_sequence.config.json",
  "skills/find-skills",
  "skills/public/frontend-ui-functional/SKILL.md",
  "scripts/acceptance/offline-replay.cjs",
  "scripts/ops/pricing-sync-health.sql",
  "BACKEND_API.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "copy.jsx",
  "dashboard/edge-patches",
  "dashboard/src/content/i18n/zh",
  "dashboard/src/lib/cloud-sync.ts",
  "dashboard/src/lib/cloud-sync-prefs.ts",
  "dashboard/src/lib/insforge-config.ts",
  "dashboard/src/hooks/use-cloud-usage-sync.ts",
  "dashboard/share.html",
  "dashboard/wrapped-2025.html",
  "dashboard/src/ui/marketing/MarketingLanding.jsx",
  "scripts/ops/rebuild-cloud-hourly.cjs",
  "scripts/ops/repair-cloud-from-queue.cjs",
  `scripts/ops/${["token", "tracker"].join("")}-hourly-device-dedup.sql`,
  "test/cloud-sync-prefs.test.js",
  "test/cloud-sync-rotation.test.js",
  "dashboard/src/lib/__tests__/api-public-visibility.test.ts",
];

const TOKEN_TRACKER_ALLOWLIST = [
  "src/lib/migration.js",
  "test/migration-detect.test.js",
  "test/local-api-skills.test.js",
  "test/local-api-project-usage-summary.test.js",
  "test/proxy-env.test.js",
  "test/runtime-config.test.js",
  "test/init-uninstall.test.js",
  "test/init-auth-token.test.js",
  "test/init-dry-run.test.js",
  "test/sync-openclaw-trigger.test.js",
  "test/notify-debug-log.test.js",
  "test/fixtures/init-spawn-error.cjs",
];

function toRepoPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join("/");
}

function shouldSkip(repoPath) {
  return [...SKIP_DIRS].some((dir) => repoPath === dir || repoPath.startsWith(`${dir}/`));
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const repoPath = toRepoPath(abs);
    if (shouldSkip(repoPath)) continue;
    if (entry.isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) out.push(abs);
  }
  return out;
}

test("repo-owned files contain no Chinese/CJK characters", () => {
  const cjk = /[\u3400-\u9fff]/u;
  const offenders = [];
  for (const abs of walk(ROOT)) {
    const text = fs.readFileSync(abs, "utf8");
    if (cjk.test(text)) offenders.push(toRepoPath(abs));
  }
  assert.deepEqual(offenders.sort(), []);
});

test("removed remote and stale OSS files are absent", () => {
  const existing = REMOVED_PATHS.filter((repoPath) => fs.existsSync(path.join(ROOT, repoPath)));
  assert.deepEqual(existing.sort(), []);
});

test("wrapped and annual poster surfaces stay removed", () => {
  const dashboardPage = fs.readFileSync(path.join(ROOT, "dashboard/src/pages/DashboardPage.jsx"), "utf8");
  assert.doesNotMatch(dashboardPage, /wrappedEntryLabel/);
  const removedName = ["Wrap", "ped"].join("");
  assert.doesNotMatch(dashboardPage, new RegExp(`show${removedName}Entry`));
  assert.doesNotMatch(dashboardPage, new RegExp(`${removedName} 2025`, "i"));

  const appSource = fs.readFileSync(path.join(ROOT, "dashboard/src/App.jsx"), "utf8");
  assert.doesNotMatch(appSource, /AnnualPosterPage/);
  assert.doesNotMatch(appSource, /poster/);
  assert.equal(fs.existsSync(path.join(ROOT, "dashboard/src/pages/AnnualPosterPage.jsx")), false);

  const copy = fs.readFileSync(path.join(ROOT, "dashboard/src/content/copy.csv"), "utf8");
  assert.doesNotMatch(copy, /dashboard\.wrapped\.entry/);
});

test("product-facing legacy product references are removed outside the compatibility allowlist", () => {
  const product = ["Token", "Tracker"].join("");
  const spacedProduct = ["Token", "Tracker"].join(" ");
  const slug = ["token", "tracker"].join("");
  const legacy = new RegExp(`${product}|${spacedProduct}|${slug}|${product}Bar`);
  const offenders = [];
  for (const abs of walk(ROOT)) {
    const repoPath = toRepoPath(abs);
    if (TOKEN_TRACKER_ALLOWLIST.includes(repoPath)) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (legacy.test(text)) offenders.push(repoPath);
  }
  assert.deepEqual(offenders.sort(), []);
});
