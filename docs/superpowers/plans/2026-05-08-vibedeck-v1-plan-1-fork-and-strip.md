# VibeDeck v1 — Plan 1: Fork & Strip

> **STATUS: ✅ COMPLETE** — tagged `plan-1-fork-and-strip-complete` on 2026-05-08. 17 tasks executed via Claude Sonnet subagents (subagent-driven-development pattern). Final state: 476/476 tests passing, dashboard builds, CLI + server smoke tests pass.

## Summary of what shipped

Hard fork of TokenTracker bootstrapped at `~/Downloads/Projects/VibeDeck/` with a fresh git repo. Mechanical rename + strip:
- Package renamed to `vibedeck-cli`; bin commands `vibedeck` and `vd`
- Default port `7690` (TokenTracker uses 7680); data dir `~/.vibedeck/`
- Stripped: leaderboard pages + endpoints, IP-check, marketing landing, share cards (Broadsheet + Annual Report variants), InsForge cloud auth + login pages, login modal context, cloud auth proxy `/api/auth/*`, cloud sync upload from `sync` command
- CLI user-facing copy switched from "TokenTracker" to "VibeDeck"
- `copy.csv` pruned from 746 → 354 entries
- README rebranded with Origin section attributing TokenTracker upstream
- LICENSE updated for fork attribution (MIT preserved)
- `CLAUDE.md` preamble added documenting VibeDeck specifics

**Implementation pattern used:** Claude Sonnet subagents via `superpowers:subagent-driven-development`. Plan 2 onwards switched to Codex (gpt-5.2) — see `docs/superpowers/codex-workflow.md`.

---

## Original plan content (preserved for traceability)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a working VibeDeck CLI base at `~/Downloads/Projects/VibeDeck/` that builds, tests pass, and runs `vibedeck status` successfully — no new features, just a renamed and stripped chassis.

**Architecture:** Copy TokenTracker source into a new local directory, initialize a fresh git repo, perform mechanical rename + strip operations validated by the existing test suite at every step. All work is local (no GitHub remote yet).

**Tech Stack:** Node.js 20+, npm, React 18 + Vite 7 + TypeScript 5.9 (dashboard), `node --test` (tests). No infrastructure changes.

**Source repo:** `/Users/vasuyadav/Downloads/Projects/TokenTracker/` (read-only — never modified by this plan)
**Target dir:** `/Users/vasuyadav/Downloads/Projects/VibeDeck/` (created by Task 1)

**Working assumption for this plan:** From Task 2 onward, all `cd` and file paths are relative to the target dir unless otherwise stated. Each task ends with a commit so progress is recoverable.

---

## Task 1: Bootstrap fork directory and git repo

**Files:**
- Create: `~/Downloads/Projects/VibeDeck/` (directory)
- Create: `~/Downloads/Projects/VibeDeck/.git/` (via `git init`)

- [ ] **Step 1: Verify target does not exist**

Run: `test ! -e ~/Downloads/Projects/VibeDeck && echo "OK: target empty"`
Expected: prints `OK: target empty`. If the directory already exists, STOP and ask the user before overwriting.

- [ ] **Step 2: Copy TokenTracker tree to VibeDeck (excluding generated/heavy artifacts)**

Run:
```bash
mkdir -p ~/Downloads/Projects/VibeDeck
rsync -a \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='dashboard/dist/' \
  --exclude='dashboard/node_modules/' \
  --exclude='TokenTrackerBar/EmbeddedServer/' \
  --exclude='TokenTrackerBar/build/' \
  --exclude='TokenTrackerBar/.build/' \
  --exclude='*.dmg' \
  --exclude='*.log' \
  /Users/vasuyadav/Downloads/Projects/TokenTracker/ \
  ~/Downloads/Projects/VibeDeck/
```

- [ ] **Step 3: Initialize new git repo and create baseline commit**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
git init
git add -A
git commit -m "chore: bootstrap VibeDeck from TokenTracker fork"
```

Expected: a single commit on `main` (or `master` depending on system default — verify with `git branch --show-current`).

- [ ] **Step 4: Confirm tree is intact and tests run**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
npm install
npm test 2>&1 | tail -20
```

Expected: all tests pass (this confirms the fork is a faithful copy before any modification).

---

## Task 2: Rename npm package metadata and primary bin

**Files:**
- Modify: `package.json`
- Modify: `bin/tracker.js` → renamed to `bin/vibedeck.js`

