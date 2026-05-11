# VibeDeck Cleanup Stabilization Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the cleanup safely from the current worktree state, keeping already-deleted stale files deleted, removing or updating the remaining stale scripts/tests, and restoring a trustworthy green verification baseline.

**Architecture:** Treat this as a stabilization pass, not a product refactor. Do not bring back deleted config, skills, lock, protocol, or stale acceptance files; instead update metadata, guardrails, scripts, and tests to match the current local-first VibeDeck shape. Keep parser, pricing, provider hook, session attribution, DB migration, Entire, and live-workstream tests unless a test is only guarding a removed surface.

**Tech Stack:** Node.js >=22.5, `node --test`, Vite/Vitest dashboard tests, shell scripts, package metadata, local SQLite via `node:sqlite`.

---

## Current State Assumptions

The following files are already deleted in the worktree and must not be restored by this cleanup:

- `.env.example`
- `.mailmap`
- `LICENSE`
- `Software Engineering Protocol.md`
- `software-engineering-protocol.skill`
- `dashboard/.env.example`
- `dashboard/.mcp.json`
- `dashboard/skills-lock.json`
- `skills-lock.json`
- `interaction_sequence.config.json`
- `skills/**`
- `scripts/acceptance/offline-replay.cjs`
- `scripts/ops/pricing-sync-health.sql`

If any task below discovers one of these files exists again, stop and inspect the worktree before proceeding. The correct direction is to update references and guardrails to match deletion, not to recreate the stale artifact.

## File Structure

### Metadata And Packaging

- Modify: `package.json`
  - Remove `LICENSE` from `files` because the file is deleted.
  - Decide package publish posture explicitly: either keep `license: "MIT"` only if a replacement license notice is intentionally kept elsewhere, or mark the package private/internal if this is no longer intended for public npm.
- Modify: `test/npm-publish-workflow.test.js`
  - Update package-file expectations so they do not require deleted `LICENSE`.
- Modify: `test/vibedeck-package-identity.test.js`
  - Align identity assertions with the current metadata decision.
- Modify: `test/vibedeck-cleanup-identity.test.js`
  - Add deleted files to the cleanup guard so they stay gone.
  - Remove deleted test paths only if the tests themselves are deleted later in this plan.

### Script Cleanup

- Modify/Delete: `scripts/acceptance/backend-probe-cadence.cjs`
  - Current script is broken because it imports `dashboard/src/lib/backend-probe-scheduler.js`, while the source is `dashboard/src/lib/backend-probe-scheduler.ts`.
  - Preferred: remove the script from acceptance if backend probe cadence is no longer a product acceptance concern.
  - Alternative: convert it to import built output or run through the dashboard test suite.
- Modify/Delete: `scripts/acceptance/usage-rollup-backfill-utc.cjs`
  - This depends on deleted/stale cloud SQL concepts.
  - Preferred: delete with the daily-rollup SQL files if cloud rollups are gone.
- Modify/Delete: `scripts/ops/usage-daily-rollup.sql`
- Modify/Delete: `scripts/ops/usage-daily-rollup-backfill.sql`
- Modify/Delete: `scripts/ops/usage-daily-rollup-rollback.sql`
  - Delete if no local VibeDeck runtime uses `public.vibeusage_tracker_daily_rollup`.
- Modify/Delete: `scripts/copy-sync.cjs`
  - Delete if copy registry sync to a remote/source repo is no longer used.
- Modify/Delete: `scripts/dev-bin-shim.cjs`
  - Delete if no package/test/workflow references remain.
- Modify/Delete: `scripts/open-dashboard.sh`
- Modify/Delete: `scripts/open-proposal-worktrees.sh`
- Modify/Delete: `scripts/open-proposal-worktrees.command`
  - Delete if they are personal helpers rather than project-supported tooling.
- Keep: `scripts/graph/**`, `scripts/ops/validate-ui-hardcode*`, `scripts/ops/pr-retro.cjs`, `scripts/ops/billable-total-tokens-migration.sql`, `scripts/audit-token-correctness.cjs`, `scripts/validate-architecture-guardrails.cjs`, `scripts/validate-retros.cjs`, `scripts/validate-copy-registry.cjs` until explicitly replaced.

### Test Cleanup