- [ ] **Step 1: Read current package.json and identify rename targets**

Run: `cat package.json | head -40`
Note the values of: `name`, `bin`, `description`, `keywords`, `repository`. These all reference `tokentracker`.

- [ ] **Step 2: Write a failing test asserting the new package name**

Create file: `test/vibedeck-package-identity.test.js`
```js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const pkg = require(path.join(__dirname, '..', 'package.json'));

test('package is named vibedeck-cli', () => {
  assert.strictEqual(pkg.name, 'vibedeck-cli');
});

test('bin exposes vibedeck command', () => {
  assert.ok(pkg.bin && typeof pkg.bin === 'object', 'bin must be an object');
  assert.ok('vibedeck' in pkg.bin, 'bin.vibedeck must exist');
});

test('node engine still >=20', () => {
  assert.match(pkg.engines.node, /^>=20/);
});
```

- [ ] **Step 3: Run the test, expect failure**

Run: `node --test test/vibedeck-package-identity.test.js`
Expected: FAIL with mismatched name (`tokentracker-cli` vs `vibedeck-cli`).

- [ ] **Step 4: Rename the bin file**

Run:
```bash
git mv bin/tracker.js bin/vibedeck.js
```

- [ ] **Step 5: Update package.json**

Edit `package.json`:
- Change `"name": "tokentracker-cli"` → `"name": "vibedeck-cli"`
- Replace the entire `bin` block with:
  ```json
  "bin": {
    "vibedeck": "bin/vibedeck.js",
    "vd": "bin/vibedeck.js"
  }
  ```
- Change `"description"` to `"Local-first cost & provenance cockpit for AI coding agents"`
- Replace the `keywords` array with: `["ai", "agents", "tokens", "cost", "claude-code", "cursor", "codex", "local-first"]`
- Set `"repository"` to `{ "type": "git", "url": "git+https://github.com/PLACEHOLDER/vibedeck.git" }` (placeholder — user updates when they push to GitHub)
- Set `"homepage"` to an empty string for now: `""`

- [ ] **Step 6: Run identity test to confirm pass**

Run: `node --test test/vibedeck-package-identity.test.js`
Expected: PASS.

- [ ] **Step 7: Run the full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: most tests pass. Some tests that hardcode `tokentracker-cli` in strings may fail — note them in the next step. Do NOT fix them yet; they're handled in Task 4.

- [ ] **Step 8: Commit**

Run:
```bash
git add package.json bin/vibedeck.js test/vibedeck-package-identity.test.js
# bin/tracker.js removal already staged by git mv
git commit -m "feat: rename package to vibedeck-cli and rename primary bin"
```

---

## Task 3: Update default port (7680 → 7690) and data path (~/.tokentracker → ~/.vibedeck)

**Files:**
- Modify: `src/lib/tracker-paths.js`
- Modify: `src/commands/serve.js` (default port lookup)
- Modify: `src/lib/runtime-config.js` (any port/path references)
- Possibly modify: `src/cli.js` if it has port defaults
- Test: `test/vibedeck-paths-and-port.test.js` (new)

- [ ] **Step 1: Identify all references to the old port and path**

Run:
```bash
grep -rn "7680" src/ bin/ test/ | grep -v node_modules
grep -rn "\.tokentracker" src/ bin/ test/ | grep -v node_modules
```

Note every file and line. These are the targets for the next steps.

- [ ] **Step 2: Write failing test for new defaults**

Create `test/vibedeck-paths-and-port.test.js`:
```js
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const trackerPaths = require('../src/lib/tracker-paths');

test('default data dir is ~/.vibedeck', () => {
  const dataDir = trackerPaths.getDataDir();
  assert.strictEqual(dataDir, path.join(os.homedir(), '.vibedeck'));
});

test('default port is 7690', () => {
  const port = trackerPaths.getDefaultPort
    ? trackerPaths.getDefaultPort()
    : require('../src/lib/runtime-config').getDefaultPort();
  assert.strictEqual(port, 7690);
});
```

(If `tracker-paths.js` exposes a different function name for the data dir, adjust the test to call the existing function — read the file first to confirm.)

- [ ] **Step 3: Run test, expect failure**

Run: `node --test test/vibedeck-paths-and-port.test.js`
Expected: FAIL.

- [ ] **Step 4: Update `src/lib/tracker-paths.js`**