- Delete: `test/auth-gate.test.js`
- Delete: `dashboard/src/lib/auth-gate.js`
  - The app now runs local-first and `App.jsx` no longer imports this gate.
- Modify/Delete: `test/wrapped-entry.test.js`
  - Fold its useful assertions into `test/vibedeck-cleanup-identity.test.js`, then delete the standalone duplicate test.
- Modify: `test/visual-baseline-config.test.js`
- Modify: `dashboard/scripts/visual-baseline-config.js`
  - Rename stale `landing-desktop` baseline job to an app/live/dashboard job.
- Modify: `test/init-dry-run.test.js`
  - Replace stale `vibeusage-tracker.js` expectation with current `vibedeck.js` OpenCode plugin filename.
- Modify: `test/validate-retros.test.js`
  - Replace fixture repo names from `vibeusage` to `vibedeck`.
- Modify/Rename: `test/dashboard-missing-jwt-guard.test.js`
  - Rename intent to remote fetch auth guard if this is still required.
  - Include newer hooks such as `dashboard/src/hooks/use-project-usage-summary.ts`.
- Modify: `test/entire-bridge-git-read.test.js`
  - Update stale assertion to the richer checkpoint inspector payload.
- Modify: `test/local-api-vibedeck-sessions-live-snapshot.test.js`
  - Update expected recent-ended session semantics if the product intentionally includes recent stale/completed sessions in live snapshots.
- Modify: `test/serve-session-pipeline.test.js`
  - Fix the SSE pipeline test by making it deterministic around sync, server readiness, and event observation.

---

## Task 1: Freeze The Current Deletion Set In Cleanup Guardrails

**Files:**
- Modify: `test/vibedeck-cleanup-identity.test.js`
- Test: `test/vibedeck-cleanup-identity.test.js`

- [ ] **Step 1: Inspect the current deleted-file guard**

Run:

```bash
sed -n '1,150p' test/vibedeck-cleanup-identity.test.js
```

Expected: PASS command output. Confirm `REMOVED_PATHS` exists and currently includes old cloud/share paths.

- [ ] **Step 2: Add the already-deleted files to `REMOVED_PATHS`**

In `test/vibedeck-cleanup-identity.test.js`, update `REMOVED_PATHS` to include these exact entries:

```js
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
```

Do not add every nested `skills/public/frontend-ui-functional/**` file one by one unless the test needs exact-file coverage; guarding the directory root is enough if `fs.existsSync("skills/public/frontend-ui-functional/SKILL.md")` fails when the deleted skill pack is gone.