Read the file. Change every occurrence of the literal string `.tokentracker` to `.vibedeck`. Specifically the directory-name constant. Do not rename the module file itself yet (that's a later refactor — keep it stable so imports don't break).

- [ ] **Step 5: Update default port to 7690**

Find the constant defining the default port (likely named `DEFAULT_PORT` or similar in `runtime-config.js` or `serve.js`). Change `7680` → `7690`. Update any hardcoded references in `serve.js` and `cli.js`.

- [ ] **Step 6: Run paths-and-port test**

Run: `node --test test/vibedeck-paths-and-port.test.js`
Expected: PASS.

- [ ] **Step 7: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: tests that hardcoded `7680` or `.tokentracker` may fail. Note them. Some of these tests may need updates; some may be testing the rename and SHOULD be updated. Update only ones that are clearly testing default values (e.g., `default port is 7680` → `default port is 7690`). Leave behavior tests alone — they should still pass with the new constants.

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "feat: change default port to 7690 and data dir to ~/.vibedeck"
```

---

## Task 4: Update tests that hardcode old name/port/path

**Files:**
- Modify: any test files that broke after Tasks 2-3 with hardcoded references

- [ ] **Step 1: Run full test suite and capture failures**

Run: `npm test 2>&1 | tee /tmp/vibedeck-test-failures.log | grep -E "fail|FAIL" | head -40`
Note every failing test file.

- [ ] **Step 2: For each failing test, identify whether the failure is**
  - **(a) Hardcoded old value** — test asserts `tokentracker-cli` or `7680` or `.tokentracker` and needs updating to the new value.
  - **(b) Genuine regression** — test exercises behavior that broke. Stop and investigate; do not "update the test" to make a real failure pass.

- [ ] **Step 3: Update tests in category (a) one file at a time**

For each test file in category (a):
- Read the file.
- Replace the hardcoded old value with the new value.
- Run that single test file: `node --test test/<file>.test.js` — expect PASS.
- Move to next.

- [ ] **Step 4: Run full test suite again**

Run: `npm test 2>&1 | tail -30`
Expected: all previously-failing tests in category (a) now pass. No new failures introduced.

- [ ] **Step 5: Commit**

Run:
```bash
git add test/
git commit -m "test: update tests for vibedeck rename"
```

---

## Task 5: Strip leaderboard pages from dashboard

**Files:**
- Delete: `dashboard/src/pages/LeaderboardPage.jsx`
- Delete: `dashboard/src/pages/LeaderboardProfilePage.jsx`
- Modify: `dashboard/src/App.jsx` (remove routes + lazy imports for leaderboard)
- Delete: `test/mock-leaderboard.test.js` (test for the stripped feature)
- Possibly delete: any `dashboard/src/ui/**` components that exist exclusively for leaderboard
- Modify: `dashboard/src/ui/openai/components/Sidebar.jsx` (remove leaderboard nav item)

- [ ] **Step 1: Find every reference to leaderboard**

Run:
```bash
grep -rn -l "Leaderboard\|leaderboard" dashboard/src/ test/ src/ bin/ 2>/dev/null
```
Note every file.

- [ ] **Step 2: Read `dashboard/src/App.jsx` to identify route + import lines for leaderboard**

Run: `grep -n -i "leaderboard" dashboard/src/App.jsx`
Note line numbers.

- [ ] **Step 3: Remove leaderboard imports and routes from App.jsx**

Edit `dashboard/src/App.jsx`:
- Remove the `lazy(() => import('./pages/LeaderboardPage'))` line.
- Remove the `lazy(() => import('./pages/LeaderboardProfilePage'))` line.
- Remove the `<Route>` entries for `/leaderboard` and `/leaderboard/:handle`.
- Remove any conditional logic referencing `isLeaderboardIndexPath` (used to bypass `AppLayout`); since the route no longer exists, this branch is dead code.

- [ ] **Step 4: Remove leaderboard nav item from Sidebar**

Edit `dashboard/src/ui/openai/components/Sidebar.jsx`:
- Remove the link/button entry for "Leaderboard" (search for the string in the file).

- [ ] **Step 5: Delete the leaderboard page files**

Run:
```bash
git rm dashboard/src/pages/LeaderboardPage.jsx
git rm dashboard/src/pages/LeaderboardProfilePage.jsx
git rm test/mock-leaderboard.test.js
```

- [ ] **Step 6: Build dashboard to confirm no broken imports**

Run: `npm run dashboard:build 2>&1 | tail -20`
Expected: build succeeds. If any import fails, identify the file referencing leaderboard and remove the import.

- [ ] **Step 7: Run dashboard tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS (or the same set of pass/fail as before this task; no new failures from this task).

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip leaderboard pages and routes"
```

---

## Task 6: Strip IP-check page

**Files:**
- Delete: `dashboard/src/pages/IpCheckPage.jsx`
- Modify: `dashboard/src/App.jsx` (remove `/ip-check` route + lazy import)
- Modify: any sidebar/menu that references it (likely `Sidebar.jsx` does NOT — IP-check was standalone outside `AppLayout`)

- [ ] **Step 1: Find references**

Run: `grep -rn -i "ipcheck\|/ip-check" dashboard/src/ test/ 2>/dev/null`

- [ ] **Step 2: Remove import and route from App.jsx**

Edit `dashboard/src/App.jsx`:
- Remove `lazy(() => import('./pages/IpCheckPage'))`.
- Remove the `<Route path="/ip-check" ...>` entry.
- Remove the conditional bypass logic for `/ip-check` if present.

- [ ] **Step 3: Delete the page file**

Run: `git rm dashboard/src/pages/IpCheckPage.jsx`

- [ ] **Step 4: Build dashboard**

Run: `npm run dashboard:build 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip ip-check page"
```

---

## Task 7: Strip marketing landing page

**Files:**
- Delete: `dashboard/src/pages/LandingPage.jsx`
- Modify: `dashboard/src/App.jsx` (remove route)
- Delete: `test/landing-cta-copy.test.js`
- Delete: `test/landing-extras-imports.test.js`
- Delete: `test/landing-screenshot.test.js`

- [ ] **Step 1: Find references**

Run: `grep -rn -l "LandingPage" dashboard/src/ test/ 2>/dev/null`

- [ ] **Step 2: Remove route and import from App.jsx**

Edit `dashboard/src/App.jsx`:
- Remove `lazy(() => import('./pages/LandingPage'))`.
- Remove the route definition. Decide on a replacement default route — for v1, the dashboard root (`/`) should land on `DashboardPage`. If LandingPage was the index, change the index to render `DashboardPage` directly (or its lazy import).

- [ ] **Step 3: Delete page and test files**

Run:
```bash
git rm dashboard/src/pages/LandingPage.jsx
git rm test/landing-cta-copy.test.js
git rm test/landing-extras-imports.test.js
git rm test/landing-screenshot.test.js
```

- [ ] **Step 4: Build**

Run: `npm run dashboard:build 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip marketing landing page"
```

---

## Task 8: Strip share cards (Broadsheet + Annual Report)

**Files:**
- Delete entire dir: `dashboard/src/ui/share/`
- Delete: `test/share-card-data.test.js`
- Modify: any component that imports `ShareModal` (likely `DashboardPage.jsx` or a header)

- [ ] **Step 1: Find consumers of share components**

Run:
```bash
grep -rn "from ['\"].*ui/share" dashboard/src/ 2>/dev/null
grep -rn "ShareModal\|capture-share-card\|BroadsheetCard\|AnnualReportCard" dashboard/src/ test/ 2>/dev/null | grep -v "ui/share/"
```

- [ ] **Step 2: Remove every consumer's import and usage**

For each consuming file:
- Remove the import line.
- Remove the JSX that renders `<ShareModal ... />` (and any state/props feeding it: `isShareOpen`, `setShareOpen`, share buttons, etc.).
- The dashboard should still render correctly without share — verify in the next step.

- [ ] **Step 3: Delete share dir and test**

Run:
```bash
git rm -r dashboard/src/ui/share/
git rm test/share-card-data.test.js
```

- [ ] **Step 4: Build dashboard**

Run: `npm run dashboard:build 2>&1 | tail -20`
Expected: PASS. If any "Cannot find module" error references `ui/share`, return to Step 1 and find the missed consumer.

- [ ] **Step 5: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip share cards (Broadsheet + Annual Report variants)"
```

---

## Task 9: Strip cloud auth (InsForge) and login pages

**Files:**
- Delete: `dashboard/src/contexts/InsforgeAuthContext.jsx`
- Delete: `dashboard/src/contexts/InsforgeAuthContext.d.ts`
- Delete: `dashboard/src/contexts/__tests__/` (only if all tests inside test InsForge — verify)
- Delete: `dashboard/src/pages/LoginPage.jsx`
- Delete: `dashboard/src/pages/NativeAuthCallbackPage.jsx`
- Delete: `dashboard/src/contexts/LoginModalContext.jsx`
- Modify: `dashboard/src/App.jsx` (remove auth gate, login routes, callback route)
- Modify: any component using `useInsforgeAuth` or `useLoginModal` (likely DashboardPage, Sidebar, SettingsPage)

- [ ] **Step 1: Inventory all consumers**

Run:
```bash
grep -rn "InsforgeAuth\|useInsforgeAuth\|InsforgeProvider" dashboard/src/ 2>/dev/null
grep -rn "LoginModal\|useLoginModal" dashboard/src/ 2>/dev/null
grep -rn "NativeAuthCallback" dashboard/src/ 2>/dev/null
```
List every file. This is the strip surface.

- [ ] **Step 2: Remove auth providers from `App.jsx`**

Edit `dashboard/src/App.jsx`:
- Remove `<InsforgeAuthProvider>` wrapper (children render directly).
- Remove `<LoginModalProvider>` wrapper.
- Remove `lazy(() => import('./pages/LoginPage'))`.
- Remove `lazy(() => import('./pages/NativeAuthCallbackPage'))`.
- Remove `<Route path="/login" ...>` and the native-auth callback route.
- Remove any "auth gate" logic — VibeDeck v1 is local-only, no login required. Routes render directly.

- [ ] **Step 3: Remove `useInsforgeAuth` and `useLoginModal` from consumers**

For each consuming component:
- Remove the hook import.
- Remove conditional rendering keyed off `user`, `isAuthenticated`, `requestLogin`, etc.
- Local mode is the only mode — render the local UI unconditionally.
- If a sign-in / sign-out button exists in `Sidebar.jsx` or `SettingsPage.jsx`, remove it.

- [ ] **Step 4: Verify no remaining import**

Run:
```bash
grep -rn "InsforgeAuth\|LoginModal\|NativeAuthCallback" dashboard/src/ 2>/dev/null
```
Expected: only matches in files about to be deleted; no matches in retained files.

- [ ] **Step 5: Delete the files**

Run:
```bash
git rm dashboard/src/contexts/InsforgeAuthContext.jsx
git rm dashboard/src/contexts/InsforgeAuthContext.d.ts
git rm dashboard/src/contexts/LoginModalContext.jsx
git rm dashboard/src/pages/LoginPage.jsx
git rm dashboard/src/pages/NativeAuthCallbackPage.jsx
```

For the `__tests__/` directory inside `dashboard/src/contexts/`: read each test file. If it tests InsForge or LoginModal exclusively, `git rm` it. If it tests something else, leave it alone.

- [ ] **Step 6: Build dashboard**

Run: `npm run dashboard:build 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 8: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip InsForge cloud auth and login pages (local-only)"
```

---

## Task 10: Strip cloud auth proxy endpoints (`/api/auth/*`)

**Files:**
- Modify: `src/lib/local-api.js` (remove `/api/auth/*` routes)
- Modify: `src/commands/serve.js` (remove any auth-proxy setup)
- Modify: `src/lib/runtime-config.js` (remove cloud-auth env vars / config)

- [ ] **Step 1: Find auth-proxy code**

Run:
```bash
grep -rn "/api/auth\|cloud.*auth\|insforge\|INSFORGE" src/ 2>/dev/null
```
Note every match.

- [ ] **Step 2: Remove `/api/auth/*` route handlers from `src/lib/local-api.js`**

Read the file. Find the route registrations matching `/api/auth/...`. Remove each handler and any helpers used only by those handlers.

- [ ] **Step 3: Remove cloud-auth wiring from `serve.js` and `runtime-config.js`**

Remove:
- Any read of cloud-auth env vars (`INSFORGE_*`, etc.).
- Any code that warns about missing cloud-auth tokens.
- Any code that tells the user to authenticate with the cloud.

Keep:
- All token-cost / parsing / pricing / hooks logic untouched.

- [ ] **Step 4: Run full test suite**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. If a test asserts the existence of a `/api/auth` endpoint, that test was testing stripped functionality — `git rm` it.

- [ ] **Step 5: Smoke test: start serve and curl a real endpoint**

Run:
```bash
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 2
curl -s http://127.0.0.1:7690/functions/tokentracker-usage-summary | head -5
kill $SERVE_PID
```
Expected: a JSON response (possibly empty) — proves the server starts on port 7690 and responds to a kept endpoint.

- [ ] **Step 6: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip cloud auth proxy and InsForge wiring"
```

---

## Task 11: Strip cloud sync upload logic from `src/commands/sync.js`

**Files:**
- Modify: `src/commands/sync.js` (remove upload-to-cloud path; keep local queue write)
- Possibly modify: `src/lib/upload-throttle.js` (delete if only used for cloud upload)

- [ ] **Step 1: Identify cloud-upload code path in sync.js**

Run: `grep -n "upload\|fetch.*insforge\|fetch.*cloud\|TOKENTRACKER_DEVICE_TOKEN" src/commands/sync.js`
Note line ranges.

- [ ] **Step 2: Read `src/commands/sync.js` around those lines**

Identify the exact branches that:
- Read a device token.
- POST batches to a cloud endpoint.
- Throttle uploads.

- [ ] **Step 3: Remove upload code, preserve local queue write**

Edit `src/commands/sync.js`:
- Delete the entire upload branch (and its helper functions if only used here).
- Preserve: parse logs → write to local queue.jsonl → write to local SQLite.
- The `--no-sync` flag continues to short-circuit syncing (kept for now even though semantics change — it was originally "skip upload"; now it can mean "skip local write" for parity. Decision: keep flag as a no-op for backward compatibility with scripts; document behavior in `--help`).

- [ ] **Step 4: Decide on `upload-throttle.js`**

Run: `grep -rn "upload-throttle\|uploadThrottle" src/ 2>/dev/null`
If no consumer remains: `git rm src/lib/upload-throttle.js` and remove its corresponding test (if any).
If consumers remain (unlikely): leave it alone.

- [ ] **Step 5: Run sync command end-to-end**

Run: `node bin/vibedeck.js sync 2>&1 | tail -20`
Expected: completes without error. May report 0 records uploaded (correct — no cloud).

- [ ] **Step 6: Run full tests**

Run: `npm test 2>&1 | tail -20`
Expected: PASS. Cloud-upload-specific tests should be deleted; local-queue tests should still pass.

- [ ] **Step 7: Commit**

Run:
```bash
git add -A
git commit -m "feat: strip cloud sync upload from sync command"
```

---

## Task 12: Prune `copy.csv` for stripped UI strings

**Files:**
- Modify: `dashboard/src/content/copy.csv`
- Run: `npm run validate:copy` to confirm

- [ ] **Step 1: Build dashboard and run copy validator**

Run: `npm run validate:copy 2>&1 | tail -30`
Expected: validator reports unused copy keys for the stripped UI (leaderboard.*, ipCheck.*, share.*, login.*, etc.).

- [ ] **Step 2: Remove unused keys from `dashboard/src/content/copy.csv`**

For each unused key reported:
- Open `copy.csv`.
- Delete the row.

(Process in batches by namespace prefix — e.g., delete all `leaderboard.*` rows in one pass.)

- [ ] **Step 3: Re-run validator**

Run: `npm run validate:copy 2>&1 | tail -10`
Expected: no unused keys remain (or only keys that are referenced by retained code that the validator can't statically detect — judge case-by-case).

- [ ] **Step 4: Run validate:ui-hardcode**

Run: `npm run validate:ui-hardcode 2>&1 | tail -10`
Expected: no new hardcoded strings (we didn't add any; this is a sanity check).

- [ ] **Step 5: Build dashboard**

Run: `npm run dashboard:build 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 6: Run tests**

Run: `npm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 7: Commit**

Run:
```bash
git add dashboard/src/content/copy.csv
git commit -m "chore: prune copy.csv for stripped UI strings"
```

---

## Task 13: Update `init` command's user-facing copy

**Files:**
- Modify: `src/commands/init.js`
- Modify: `src/lib/init-flow.js`
- Modify: `src/lib/cli-ui.js` (if it has product-name strings)

- [ ] **Step 1: Find product-name strings in CLI**

Run: `grep -rn "TokenTracker\|tokentracker" src/ bin/ | grep -v "\.tokentracker" | grep -v node_modules`
Note matches in user-facing strings (welcome banners, prompts, error messages).

(Note: keep references like `tokentracker_usage_summary` in API endpoint paths — those are kept-endpoints with stable contracts. Only update human-visible strings.)

- [ ] **Step 2: Replace product-name strings**

For each match:
- If it's a user-facing message: replace `TokenTracker` → `VibeDeck`.
- If it's a code identifier (function name, endpoint path, env var prefix): leave it. Renaming code identifiers is an optional later task (low value, high churn).

- [ ] **Step 3: Run init in a temp dir**

Run:
```bash
mkdir -p /tmp/vibedeck-test-init
cd /tmp/vibedeck-test-init
git init
node ~/Downloads/Projects/VibeDeck/bin/vibedeck.js init --dry-run 2>&1 | head -30
```
Expected: welcome banner says "VibeDeck", flow proceeds without crashing. (Use `--dry-run` if it exists; otherwise abort the prompt with Ctrl+C after seeing the banner.)

- [ ] **Step 4: Run tests**

Run: `cd ~/Downloads/Projects/VibeDeck && npm test 2>&1 | tail -10`
Expected: PASS.

- [ ] **Step 5: Commit**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
git add -A
git commit -m "feat: update CLI user-facing copy from TokenTracker to VibeDeck"
```

---

## Task 14: Update `README.md` minimally

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read current README**

Run: `head -60 README.md`
Identify: title, install commands, primary description.

- [ ] **Step 2: Replace title and product line**

Edit `README.md`:
- Change top-level `# TokenTracker` → `# VibeDeck`.
- Change the one-line tagline to: `> Local-first cost & provenance cockpit for AI coding agents — a fork of TokenTracker.`
- In the install section, change:
  - `npm install -g tokentracker-cli` → `npm install -g vibedeck-cli` (with placeholder note: "not yet published").
  - `tokentracker` command examples → `vibedeck`.
- Add a short "Origin" section near the top:
  ```markdown
  ## Origin

  VibeDeck is a hard fork of [TokenTracker](https://github.com/mm7894215/TokenTracker), stripped of its consumer/cloud features (leaderboard, share cards, cloud sync) and extended for session/branch attribution and Entire CLI integration. License inherited from TokenTracker (MIT).
  ```
- Leave detailed feature documentation as-is for now — most of TokenTracker's documented features (per-provider parsers, hooks, dashboard) are inherited verbatim. New features are documented in subsequent plans.

- [ ] **Step 3: Update LICENSE**

Read `LICENSE`. Append (do not replace) a line below the existing copyright line:

```
Portions copyright 2026 <user> (VibeDeck fork).
```

(Original TokenTracker copyright remains intact — this is required for a fork under MIT.)

- [ ] **Step 4: Commit**

Run:
```bash
git add README.md LICENSE
git commit -m "docs: rebrand README and update LICENSE for VibeDeck fork"
```

---

## Task 15: Copy spec and plans into VibeDeck repo

**Files:**
- Copy: `docs/superpowers/specs/2026-05-08-vibedeck-v1-backend-design.md` from TokenTracker repo
- Copy: this plan file

- [ ] **Step 1: Copy spec and plan**

Run:
```bash
mkdir -p ~/Downloads/Projects/VibeDeck/docs/superpowers/specs
mkdir -p ~/Downloads/Projects/VibeDeck/docs/superpowers/plans
cp /Users/vasuyadav/Downloads/Projects/TokenTracker/docs/superpowers/specs/2026-05-08-vibedeck-v1-backend-design.md \
   ~/Downloads/Projects/VibeDeck/docs/superpowers/specs/
cp /Users/vasuyadav/Downloads/Projects/TokenTracker/docs/superpowers/plans/2026-05-08-vibedeck-v1-plan-1-fork-and-strip.md \
   ~/Downloads/Projects/VibeDeck/docs/superpowers/plans/
```

- [ ] **Step 2: Commit**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
git add docs/
git commit -m "docs: import VibeDeck spec and Plan 1 from upstream brainstorming"
```

---

## Task 16: Update `CLAUDE.md` to reflect VibeDeck

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Read current CLAUDE.md**

Run: `head -40 CLAUDE.md`
This file is dense (project-specific instructions). The strategy: prepend a VibeDeck-aware preamble; preserve the inherited TokenTracker docs as historical reference.

- [ ] **Step 2: Prepend VibeDeck preamble**

Edit `CLAUDE.md`. Add at the very top (above the existing content):

```markdown
# CLAUDE.md — VibeDeck

This repository is **VibeDeck**, a hard fork of TokenTracker. The bulk of this file documents the inherited TokenTracker architecture, which remains accurate for the parser, dashboard chassis, hooks, and macOS app subsystems.

**VibeDeck-specific notes for Claude:**

- Working name is `vibedeck`; final brand may change.
- Default port is **7690** (TokenTracker uses 7680); data dir is `~/.vibedeck/`.
- Cloud auth (InsForge), leaderboard, share cards, IP-check, and marketing landing are **stripped**. Do not propose re-adding them.
- New v1 work: session attribution layer (`src/lib/sessions.js`), Entire CLI bridge (`src/lib/entire-bridge.js`), collision-safe hook merger (`src/lib/hook-merger.js`), local-auth tokens (`src/lib/local-auth.js`), skill management (`src/lib/skills.js`).
- **Do not modify** `src/lib/rollout.js` parser/normalizer math, pricing tables, or bucket aggregation — load-bearing core IP from TokenTracker.
- Spec: `docs/superpowers/specs/2026-05-08-vibedeck-v1-backend-design.md`
- Active plan: `docs/superpowers/plans/2026-05-08-vibedeck-v1-plan-1-fork-and-strip.md`

---

# Inherited from TokenTracker (verbatim, kept for accuracy)

```

(Then leave the existing CLAUDE.md content intact below this marker.)

- [ ] **Step 3: Commit**

Run:
```bash
git add CLAUDE.md
git commit -m "docs: add VibeDeck preamble to CLAUDE.md, preserve TokenTracker inheritance notes"
```

---

## Task 17: Final validation — build, test, run

**Files:** none modified; verification only.

- [ ] **Step 1: Clean install**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
rm -rf node_modules dashboard/node_modules dashboard/dist
npm install
```
Expected: completes without error.

- [ ] **Step 2: Build dashboard**

Run: `npm run dashboard:build 2>&1 | tail -10`
Expected: PASS. Produces `dashboard/dist/`.

- [ ] **Step 3: Run full test suite**

Run: `npm test 2>&1 | tee /tmp/vibedeck-final-test.log | tail -20`
Expected: all tests pass. If any fail, **stop and investigate** — do not proceed to Plan 2 with red tests.

- [ ] **Step 4: Run lint / guardrails / hardcode checks**

Run:
```bash
npm run validate:guardrails 2>&1 | tail -10
npm run validate:ui-hardcode 2>&1 | tail -10
npm run validate:copy 2>&1 | tail -10
```
Expected: all PASS.

- [ ] **Step 5: Smoke test the CLI**

Run:
```bash
node bin/vibedeck.js --help 2>&1 | head -20
node bin/vibedeck.js status 2>&1 | head -20
```
Expected:
- `--help` shows VibeDeck banner and command list.
- `status` runs without crashing (may report no providers detected — that's fine in a fresh install).

- [ ] **Step 6: Smoke test the local server**

Run:
```bash
node bin/vibedeck.js serve --no-sync &
SERVE_PID=$!
sleep 3
curl -s http://127.0.0.1:7690/functions/tokentracker-usage-summary | head -5
echo "---"
curl -s http://127.0.0.1:7690/functions/tokentracker-user-status | head -5
kill $SERVE_PID 2>/dev/null
wait $SERVE_PID 2>/dev/null
```
Expected: both endpoints respond with JSON (empty data is fine; the existence of the response is the test).

- [ ] **Step 7: Tag the milestone**

Run:
```bash
cd ~/Downloads/Projects/VibeDeck
git tag plan-1-fork-and-strip-complete
git log --oneline -20
```
Expected: a commit history showing all 17 tasks; tag points at HEAD.

- [ ] **Step 8: Final commit (only if any uncommitted changes remain — should be clean)**

Run: `git status`
If clean: nothing to commit. If anything is uncommitted, review and commit with an appropriate message before tagging.

---

## Self-review notes

This plan is intentionally tactical and verification-heavy. Each task ends with build + tests + commit so progress is recoverable. No new features are introduced; the deliverable is a working renamed/stripped chassis ready for Plan 2 (Storage & Schema).

After Plan 1 completes (all 17 tasks done, tag in place), the next plan to write is `Plan 2: Storage & Schema` — adds the new `vibedeck_*` SQLite tables and migration scaffolding. Plan 3 onward depends on storage, so Plan 2 must complete before Plan 3 starts.

---

## Execution handoff

Plan 1 is ready. Two execution options:

**1. Subagent-driven (recommended)** — fresh subagent per task, review between tasks, fast iteration, isolates context.

**2. Inline execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review.

Pick one and we begin Task 1.