- [ ] **Step 3: Run the cleanup identity test**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: PASS. If it fails on `LICENSE`, `.env.example`, or `skills/**`, inspect `git status --short` and confirm those files were not reintroduced.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add test/vibedeck-cleanup-identity.test.js
rtk git commit -m "test: guard deleted cleanup artifacts"
```

Expected: commit succeeds.

---

## Task 2: Align Package Metadata With Deleted License File

**Files:**
- Modify: `package.json`
- Modify: `test/npm-publish-workflow.test.js`
- Modify: `test/vibedeck-package-identity.test.js`
- Test: `test/npm-publish-workflow.test.js`
- Test: `test/vibedeck-package-identity.test.js`

- [ ] **Step 1: Confirm package currently references deleted `LICENSE`**

Run:

```bash
sed -n '1,90p' package.json
```

Expected: output shows `"LICENSE"` inside `files`.

- [ ] **Step 2: Remove `LICENSE` from package files**

In `package.json`, change:

```json
"files": [
  "bin/",
  "src/",
  "dashboard/dist/",
  "README.md",
  "LICENSE",
  "package.json"
]
```

to:

```json
"files": [
  "bin/",
  "src/",
  "dashboard/dist/",
  "README.md",
  "package.json"
]
```

Do not recreate `LICENSE`.

- [ ] **Step 3: Decide public/private metadata in code**

If this package is no longer meant for public npm, add:

```json
"private": true,
"license": "UNLICENSED"
```

If it is still meant for public npm, keep:

```json
"license": "MIT"
```

but add a short note in `README.md` only if the project still needs an explicit license notice. Do not recreate `LICENSE` in this plan.

- [ ] **Step 4: Update tests that require `LICENSE`**

Search:

```bash
rg -n "LICENSE|license|files array" test/npm-publish-workflow.test.js test/vibedeck-package-identity.test.js
```

Update assertions so they match the metadata decision:

```js
assert.ok(pkg.files.includes("dashboard/dist/"));
assert.ok(pkg.files.includes("README.md"));
assert.ok(!pkg.files.includes("LICENSE"));
```

If using private/internal metadata, assert:

```js
assert.equal(pkg.private, true);
assert.equal(pkg.license, "UNLICENSED");
```

If keeping public MIT metadata, assert:

```js
assert.equal(pkg.license, "MIT");
```

- [ ] **Step 5: Verify npm pack no longer tries to include missing `LICENSE`**

Run:

```bash
env npm_config_cache=/private/tmp/vibedeck-npm-cache npm pack --dry-run --json
```

Expected: PASS and no `LICENSE` entry in returned `files`.

- [ ] **Step 6: Run metadata tests**

Run:

```bash
rtk node --test test/npm-publish-workflow.test.js test/vibedeck-package-identity.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add package.json test/npm-publish-workflow.test.js test/vibedeck-package-identity.test.js
rtk git commit -m "chore: align package metadata with cleanup"
```

Expected: commit succeeds.

---

## Task 3: Remove Obsolete Auth Gate Test And Module

**Files:**
- Delete: `test/auth-gate.test.js`
- Delete: `dashboard/src/lib/auth-gate.js`
- Test: `test/app-route-pathname-guard.test.js`
- Test: dashboard build/test

- [ ] **Step 1: Prove the module is not imported by runtime code**

Run:

```bash
rg -n "auth-gate|resolveAuthGate" dashboard/src src test --glob '!node_modules/**'
```

Expected before deletion: only `dashboard/src/lib/auth-gate.js` and `test/auth-gate.test.js` appear.

- [ ] **Step 2: Delete the obsolete files**

Run only after Step 1 confirms no runtime imports:

```bash
rm test/auth-gate.test.js dashboard/src/lib/auth-gate.js
```

Expected: files removed from worktree. Do not remove `dashboard/src/lib/auth-token.js`; that file is still used.

- [ ] **Step 3: Re-run the import search**

Run:

```bash
rg -n "auth-gate|resolveAuthGate" dashboard/src src test --glob '!node_modules/**'
```

Expected: no matches.

- [ ] **Step 4: Run focused checks**

Run:

```bash
rtk node --test test/app-route-pathname-guard.test.js
rtk npm --prefix dashboard run test -- --run src/lib/__tests__/auth-token.test.ts
```

Expected: both pass.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add -u test/auth-gate.test.js dashboard/src/lib/auth-gate.js
rtk git commit -m "test: remove obsolete auth gate coverage"
```

Expected: commit succeeds.

---

## Task 4: Fold Wrapped Removal Guard Into Cleanup Identity

**Files:**
- Modify: `test/vibedeck-cleanup-identity.test.js`
- Delete: `test/wrapped-entry.test.js`
- Test: `test/vibedeck-cleanup-identity.test.js`

- [ ] **Step 1: Copy the remaining wrapped assertions into cleanup identity**

Add this test to `test/vibedeck-cleanup-identity.test.js`:

```js
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
```

- [ ] **Step 2: Delete duplicate standalone test**

Run:

```bash
rm test/wrapped-entry.test.js
```

Expected: file deleted.

- [ ] **Step 3: Run focused cleanup guard**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add test/vibedeck-cleanup-identity.test.js
rtk git add -u test/wrapped-entry.test.js
rtk git commit -m "test: consolidate removed surface guardrails"
```

Expected: commit succeeds.

---

## Task 5: Rename Visual Baseline Jobs Away From Landing

**Files:**
- Modify: `dashboard/scripts/visual-baseline-config.js`
- Modify: `test/visual-baseline-config.test.js`
- Test: `test/visual-baseline-config.test.js`
- Test: `test/visual-baselines.test.js`

- [ ] **Step 1: Update baseline config job names**

In `dashboard/scripts/visual-baseline-config.js`, replace:

```js
const landingParams = "screenshot=1";
```

with:

```js
const appParams = "screenshot=1";
```

Replace this job:

```js
{
  name: "landing-desktop",
  url: `${baseUrl}/?${landingParams}`,
  width: 1440,
  height: 900,
  dpr: 2,
},
```

with:

```js
{
  name: "app-desktop",
  url: `${baseUrl}/?${appParams}`,
  width: 1440,
  height: 900,
  dpr: 2,
},
```

- [ ] **Step 2: Update the test**

In `test/visual-baseline-config.test.js`, replace:

```js
test("baseline jobs use screenshot for landing and mock for dashboard", async () => {
```

with:

```js
test("baseline jobs use screenshot mode and dashboard mock data intentionally", async () => {
```

Replace:

```js
const landing = jobs.find((job) => job.name === "landing-desktop");
```

with:

```js
const appDesktop = jobs.find((job) => job.name === "app-desktop");
```

Replace `landing` assertions with:

```js
assert.ok(appDesktop, "app-desktop job exists");
assert.ok(appDesktop.url.includes("screenshot=1"));
assert.ok(!appDesktop.url.includes("mock=1"));
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
rtk node --test test/visual-baseline-config.test.js test/visual-baselines.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add dashboard/scripts/visual-baseline-config.js test/visual-baseline-config.test.js
rtk git commit -m "test: rename visual baseline app job"
```

Expected: commit succeeds.

---

## Task 6: Fix Remaining Stale Test Fixtures And Names

**Files:**
- Modify: `test/init-dry-run.test.js`
- Modify: `test/validate-retros.test.js`
- Modify/Rename: `test/dashboard-missing-jwt-guard.test.js`
- Test: listed files

- [ ] **Step 1: Update OpenCode dry-run plugin expectation**

In `test/init-dry-run.test.js`, replace:

```js
"vibeusage-tracker.js",
```

with:

```js
"vibedeck.js",
```

Leave `TOKENTRACKER_DEVICE_TOKEN` compatibility assertions only if the implementation still reads that env var. If the implementation no longer reads it, replace the variable cleanup with `VIBEDECK_DEVICE_TOKEN`.

- [ ] **Step 2: Update retro validator fixtures**

In `test/validate-retros.test.js`, replace fixture-only `vibeusage` repo paths with `vibedeck`:

```js
const text = `---\nrepo: vibedeck\nlayer: backend\nreusable_for:\n  - ingest\n  - sync\n---\n\n# Title\n`;
assert.equal(fm.repo, "vibedeck");
```

And replace path examples:

```js
`# idx\n- path: \`vibedeck/2026-02-14-openclaw-ingest-gap.md\`\n`
```

Use `path.join(retroRoot, "vibedeck", ...)` for the generated files.

- [ ] **Step 3: Rename missing-JWT test to local/remote auth guard**

Rename:

```bash
mv test/dashboard-missing-jwt-guard.test.js test/dashboard-remote-fetch-auth-guard.test.js
```

Update the title:

```js
test("remote dashboard data hooks do not fetch without auth unless local mode or mock mode is active", async () => {
```

Add `dashboard/src/hooks/use-project-usage-summary.ts` to the `hookFiles` list:

```js
const hookFiles = [
  "dashboard/src/hooks/use-usage-data.ts",
  "dashboard/src/hooks/use-usage-model-breakdown.ts",
  "dashboard/src/hooks/use-trend-data.ts",
  "dashboard/src/hooks/use-activity-heatmap.ts",
  "dashboard/src/hooks/use-project-usage-summary.ts",
];
```

Update the regex if needed so all listed hooks pass:

```js
const guardRegex = /if\s*\(\s*!resolvedToken\s*&&\s*!mockEnabled\s*&&\s*!isLocalMode\s*\)\s*\{?\s*return/;
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
rtk node --test test/init-dry-run.test.js test/validate-retros.test.js test/dashboard-remote-fetch-auth-guard.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add test/init-dry-run.test.js test/validate-retros.test.js test/dashboard-remote-fetch-auth-guard.test.js
rtk git add -u test/dashboard-missing-jwt-guard.test.js
rtk git commit -m "test: refresh stale cleanup-era fixtures"
```

Expected: commit succeeds.

---

## Task 7: Remove Or Fix Broken Acceptance Scripts

**Files:**
- Delete or Modify: `scripts/acceptance/backend-probe-cadence.cjs`
- Delete or Modify: `scripts/acceptance/usage-rollup-backfill-utc.cjs`
- Modify: `scripts/acceptance/run-acceptance.cjs`
- Possibly Delete: `scripts/ops/usage-daily-rollup.sql`
- Possibly Delete: `scripts/ops/usage-daily-rollup-backfill.sql`
- Possibly Delete: `scripts/ops/usage-daily-rollup-rollback.sql`

- [ ] **Step 1: Run acceptance list**

Run:

```bash
rtk node scripts/acceptance/run-acceptance.cjs --list
```

Expected before cleanup: list includes `backend-probe-cadence` and `usage-rollup-backfill-utc`.

- [ ] **Step 2: Delete backend probe cadence acceptance if unsupported**

If no current npm script or CI workflow uses this acceptance case, delete:

```bash
rm scripts/acceptance/backend-probe-cadence.cjs
```

If keeping it, replace its import of:

```js
const modulePath = path.resolve(__dirname, "../../dashboard/src/lib/backend-probe-scheduler.js");
```

with a supported JS entry. Do not point Node directly at a `.ts` source unless the script also registers a TypeScript loader.

- [ ] **Step 3: Delete cloud daily rollup acceptance and SQL if cloud rollups are gone**

If `rg -n "vibeusage_tracker_daily_rollup|usage-daily-rollup" src dashboard/src test scripts --glob '!node_modules/**'` only returns these acceptance/SQL files, delete:

```bash
rm scripts/acceptance/usage-rollup-backfill-utc.cjs
rm scripts/ops/usage-daily-rollup.sql
rm scripts/ops/usage-daily-rollup-backfill.sql
rm scripts/ops/usage-daily-rollup-rollback.sql
```

- [ ] **Step 4: Re-run acceptance list**

Run:

```bash
rtk node scripts/acceptance/run-acceptance.cjs --list
```

Expected: remaining entries only include acceptance scripts that can run against current VibeDeck.

- [ ] **Step 5: Run remaining lightweight acceptance scripts**

Run:

```bash
rtk node scripts/acceptance/gemini-hook-install.cjs
rtk node scripts/acceptance/opencode-plugin-install.cjs
rtk node scripts/acceptance/npm-install-smoke.cjs
```

Expected: PASS. If `npm-install-smoke` still contains stale `tokentracker` or `vibeusage` naming, update the script to assert `vibedeck-cli`, `vibedeck`, and `~/.vibedeck`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add -u scripts/acceptance scripts/ops
rtk git commit -m "chore: remove stale acceptance scripts"
```

Expected: commit succeeds.

---

## Task 8: Remove Unreferenced Developer Helper Scripts

**Files:**
- Delete or Keep with docs: `scripts/copy-sync.cjs`
- Delete or Keep with docs: `scripts/dev-bin-shim.cjs`
- Delete or Keep with docs: `scripts/open-dashboard.sh`
- Delete or Keep with docs: `scripts/open-proposal-worktrees.sh`
- Delete or Keep with docs: `scripts/open-proposal-worktrees.command`

- [ ] **Step 1: Search references**

Run:

```bash
rg -n "copy-sync|dev-bin-shim|open-dashboard|open-proposal-worktrees" . --glob '!node_modules/**' --glob '!dashboard/node_modules/**' --glob '!dashboard/dist/**'
```

Expected: only the scripts themselves and optional docs/comments appear.

- [ ] **Step 2: Delete unreferenced personal helpers**

If Step 1 confirms no package/test/workflow references, delete:

```bash
rm scripts/copy-sync.cjs scripts/dev-bin-shim.cjs scripts/open-dashboard.sh scripts/open-proposal-worktrees.sh scripts/open-proposal-worktrees.command
```

If any script is intentionally supported, keep it and add a single package script or README mention so future audits do not classify it as orphaned.

- [ ] **Step 3: Run script reference guard**

Run:

```bash
rg -n "copy-sync|dev-bin-shim|open-dashboard|open-proposal-worktrees" . --glob '!node_modules/**' --glob '!dashboard/node_modules/**' --glob '!dashboard/dist/**'
```

Expected if deleted: no matches except possibly historical docs under `docs/superpowers`. Historical docs are acceptable.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add -u scripts
rtk git commit -m "chore: remove unreferenced developer helpers"
```

Expected: commit succeeds.

---

## Task 9: Fix Entire Checkpoint Read Test For Rich Inspector Payload

**Files:**
- Modify: `test/entire-bridge-git-read.test.js`
- Test: `test/entire-bridge-git-read.test.js`

- [ ] **Step 1: Inspect current failing assertion**

Run:

```bash
sed -n '1,90p' test/entire-bridge-git-read.test.js
```

Expected: test asserts `deepEqual(read, { ok: true, n: 1 })`.

- [ ] **Step 2: Update assertion to current API shape**

Replace the stale assertion with:

```js
assert.equal(read.path, "checkpoints/synth.json");
assert.equal(read.file_name, "synth.json");
assert.equal(read.kind, "json");
assert.equal(read.parse_error, null);
assert.deepEqual(read.parsed, { ok: true, n: 1 });
assert.equal(read.raw, '{"ok":true,"n":1}');
assert.equal(read.line_count, 1);
assert.equal(read.size_bytes, 17);
```

- [ ] **Step 3: Run focused test**

Run:

```bash
rtk node --test test/entire-bridge-git-read.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add test/entire-bridge-git-read.test.js
rtk git commit -m "test: align checkpoint git read payload"
```

Expected: commit succeeds.

---

## Task 10: Fix Live Snapshot Test For Workstream Recent-Ended Semantics

**Files:**
- Modify: `test/local-api-vibedeck-sessions-live-snapshot.test.js`
- Possibly Modify: `src/lib/local-api.js` only if the test exposes a real product bug
- Test: `test/local-api-vibedeck-sessions-live-snapshot.test.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Inspect current expected `ended_at` assertion**

Run:

```bash
sed -n '1,130p' test/local-api-vibedeck-sessions-live-snapshot.test.js
```

Expected: test asserts `ended_at === null` for a row that the implementation now treats as recently ended/stale.

- [ ] **Step 2: Decide intended product behavior**

Use this rule:

```text
Live raw sessions should include active sessions and recently completed sessions only when they are part of a live workstream summary.
Top-level "active" counts should not count recently completed sessions as active.
Recently completed sessions should expose ended_at and contribute to recently_completed_count/stale count.
```

If implementation matches this rule, update the test. If implementation shows ended sessions as active, fix `src/lib/local-api.js`.

- [ ] **Step 3: Update test assertions**

Use assertions like:

```js
assert.ok(body.sessions.some((session) => session.ended_at === null));
assert.ok(body.sessions.some((session) => typeof session.ended_at === "string"));

const stream = body.workstreams.find((item) => item.repo_root === repoRoot);
assert.ok(stream);
assert.equal(stream.active_session_count, 1);
assert.equal(stream.recently_completed_count, 1);
assert.ok(stream.sessions.some((session) => session.ended_at === null));
assert.ok(stream.sessions.some((session) => typeof session.ended_at === "string"));
```

- [ ] **Step 4: Run live snapshot tests**

Run:

```bash
rtk node --test test/local-api-vibedeck-sessions-live-snapshot.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add test/local-api-vibedeck-sessions-live-snapshot.test.js src/lib/local-api.js
rtk git commit -m "test: align live snapshot recent session semantics"
```

Expected: commit succeeds. If `src/lib/local-api.js` was not changed, `git add` will ignore it.

---

## Task 11: Make Serve Session Pipeline Test Deterministic

**Files:**
- Modify: `test/serve-session-pipeline.test.js`
- Possibly Modify: `src/commands/serve.js`
- Possibly Modify: `src/commands/sync.js`
- Test: `test/serve-session-pipeline.test.js`

- [ ] **Step 1: Run the failing test alone**

Run:

```bash
rtk node --test test/serve-session-pipeline.test.js
```

Expected before fix: `serve pipeline emits SSE session events for new rollout` may fail because no `session:update` event is observed.

- [ ] **Step 2: Add explicit readiness wait in the test**

In `test/serve-session-pipeline.test.js`, ensure the test waits for both server readiness and SSE connection before writing/syncing rollout input. The helper should poll the health endpoint:

```js
async function waitForHttpReady(port, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/local-auth`, {
        headers: { origin: `http://127.0.0.1:${port}` },
      });
      if (res.status === 200 || res.status === 401 || res.status === 404) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastErr || new Error("server did not become ready");
}
```

Call it immediately after spawning `vibedeck serve`.

- [ ] **Step 3: Add explicit SSE subscription confirmation**

Before triggering sync, wait until the test has received the initial snapshot event:

```js
await waitForEvent(got, (event) => event.type === "snapshot", 10_000);
```

If there is no `waitForEvent` helper, add:

```js
async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("timed out waiting for SSE event");
}
```

- [ ] **Step 4: If deterministic test still fails, inspect implementation**

Run:

```bash
rg -n "session:update|liveBus|emit|processSessionEvent|drain" src/commands/sync.js src/commands/serve.js src/lib/sessions src/lib/local-api.js
```

Expected: identify whether sync emits events only in long-running serve mode or whether standalone sync updates DB without notifying current serve clients.

If serve clients should receive updates from sync, ensure the serve process watches DB/session state or exposes a sync endpoint that emits through its local `liveBus`. If separate CLI sync cannot notify an already-running serve process by memory bus, change the test expectation to poll the snapshot endpoint after sync rather than expecting in-memory SSE from a different process.

- [ ] **Step 5: Run focused serve pipeline test**

Run:

```bash
rtk node --test test/serve-session-pipeline.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add test/serve-session-pipeline.test.js src/commands/serve.js src/commands/sync.js src/lib/local-api.js
rtk git commit -m "test: stabilize serve session pipeline"
```

Expected: commit succeeds. If implementation files were not changed, `git add` will ignore them.

---

## Task 12: Full Verification And Final Cleanup Review

**Files:**
- No planned source edits unless verification exposes a new issue.

- [ ] **Step 1: Run backend test suite**

Run:

```bash
rtk node --test test/*.test.js
```

Expected: PASS. Any remaining failures must be categorized as either:

```text
cleanup-caused: fix before finishing
pre-existing unrelated: document with exact failing file/test name
```

- [ ] **Step 2: Run dashboard tests**

Run:

```bash
rtk npm --prefix dashboard run test
```

Expected: PASS.

- [ ] **Step 3: Run dashboard production build**

Run:

```bash
rtk npm --prefix dashboard run build
```

Expected: PASS. Chunk-size warnings are acceptable; missing copy-key warnings are not acceptable unless already documented as unrelated.

- [ ] **Step 4: Run package dry-run**

Run:

```bash
env npm_config_cache=/private/tmp/vibedeck-npm-cache npm pack --dry-run --json
```

Expected:

```text
PASS
package name is vibedeck-cli
bin/vibedeck.js is included
src/ is included
dashboard/dist/ is included
deleted config/skills/protocol files are not included
LICENSE is not included if it remains deleted
```

- [ ] **Step 5: Run stale reference scan**

Run:

```bash
rg -n "InsForge|insforge|TokenTrackerBar|tokentracker-cli|dashboard/skills-lock|skills-lock|Software Engineering Protocol|software-engineering-protocol|interaction_sequence|vibeusage-tracker\\.js|landing-desktop" . --glob '!node_modules/**' --glob '!dashboard/node_modules/**' --glob '!dashboard/dist/**' --glob '!docs/superpowers/**'
```

Expected: no matches except compatibility references intentionally allowlisted in `test/vibedeck-cleanup-identity.test.js` and `src/lib/migration.js`.

- [ ] **Step 6: Review git diff for accidental resurrection**

Run:

```bash
rtk git status --short
rtk git diff --stat
```

Expected:

```text
No deleted cleanup artifacts are re-added.
No unrelated UI/session/canonical changes are reverted.
Diff only includes cleanup stabilization files touched by this plan.
```

- [ ] **Step 7: Final commit**

If previous tasks were committed individually, skip this step. If execution was done in one batch, run:

```bash
rtk git add package.json test scripts dashboard/src dashboard/scripts src
rtk git commit -m "chore: finish VibeDeck cleanup stabilization"
```

Expected: commit succeeds.

---

## Self-Review

**Spec coverage:** This plan covers the remaining audited areas: deleted artifact guardrails, package metadata after deleted `LICENSE`, stale scripts, stale tests, duplicated cleanup tests, broken acceptance script, and the three known backend failures.

**No resurrection rule:** Every task explicitly says not to recreate already-deleted config, skills, lock, protocol, or stale acceptance files.

**Risk controls:** Parser/pricing/provider/session tests are kept. The plan only deletes tests that are obsolete or duplicated and updates stale assertions where product behavior changed.

**Verification:** Full backend tests, dashboard tests, dashboard build, npm pack dry-run, stale-reference scan, and git-diff review are required before completion.
