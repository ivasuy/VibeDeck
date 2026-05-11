# VibeDeck Cleanup Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize the VibeDeck rename by removing stale TokenTracker product identity, all Chinese localization/content, cloud/InsForge/leaderboard/share leftovers, and tests/docs that no longer match the local-only product.

**Architecture:** Treat this as a cleanup migration with guard tests first. Keep compatibility paths only where they protect existing local installs, provider hooks, or TokenTracker data migration; remove product-facing legacy names and cloud code from runtime, tests, docs, and build metadata.

**Tech Stack:** Node.js `node:test`, Vite/React dashboard, Swift/macOS native wrapper, GitHub Actions, `rtk` command runner.

---

## File Structure

### New Guard Tests

- Create: `test/vibedeck-cleanup-identity.test.js`
  - Owns repo-wide cleanup invariants: no CJK characters in project-owned files, no deleted cloud/share paths, no product-facing TokenTracker references outside an explicit allowlist.

### Package And Release Metadata

- Modify: `package.json`
  - Restore npm package identity for `vibedeck-cli`.
- Modify: `dashboard/package.json`
  - Rename dashboard package and remove cloud-only dependency.
- Modify: `.github/workflows/npm-publish.yml`
  - Remove InsForge build env and old homebrew-tokentracker dispatch.
- Modify: `.github/workflows/release-dmg.yml`
  - Point to `VibeDeckMac`, `VibeDeckMac` scheme, and `VibeDeckMac.dmg`.
- Modify: `test/vibedeck-package-identity.test.js`
  - Keep current expectations.
- Modify: `test/npm-publish-workflow.test.js`
  - Keep publish checks aligned with local-only VibeDeck package.
- Modify: `test/release-dmg-workflow.test.js`
  - Update native paths and artifact names.

### Dashboard English-Only Locale

- Modify: `dashboard/src/lib/copy.ts`
  - Remove `zh` imports and translation registry.
- Modify: `dashboard/src/lib/locale.ts`
  - Reduce locale resolution to English only.
- Modify: `dashboard/src/ui/foundation/LocaleProvider.jsx`
  - Keep a tiny provider for existing `useLocale()` consumers, but make it English-only.
- Modify: `dashboard/src/hooks/useLocale.js`
  - Keep the existing context guard.
- Modify: `dashboard/src/components/settings/AppearanceSection.jsx`
  - Remove language segmented control.
- Delete: `dashboard/src/content/i18n/zh/core.json`
- Delete: `dashboard/src/content/i18n/zh/dashboard.json`
- Delete: `dashboard/src/content/i18n/zh/marketing.json`
- Modify: `dashboard/src/ui/foundation/__tests__/LocaleProvider.test.jsx`
  - Replace Chinese switching test with an English-only provider test.
- Modify: `dashboard/src/lib/locale.test.ts`
  - Replace Chinese detection tests with English-only normalization tests.
- Modify: `test/localization-regressions.test.js`
  - Replace Chinese regression suite with a no-CJK and native-English-only suite.

### Native English-Only Cleanup

- Modify: `VibeDeckMac/VibeDeckMac/Utilities/Strings.swift`
  - Remove bilingual helper branches and return English strings only.
- Modify: `VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift`
  - Remove `zh` branches and return English strings only.
- Modify: `VibeDeckMac/Shared/NativeLocalization.swift` if present
  - Remove Chinese locale state; keep only stable English settings if native callers still import it.
- Modify: Swift files returned by `rg -l -P "[\\x{3400}-\\x{9FFF}]" VibeDeckMac`
  - Translate comments to English or delete comments that are not useful.

### Cloud, Leaderboard, Share, And Marketing Removal

- Delete: `BACKEND_API.md`
- Delete: `dashboard/edge-patches/`
- Delete: `scripts/ops/rebuild-cloud-hourly.cjs`
- Delete: `scripts/ops/repair-cloud-from-queue.cjs`
- Delete: `scripts/ops/tokentracker-hourly-device-dedup.sql`
- Delete: `dashboard/src/lib/cloud-sync.ts`
- Delete: `dashboard/src/lib/cloud-sync-prefs.ts`
- Delete: `dashboard/src/lib/insforge-config.ts`
- Delete: `dashboard/src/hooks/use-cloud-usage-sync.ts`
- Delete: `dashboard/src/lib/__tests__/api-public-visibility.test.ts`
- Delete: `test/cloud-sync-prefs.test.js`
- Delete: `test/cloud-sync-rotation.test.js`
- Delete: `dashboard/share.html`
- Delete: `dashboard/wrapped-2025.html`
- Delete: `dashboard/src/ui/marketing/MarketingLanding.jsx`
- Delete: `docs/screenshots/leaderboard.png`
- Modify: `dashboard/src/lib/api.ts`
  - Remove leaderboard/public visibility/InsForge functions; keep local API functions.
- Modify: `dashboard/src/lib/config.ts`
  - Keep only local backend base URL config.
- Modify: `dashboard/src/lib/mock-data.ts`
  - Remove leaderboard mock helpers.
- Modify: `dashboard/src/components/settings/AccountSection.jsx`
  - Remove cloud sync and public profile rows.
- Modify: `dashboard/src/components/settings/useAccountProfileSettings.js`
  - Collapse to local-only account/settings state or delete if unused after `AccountSection` cleanup.
- Modify: `dashboard/src/content/copy.csv`
  - Remove cloud sync, public profile, leaderboard, share, wrapped, and landing-only copy rows.

### Stale Product Files And Docs

- Delete: `copy.jsx`
- Delete: `CONTRIBUTING.md`
- Delete: `SECURITY.md`
- Delete: `CHANGELOG.md` unless release history is actively used; if kept, replace it with a short VibeDeck-only history.
- Modify: `README.md`
  - Rewrite as VibeDeck local-first product docs. Remove Chinese link, TokenTracker screenshots, leaderboard sections, npm package links for `tokentracker-cli`, cloud claims, and OSS contribution sections.
- Modify: `.github/ISSUE_TEMPLATE/config.yml`
  - Remove old TokenTracker links or delete issue templates if the project is private/internal.
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
  - Replace old CLI/native names with VibeDeck or delete if unused.
- Modify: `CLAUDE.md`
  - Keep current local-only guidance but ensure it no longer claims stripped features are still present.

### Compatibility Allowlist

Keep these unless a later migration plan removes them safely:

- `src/lib/migration.js` references to `.tokentracker`.
- Provider hook env vars named `TOKENTRACKER_*` where installed provider hooks already emit them.
- Legacy local API route aliases used by old dashboard/native builds.
- Tests that explicitly verify migration or legacy local route compatibility:
  - `test/migration-detect.test.js`
  - `test/local-api-skills.test.js`
  - `test/local-api-project-usage-summary.test.js`
  - provider hook tests that set `TOKENTRACKER_*`

---

## Tasks

### Task 1: Add Cleanup Guard Tests

**Files:**
- Create: `test/vibedeck-cleanup-identity.test.js`

- [ ] **Step 1: Write the failing cleanup guard test**

Create `test/vibedeck-cleanup-identity.test.js` with this complete content:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dashboard/dist",
  "dist",
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
  "scripts/ops/tokentracker-hourly-device-dedup.sql",
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

test("cloud, leaderboard, share, and stale OSS files are removed", () => {
  const existing = REMOVED_PATHS.filter((repoPath) => fs.existsSync(path.join(ROOT, repoPath)));
  assert.deepEqual(existing.sort(), []);
});

test("product-facing TokenTracker references are removed outside the compatibility allowlist", () => {
  const legacy = /TokenTracker|Token Tracker|tokentracker|TokenTrackerBar/;
  const offenders = [];
  for (const abs of walk(ROOT)) {
    const repoPath = toRepoPath(abs);
    if (TOKEN_TRACKER_ALLOWLIST.includes(repoPath)) continue;
    const text = fs.readFileSync(abs, "utf8");
    if (legacy.test(text)) offenders.push(repoPath);
  }
  assert.deepEqual(offenders.sort(), []);
});
```

- [ ] **Step 2: Run the guard test and verify it fails**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: FAIL. The failure should list existing CJK, stale cloud/share paths, and product-facing TokenTracker references.

- [ ] **Step 3: Commit the failing guard test**

Run:

```bash
git add test/vibedeck-cleanup-identity.test.js
git commit -m "test: add VibeDeck cleanup guardrails"
```

Expected: commit succeeds with only the new guard test staged.

### Task 2: Restore Package Identity And Native Release Paths

**Files:**
- Modify: `package.json`
- Modify: `dashboard/package.json`
- Modify: `.github/workflows/release-dmg.yml`
- Modify: `.github/workflows/npm-publish.yml`
- Modify: `test/release-dmg-workflow.test.js`
- Modify: `test/npm-publish-workflow.test.js`
- Test: `test/vibedeck-package-identity.test.js`
- Test: `test/release-dmg-workflow.test.js`
- Test: `test/npm-publish-workflow.test.js`

- [ ] **Step 1: Run the current metadata tests**

Run:

```bash
rtk node --test test/vibedeck-package-identity.test.js test/npm-publish-workflow.test.js test/release-dmg-workflow.test.js
```

Expected: FAIL on missing root package fields and old `TokenTrackerBar` native paths.

- [ ] **Step 2: Restore root package metadata**

Replace `package.json` with this structure, preserving the existing `packageManager` value exactly:

```json
{
  "name": "vibedeck-cli",
  "version": "0.6.1",
  "description": "Local-first cost and provenance dashboard for AI coding agents.",
  "license": "MIT",
  "bin": {
    "vibedeck": "./bin/vibedeck.js"
  },
  "engines": {
    "node": ">=22.5"
  },
  "files": [
    "bin/",
    "src/",
    "dashboard/dist/",
    "README.md",
    "LICENSE",
    "package.json"
  ],
  "scripts": {
    "dashboard:build": "npm --prefix dashboard run build",
    "test": "node --test test/*.test.js"
  },
  "packageManager": "pnpm@10.33.4+sha512.7b33598cb1d34a6c623bbd8f9d1761847e25cf7ec3d215b0fb70f5ac1c800a0c044781a7c24a81c84c9c1bbcc55332762b17480f2e200d1292e028d31a199ef20"
}
```

- [ ] **Step 3: Rename the dashboard package and remove InsForge dependency**

In `dashboard/package.json`:

```json
"name": "@vibedeck/dashboard"
```

Remove this dependency entry:

```json
"@insforge/sdk": "^1.2.2"
```

Do not change unrelated dependency versions in this step.

- [ ] **Step 4: Update release workflow path expectations**

In `test/release-dmg-workflow.test.js`, replace native path and artifact expectations:

```js
assert.ok(content.includes("-scheme VibeDeckMac"));
assert.ok(content.includes("VibeDeckMac.dmg"));
```

Replace the DMG script path check with:

```js
const dmgScript = fs.readFileSync(
  path.join(__dirname, "..", "VibeDeckMac", "scripts", "create-dmg.sh"),
  "utf8"
);
```

- [ ] **Step 5: Update `.github/workflows/release-dmg.yml`**

Make these exact replacements:

```text
TokenTrackerBar/project.yml -> VibeDeckMac/project.yml
TokenTrackerBar/scripts/bundle-node.sh -> VibeDeckMac/scripts/bundle-node.sh
working-directory: TokenTrackerBar -> working-directory: VibeDeckMac
-scheme TokenTrackerBar -> -scheme VibeDeckMac
TokenTrackerBar.app -> VibeDeckMac.app
TokenTrackerWidget.appex -> VibeDeckWidget.appex
TokenTrackerBar/build/TokenTrackerBar.dmg -> VibeDeckMac/build/VibeDeckMac.dmg
```

Remove `VITE_INSFORGE_BASE_URL` and `VITE_INSFORGE_ANON_KEY` env entries from the workflow.

- [ ] **Step 6: Update `.github/workflows/npm-publish.yml`**

Remove the InsForge dashboard build env block and the homebrew-tokentracker repository dispatch step. Keep dashboard build, npm version check, npm publish, and concurrency.

- [ ] **Step 7: Run metadata tests**

Run:

```bash
rtk node --test test/vibedeck-package-identity.test.js test/npm-publish-workflow.test.js test/release-dmg-workflow.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit metadata cleanup**

Run:

```bash
git add package.json dashboard/package.json .github/workflows/npm-publish.yml .github/workflows/release-dmg.yml test/npm-publish-workflow.test.js test/release-dmg-workflow.test.js
git commit -m "chore: stabilize VibeDeck package and release metadata"
```

### Task 3: Remove Dashboard Chinese Locale Runtime

**Files:**
- Modify: `dashboard/src/lib/copy.ts`
- Modify: `dashboard/src/lib/locale.ts`
- Modify: `dashboard/src/ui/foundation/LocaleProvider.jsx`
- Modify: `dashboard/src/components/settings/AppearanceSection.jsx`
- Modify: `dashboard/src/lib/locale.test.ts`
- Modify: `dashboard/src/ui/foundation/__tests__/LocaleProvider.test.jsx`
- Delete: `dashboard/src/content/i18n/zh/core.json`
- Delete: `dashboard/src/content/i18n/zh/dashboard.json`
- Delete: `dashboard/src/content/i18n/zh/marketing.json`

- [ ] **Step 1: Replace locale tests with English-only expectations**

Replace `dashboard/src/lib/locale.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  EN_LOCALE,
  LOCALE_STORAGE_KEY,
  getInitialLocalePreference,
  normalizeLocalePreference,
  normalizeResolvedLocale,
  persistLocalePreference,
  resolvePreferredLocale,
} from "./locale";

describe("English-only locale", () => {
  it("normalizes every preference to English", () => {
    expect(normalizeLocalePreference("system")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference("en")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference("zh-CN")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference(null)).toBe(EN_LOCALE);
  });

  it("resolves browser languages to English", () => {
    expect(resolvePreferredLocale("system", ["zh-CN"])).toBe(EN_LOCALE);
    expect(resolvePreferredLocale("en", ["zh-CN"])).toBe(EN_LOCALE);
    expect(normalizeResolvedLocale("zh-CN")).toBe(EN_LOCALE);
  });

  it("persists only English", () => {
    window.localStorage.clear();
    persistLocalePreference("zh-CN");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(EN_LOCALE);
    expect(getInitialLocalePreference()).toBe(EN_LOCALE);
  });
});
```

- [ ] **Step 2: Replace locale implementation**

Replace `dashboard/src/lib/locale.ts` with:

```ts
export const LOCALE_STORAGE_KEY = "vibedeck-locale";
export const LOCALE_STORAGE_KEY_LEGACY = LOCALE_STORAGE_KEY.replace("vibedeck", "tokentracker");
export const EN_LOCALE = "en";

function safeGetItem(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return false;
  }
  return true;
}

export function normalizeLocalePreference() {
  return EN_LOCALE;
}

export function normalizeResolvedLocale() {
  return EN_LOCALE;
}

export function resolvePreferredLocale() {
  return EN_LOCALE;
}

export function getInitialLocalePreference() {
  if (typeof window === "undefined") return EN_LOCALE;
  const stored = safeGetItem(LOCALE_STORAGE_KEY) || safeGetItem(LOCALE_STORAGE_KEY_LEGACY);
  if (stored !== EN_LOCALE) safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
  return EN_LOCALE;
}

export function persistLocalePreference() {
  return safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
}
```

- [ ] **Step 3: Remove translation imports from copy registry**

In `dashboard/src/lib/copy.ts`, delete these imports:

```ts
import zhCore from "../content/i18n/zh/core.json";
import zhDashboard from "../content/i18n/zh/dashboard.json";
import zhMarketing from "../content/i18n/zh/marketing.json";
```

Replace the locale registry block with:

```ts
const LOCALE_REGISTRIES: Record<string, TranslationRegistry> = {};
```

Keep `setCopyLocale(locale)` but make it resolve to English via `normalizeResolvedLocale(locale)`.

- [ ] **Step 4: Simplify LocaleProvider without changing consumers**

Replace `dashboard/src/ui/foundation/LocaleProvider.jsx` with:

```jsx
import React, { createContext, useCallback, useMemo } from "react";
import { setCopyLocale } from "../../lib/copy";
import { EN_LOCALE, persistLocalePreference } from "../../lib/locale";

export const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  setCopyLocale(EN_LOCALE);

  const setLocale = useCallback(() => {
    persistLocalePreference(EN_LOCALE);
    setCopyLocale(EN_LOCALE);
  }, []);

  const value = useMemo(
    () => ({ locale: EN_LOCALE, resolvedLocale: EN_LOCALE, setLocale }),
    [setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
```

- [ ] **Step 5: Remove language settings UI**

In `dashboard/src/components/settings/AppearanceSection.jsx`, remove:

```jsx
import { Languages, Monitor, Moon, Sun } from "lucide-react";
import { useLocale } from "../../hooks/useLocale.js";
import { EN_LOCALE, SYSTEM_LOCALE, ZH_CN_LOCALE } from "../../lib/locale";
```

Use this import instead:

```jsx
import { Monitor, Moon, Sun } from "lucide-react";
```

Delete `buildLanguageOptions()`, delete `const { locale, setLocale } = useLocale();`, and delete the `SettingsRow` whose label is `settings.appearance.language.label`.

- [ ] **Step 6: Replace LocaleProvider test**

Replace `dashboard/src/ui/foundation/__tests__/LocaleProvider.test.jsx` with:

```jsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocale } from "../../../hooks/useLocale.js";
import { EN_LOCALE } from "../../../lib/locale";
import { LocaleProvider } from "../LocaleProvider.jsx";

function Probe() {
  const { locale, resolvedLocale } = useLocale();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="resolved">{resolvedLocale}</span>
    </div>
  );
}

describe("LocaleProvider", () => {
  it("provides English locale only", () => {
    render(
      <LocaleProvider>
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("locale")).toHaveTextContent(EN_LOCALE);
    expect(screen.getByTestId("resolved")).toHaveTextContent(EN_LOCALE);
  });
});
```

- [ ] **Step 7: Delete zh locale files**

Run:

```bash
git rm dashboard/src/content/i18n/zh/core.json dashboard/src/content/i18n/zh/dashboard.json dashboard/src/content/i18n/zh/marketing.json
```

Expected: three files are staged for deletion.

- [ ] **Step 8: Run dashboard locale tests**

Run:

```bash
rtk npm --prefix dashboard run test -- locale LocaleProvider
```

Expected: PASS for the updated locale tests.

- [ ] **Step 9: Commit dashboard locale cleanup**

Run:

```bash
git add dashboard/src/lib/copy.ts dashboard/src/lib/locale.ts dashboard/src/ui/foundation/LocaleProvider.jsx dashboard/src/components/settings/AppearanceSection.jsx dashboard/src/lib/locale.test.ts dashboard/src/ui/foundation/__tests__/LocaleProvider.test.jsx dashboard/src/content/i18n/zh
git commit -m "refactor: make dashboard locale English only"
```

### Task 4: Remove Native Chinese Strings And Localization Tests

**Files:**
- Modify: `VibeDeckMac/VibeDeckMac/Utilities/Strings.swift`
- Modify: `VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift`
- Modify: `test/localization-regressions.test.js`
- Modify: CJK-positive Swift files returned by the guard test.

- [ ] **Step 1: Replace localization regression test**

Replace `test/localization-regressions.test.js` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(repoPath) {
  return fs.readFileSync(path.join(ROOT, repoPath), "utf8");
}

test("native strings are English-only", () => {
  const strings = read("VibeDeckMac/VibeDeckMac/Utilities/Strings.swift");
  const widgetStrings = read("VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift");
  assert.doesNotMatch(strings, /NativeLocalization\.usesChinese|static var zh|t\("[^"]+",\s*"[^"]+"\)/);
  assert.doesNotMatch(widgetStrings, /NativeLocalization\.usesChinese|static var zh|t\("[^"]+",\s*"[^"]+"\)/);
});

test("native update flags stay unchanged during cleanup", () => {
  const app = read("VibeDeckMac/VibeDeckMac/TokenTrackerBarApp.swift");
  const plist = read("VibeDeckMac/VibeDeckMac/Info.plist");
  const project = read("VibeDeckMac/project.yml");
  assert.doesNotMatch(app, /TokenTrackerEnableSilentAutoUpdate|isSilentAutoUpdateEnabled/);
  assert.doesNotMatch(plist, /TokenTrackerEnableSilentAutoUpdate/);
  assert.doesNotMatch(project, /TokenTrackerEnableSilentAutoUpdate/);
});
```

- [ ] **Step 2: Remove bilingual helper usage from native app strings**

In `VibeDeckMac/VibeDeckMac/Utilities/Strings.swift`, replace every property using `t("English", "...")` with the English string only. Use this pattern:

```swift
static var serverUnavailable: String { "Server Unavailable" }
static var serverStarting: String { "Starting VibeDeck" }
static var serverPreparing: String { "This usually takes a few seconds." }
static var loadingData: String { "Loading data..." }
```

For functions that branch on `zh`, keep the English expression only. Use this pattern:

```swift
static func minutesAgo(_ n: Int) -> String { "\(n)m ago" }
static func hoursAgo(_ n: Int) -> String { "\(n)h ago" }
static func daysAgo(_ n: Int) -> String { "\(n)d ago" }
static func activeDays(_ n: Int) -> String { "\(n) active days" }
static func tokensToday(_ tokens: String) -> String { "Today: \(tokens) tokens" }
```

Remove any `zh` computed property and any `t(_:_:)` helper that is no longer used.

- [ ] **Step 3: Remove bilingual helper usage from widget strings**

In `VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift`, replace every `t("English", "...")` and every `zh ? ... : ...` with English-only values. Use this pattern:

```swift
static var usageName: String { "Usage" }
static var usageDescription: String { "Today's tokens at a glance, with trend." }
static var today: String { "TODAY" }
static var sevenDays: String { "7 DAYS" }
static var thirtyDays: String { "30 DAYS" }
static func streak(_ days: Int) -> String { "\(days)d streak" }
static func minutesAgo(_ minutes: Int) -> String { "\(minutes)m ago" }
static func resetInMinutes(_ minutes: Int) -> String { "in \(minutes)m" }
```

Remove any `zh` computed property and any `t(_:_:)` helper that is no longer used.

- [ ] **Step 4: Translate remaining Chinese comments**

Run:

```bash
rg -n -P "[\x{3400}-\x{9FFF}]" VibeDeckMac src dashboard test scripts copy.jsx README.md
```

For each result that is a comment, replace it with a short English comment or delete it if the code is self-explanatory. For each result that is a runtime string, replace it with English copy.

- [ ] **Step 5: Run native localization tests and guard test**

Run:

```bash
rtk node --test test/localization-regressions.test.js test/vibedeck-cleanup-identity.test.js
```

Expected: the native localization test passes. The guard test may still fail for cloud/share/stale paths until later tasks.

- [ ] **Step 6: Commit native English cleanup**

Run:

```bash
git add VibeDeckMac/VibeDeckMac/Utilities/Strings.swift VibeDeckMac/VibeDeckWidget/Views/WidgetStrings.swift test/localization-regressions.test.js
git add $(rg -l -P "[\x{3400}-\x{9FFF}]" VibeDeckMac src dashboard test scripts README.md || true)
git commit -m "refactor: remove native Chinese localization"
```

### Task 5: Remove Cloud, InsForge, Leaderboard, Share, And Wrapped Code

**Files:**
- Delete: paths listed in the "Cloud, Leaderboard, Share, And Marketing Removal" section.
- Modify: `dashboard/src/lib/api.ts`
- Modify: `dashboard/src/lib/config.ts`
- Modify: `dashboard/src/lib/mock-data.ts`
- Modify: `dashboard/src/components/settings/AccountSection.jsx`
- Modify: `dashboard/src/components/settings/useAccountProfileSettings.js`
- Modify: `dashboard/src/content/copy.csv`
- Modify: `test/model-breakdown.test.js`
- Modify: `test/app-route-pathname-guard.test.js`
- Modify: `test/wrapped-entry.test.js`

- [ ] **Step 1: Write failing assertions for removed cloud files**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: FAIL listing cloud/share files under `REMOVED_PATHS`.

- [ ] **Step 2: Delete cloud/share files**

Run:

```bash
git rm -r BACKEND_API.md dashboard/edge-patches dashboard/src/content/i18n/zh dashboard/share.html dashboard/wrapped-2025.html dashboard/src/ui/marketing/MarketingLanding.jsx docs/screenshots/leaderboard.png
git rm dashboard/src/lib/cloud-sync.ts dashboard/src/lib/cloud-sync-prefs.ts dashboard/src/lib/insforge-config.ts dashboard/src/hooks/use-cloud-usage-sync.ts
git rm scripts/ops/rebuild-cloud-hourly.cjs scripts/ops/repair-cloud-from-queue.cjs scripts/ops/tokentracker-hourly-device-dedup.sql
git rm test/cloud-sync-prefs.test.js test/cloud-sync-rotation.test.js dashboard/src/lib/__tests__/api-public-visibility.test.ts
```

Expected: all listed files are staged for deletion. If `dashboard/src/content/i18n/zh` was already deleted in Task 3, `git rm` may report no match for that path; continue.

- [ ] **Step 3: Simplify local config**

Replace `dashboard/src/lib/config.ts` with:

```ts
export function getBackendBaseUrl() {
  const env = import.meta?.env || {};
  const configured = env?.VITE_VIBEDECK_BACKEND_BASE_URL || env?.VITE_TOKENTRACKER_BACKEND_BASE_URL || "";
  return String(configured || "").replace(/\/+$/, "");
}
```

- [ ] **Step 4: Remove InsForge import and leaderboard exports from API layer**

In `dashboard/src/lib/api.ts`, remove:

```ts
import { getInsforgeRemoteUrl, getInsforgeAnonKey } from "./insforge-config";
```

Delete exported functions whose names are exactly:

```ts
getLeaderboard
getPublicVisibility
setPublicVisibility
refreshLeaderboard
getLeaderboardProfile
```

Keep local dashboard API functions used by `/usage`, `/live`, `/branches`, `/entire`, `/settings`, `/skills`, and `/widgets`.

- [ ] **Step 5: Remove leaderboard mock helpers**

In `dashboard/src/lib/mock-data.ts`, delete the functions:

```ts
computeLeaderboardWindow
getMockLeaderboard
```

Delete their exports and any leaderboard-only mock rows.

- [ ] **Step 6: Remove cloud settings rows**

In `dashboard/src/components/settings/AccountSection.jsx`, remove `CloudSyncRow`, `PublicProfileDetails`, and the `SettingToggleRow` for `settings.account.publicProfile`.

The account section should only render local account/display settings that still exist after `useAccountProfileSettings.js` is simplified.

- [ ] **Step 7: Simplify account profile settings hook**

Replace `dashboard/src/components/settings/useAccountProfileSettings.js` with:

```js
export function useAccountProfileSettings() {
  return {
    name: "Local user",
    github: "",
    saving: false,
    signedIn: true,
    showLocalCloudSync: false,
    cloudSyncOn: false,
    publicProfileOn: false,
    anonymousOn: false,
    canEditName: false,
    handleNameChange: () => {},
    handleNameSave: () => Promise.resolve(),
    handleNameCancel: () => {},
    handleCloudSyncToggle: () => {},
    handlePublicProfileToggle: () => {},
    handleAnonymousToggle: () => {},
    handleGithubChange: () => {},
    handleGithubSave: () => Promise.resolve(),
    handleGithubCancel: () => {},
    handleSignOut: () => Promise.resolve(),
    handleSignIn: () => {},
  };
}
```

- [ ] **Step 8: Remove stale copy rows**

In `dashboard/src/content/copy.csv`, delete rows whose key starts with:

```text
leaderboard.
share.
dashboard.screenshot.
landing.
```

Also delete exact keys:

```text
settings.account.cloudSync
settings.account.cloudSyncHint
settings.account.publicProfile
settings.account.publicProfileHint
settings.account.displayNameAnonymousHint
settings.account.githubUrlHint
```

- [ ] **Step 9: Rewrite model breakdown test to stop depending on edge patches**

In `test/model-breakdown.test.js`, delete tests that read:

```js
../dashboard/edge-patches/tokentracker-leaderboard-refresh.ts
```

Keep pricing tests that validate local API/model pricing. Replace edge-patch parity assertions with a local pricing assertion:

```js
test("local-api pricing includes Kiro model ids", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "src", "lib", "local-api.js"), "utf8");
  assert.match(src, /kiro-agent/i);
  assert.match(src, /kiro-cli-agent/i);
});
```

Adjust the file path if pricing lives in a different local module; do not reintroduce any edge patch dependency.

- [ ] **Step 10: Run cloud/share cleanup tests**

Run:

```bash
rtk node --test test/app-route-pathname-guard.test.js test/wrapped-entry.test.js test/model-breakdown.test.js test/vibedeck-cleanup-identity.test.js
```

Expected: no failures for removed files. The guard test may still fail for TokenTracker product-facing references until Task 6.

- [ ] **Step 11: Build dashboard**

Run:

```bash
rtk npm --prefix dashboard run build
```

Expected: PASS. There should be no import errors for removed InsForge, cloud sync, leaderboard, share, or marketing files.

- [ ] **Step 12: Commit cloud/share removal**

Run:

```bash
git add dashboard/src/lib/api.ts dashboard/src/lib/config.ts dashboard/src/lib/mock-data.ts dashboard/src/components/settings/AccountSection.jsx dashboard/src/components/settings/useAccountProfileSettings.js dashboard/src/content/copy.csv test/model-breakdown.test.js test/app-route-pathname-guard.test.js test/wrapped-entry.test.js dashboard/package.json .github/workflows/npm-publish.yml .github/workflows/release-dmg.yml
git add -u
git commit -m "refactor: remove cloud and share surfaces"
```

### Task 6: Remove Stale Standalone Files And OSS Docs

**Files:**
- Delete: `copy.jsx`
- Delete: `CONTRIBUTING.md`
- Delete: `SECURITY.md`
- Modify: `README.md`
- Modify or delete: `CHANGELOG.md`
- Modify: `.github/ISSUE_TEMPLATE/config.yml`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Confirm `copy.jsx` is orphaned**

Run:

```bash
rg -n "copy\\.jsx|FRONT_FILES" . --glob '!node_modules/**'
```

Expected: only `copy.jsx` and `scripts/ops/pr-retro.cjs` mention it.

- [ ] **Step 2: Remove `copy.jsx` and adjust PR retro script**

Run:

```bash
git rm copy.jsx
```

In `scripts/ops/pr-retro.cjs`, replace:

```js
const FRONT_FILES = ["copy.jsx"];
```

with:

```js
const FRONT_FILES = ["dashboard/src/App.jsx", "dashboard/src/pages/LivePage.jsx"];
```

- [ ] **Step 3: Delete stale OSS docs**

Run:

```bash
git rm CONTRIBUTING.md SECURITY.md
```

If `CHANGELOG.md` is only old TokenTracker release history, remove it:

```bash
git rm CHANGELOG.md
```

If release history is required by the project, replace `CHANGELOG.md` with:

```md
# Changelog

## VibeDeck

VibeDeck is maintained as a local-first dashboard for AI coding-agent cost, session, branch, and Entire checkpoint visibility.
```

- [ ] **Step 4: Rewrite README as VibeDeck local-only docs**

Replace `README.md` with:

```md
# VibeDeck

VibeDeck is a local-first dashboard for AI coding-agent usage, live sessions, branch attribution, model cost, and Entire checkpoint visibility.

## What It Tracks

- Live coding-agent sessions across supported providers.
- Token and cost totals by provider, model, project, branch, and session.
- Branch routing and attribution health.
- Entire repository status and checkpoints.
- macOS menu bar and widget snapshots when the native app is installed.

## Local Data

VibeDeck stores local tracker data under `~/.vibedeck`. It does not need cloud auth, leaderboard sync, or share-card publishing.

## Development

```bash
rtk npm --prefix dashboard run build
rtk node --test test/*.test.js
```

## CLI

```bash
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js serve
```

## Compatibility

Some internal migration code still recognizes legacy TokenTracker data directories and provider hook environment variables so existing local installs can migrate safely.
```

- [ ] **Step 5: Remove or rewrite GitHub issue templates**

If the repository is private/internal, delete issue templates:

```bash
git rm -r .github/ISSUE_TEMPLATE
```

If issue templates are still needed, replace old URLs and labels with VibeDeck text and no TokenTracker links.

- [ ] **Step 6: Update CLAUDE.md consistency**

In `CLAUDE.md`, ensure the guidance says:

```md
VibeDeck is local-first. Cloud auth, InsForge leaderboard sync, public leaderboard pages, share cards, and IP-check surfaces are intentionally removed.
```

Keep the existing warning about not changing parser/pricing math in `src/lib/rollout.js`.

- [ ] **Step 7: Run docs/product identity checks**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: no failures for stale docs or `copy.jsx`. Product-facing TokenTracker failures may remain until Task 7.

- [ ] **Step 8: Commit stale docs cleanup**

Run:

```bash
git add README.md CLAUDE.md scripts/ops/pr-retro.cjs .github/ISSUE_TEMPLATE CHANGELOG.md
git add -u
git commit -m "docs: remove stale OSS and cloud documentation"
```

### Task 7: Rename Product-Facing TokenTracker References

**Files:**
- Modify: `bin/vibedeck.js`
- Modify: `src/commands/init.js`
- Modify: `src/commands/activate-if-needed.js`
- Modify: `src/lib/activation-check.js`
- Modify: `src/lib/opencode-config.js`
- Modify: `src/lib/skills-manager.js`
- Modify: `dashboard/index.html`
- Modify: `dashboard/src/lib/npm-version.ts`
- Modify: `dashboard/src/lib/native-bridge.js`
- Modify: `dashboard/src/lib/auth-storage.ts`
- Modify: `dashboard/src/lib/auth-redirect.ts`
- Modify: `dashboard/src/components/settings/MenuBarSection.jsx`
- Modify: `dashboard/src/ui/matrix-a/components/MacAppBanner.jsx`
- Modify: `dashboard/src/ui/matrix-a/components/WidgetOnboardingCard.jsx`
- Modify: `dashboard/src/ui/matrix-a/components/UpgradeAlertModal.jsx`
- Modify: `VibeDeckMac/scripts/bundle-node.sh`
- Modify: `VibeDeckMac/scripts/generate_dmg_bg.swift`
- Modify: `VibeDeckMac/VibeDeckMac/Views/UsageLimitsView.swift`
- Modify: `test/cli-help.test.js`
- Modify: `test/init-uninstall.test.js`

- [ ] **Step 1: Run product identity scan**

Run:

```bash
rtk node --test test/vibedeck-cleanup-identity.test.js
```

Expected: FAIL listing product-facing TokenTracker references outside the allowlist.

- [ ] **Step 2: Add VibeDeck env aliases before removing visible names**

In files that read `TOKENTRACKER_*` env vars, add `VIBEDECK_*` as primary and keep `TOKENTRACKER_*` as fallback. Use this pattern:

```js
const debug = process.env.VIBEDECK_DEBUG || process.env.TOKENTRACKER_DEBUG;
```

Do not remove `TOKENTRACKER_*` from provider hook compatibility tests in this task.

- [ ] **Step 3: Rename CLI visible copy**

In `src/commands/init.js`, replace visible package/default URL text:

```js
const DEFAULT_DASHBOARD_URL = "http://127.0.0.1:7690";
```

Replace `packageName: "tokentracker"` with:

```js
packageName: "vibedeck"
```

In `src/commands/activate-if-needed.js` and `src/lib/activation-check.js`, replace user-facing output with English VibeDeck text:

```js
console.log("All AI CLI integrations are already configured");
console.log(`Configured ${cli.displayName} integration`);
console.log(`Detected ${cli.displayName} is not configured. Run 'vibedeck init' to configure it.`);
```

- [ ] **Step 4: Rename OpenCode plugin product files carefully**

In `src/lib/opencode-config.js`, change product-facing constants:

```js
const DEFAULT_PLUGIN_NAME = "vibedeck.js";
const PLUGIN_MARKER = "VIBEDECK_PLUGIN";
```

Update generated plugin export:

```js
`export const VibeDeckPlugin = async ({ $ }) => {\n`
```

Then update `test/init-uninstall.test.js` expectations from `tokentracker.js` and `TOKENTRACKER_PLUGIN` to `vibedeck.js` and `VIBEDECK_PLUGIN`.

- [ ] **Step 5: Rename dashboard browser storage keys with legacy migration**

For browser storage keys in dashboard files, use VibeDeck keys but read legacy TokenTracker keys when preserving user settings. Use this pattern:

```js
const STORAGE_KEY = "vibedeck.dashboard.auth.v1";
const STORAGE_KEY_LEGACY = "tokentracker.dashboard.auth.v1";
```

When loading, read `STORAGE_KEY` first and `STORAGE_KEY_LEGACY` second. When writing, write only the VibeDeck key.

- [ ] **Step 6: Rename dashboard HTML metadata**

In `dashboard/index.html`, replace TokenTracker JSON-LD and seed copy with VibeDeck local-only dashboard metadata. Keep the root app mounting markup unchanged.

Use:

```html
<title>VibeDeck</title>
<meta name="description" content="Local-first dashboard for AI coding-agent sessions, tokens, cost, branches, and Entire checkpoints." />
```

Remove leaderboard, IP-check, old GitHub, old npm, and old Homebrew links from the seed content.

- [ ] **Step 7: Rename native bundle source labels**

In `VibeDeckMac/scripts/bundle-node.sh`, replace the embedded source directory:

```bash
VD_DIR="$EMBED_DIR/vibedeck"
```

Update every reference from `$TT_DIR` to `$VD_DIR`.

In `VibeDeckMac/VibeDeckMac/Views/UsageLimitsView.swift`, replace:

```swift
"EmbeddedServer/tokentracker/dashboard/dist/brand-logos/\(filename)"
```

with:

```swift
"EmbeddedServer/vibedeck/dashboard/dist/brand-logos/\(filename)"
```

- [ ] **Step 8: Rename DMG background visible label**

In `VibeDeckMac/scripts/generate_dmg_bg.swift`, replace the drawn text:

```swift
("VIBEDECK" as NSString).draw(
```

Also update the file header comment to `DMG Background for VibeDeckMac`.

- [ ] **Step 9: Run focused identity tests**

Run:

```bash
rtk node --test test/cli-help.test.js test/init-uninstall.test.js test/vibedeck-paths-and-port.test.js test/vibedeck-cleanup-identity.test.js
```

Expected: PASS except any explicitly allowed TokenTracker compatibility references.

- [ ] **Step 10: Commit product rename cleanup**

Run:

```bash
git add bin/vibedeck.js src/commands/init.js src/commands/activate-if-needed.js src/lib/activation-check.js src/lib/opencode-config.js src/lib/skills-manager.js dashboard/index.html dashboard/src/lib/npm-version.ts dashboard/src/lib/native-bridge.js dashboard/src/lib/auth-storage.ts dashboard/src/lib/auth-redirect.ts dashboard/src/components/settings/MenuBarSection.jsx dashboard/src/ui/matrix-a/components/MacAppBanner.jsx dashboard/src/ui/matrix-a/components/WidgetOnboardingCard.jsx dashboard/src/ui/matrix-a/components/UpgradeAlertModal.jsx VibeDeckMac/scripts/bundle-node.sh VibeDeckMac/scripts/generate_dmg_bg.swift VibeDeckMac/VibeDeckMac/Views/UsageLimitsView.swift test/cli-help.test.js test/init-uninstall.test.js
git commit -m "refactor: remove product-facing TokenTracker identity"
```

### Task 8: Update Copy Registry And UI Hardcode Validation

**Files:**
- Modify: `dashboard/src/content/copy.csv`
- Modify: `scripts/ops/ui-hardcode-baseline.json`
- Modify: `test/validate-ui-hardcode.test.js`
- Modify: `scripts/ops/validate-ui-hardcode-lib.cjs`

- [ ] **Step 1: Replace Chinese fixture in UI hardcode test**

In `test/validate-ui-hardcode.test.js`, replace the CJK fixture with ASCII:

```js
const tokens = extractJsxTextTokens("<div>123</div><span>plain</span><p>abc</p>");
assert.deepEqual(tokens, ["123", "plain", "abc"]);
```

- [ ] **Step 2: Refresh hardcode baseline after Chinese/comment cleanup**

Run:

```bash
node scripts/ops/validate-ui-hardcode.cjs --write-baseline
```

Expected: `scripts/ops/ui-hardcode-baseline.json` changes and contains no CJK characters.

- [ ] **Step 3: Remove stale copy rows**

Run:

```bash
rg -n "Token Tracker|TokenTracker|tokentracker|leaderboard|Cloud sync|Public profile|share card|Wrapped|landing" dashboard/src/content/copy.csv
```

Delete rows that are product-facing stale copy. Keep rows only if the corresponding route/component still exists after Tasks 5 and 7.

- [ ] **Step 4: Run copy and hardcode tests**

Run:

```bash
rtk node --test test/validate-ui-hardcode.test.js test/copy-top-models-title.test.js test/copy-usage-upgrade.test.js test/vibedeck-cleanup-identity.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit copy registry cleanup**

Run:

```bash
git add dashboard/src/content/copy.csv scripts/ops/ui-hardcode-baseline.json test/validate-ui-hardcode.test.js scripts/ops/validate-ui-hardcode-lib.cjs
git commit -m "chore: clean VibeDeck copy registry"
```

### Task 9: Full Build, Test, And Runtime Smoke

**Files:**
- No planned source edits unless verification exposes missed imports.

- [ ] **Step 1: Run backend/unit tests**

Run:

```bash
rtk node --test test/*.test.js
```

Expected: PASS. If failures are unrelated to cleanup, record exact failing test names and fix only if the failure is caused by a cleanup task.

- [ ] **Step 2: Run dashboard tests**

Run:

```bash
rtk npm --prefix dashboard run test
```

Expected: PASS.

- [ ] **Step 3: Build dashboard**

Run:

```bash
rtk npm --prefix dashboard run build
```

Expected: PASS with no missing copy key warnings for removed landing/share metadata.

- [ ] **Step 4: Run cleanup scans**

Run:

```bash
rg -n -P "[\x{3400}-\x{9FFF}]" README.md src dashboard VibeDeckMac test scripts .github docs copy.jsx
```

Expected: no output.

Run:

```bash
rg -n "InsForge|insforge|leaderboard|cloud sync|cloud_sync|share card|Wrapped|TokenTracker|Token Tracker|tokentracker|TokenTrackerBar" README.md src dashboard VibeDeckMac test scripts .github CLAUDE.md
```

Expected: only compatibility allowlist references remain. Any other output must be removed or added to `TOKEN_TRACKER_ALLOWLIST` only if it protects migration or old installed hooks.

- [ ] **Step 5: Run local CLI smoke**

Run:

```bash
rtk node bin/vibedeck.js --help
rtk node bin/vibedeck.js doctor
```

Expected: commands run and print VibeDeck names, not TokenTracker product names.

- [ ] **Step 6: Start server smoke**

Run:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

Expected: server starts on `http://127.0.0.1:7690`. Stop it after confirming the startup log.

- [ ] **Step 7: Commit verification fixes**

If verification required code fixes, commit them:

```bash
git add .
git commit -m "test: verify VibeDeck cleanup stabilization"
```

If verification required no code fixes, do not create an empty commit.

---

## Self-Review

### Spec Coverage

- Chinese removal is covered by Tasks 1, 3, 4, 8, and 9.
- Stale tests are covered by Tasks 3, 4, 5, 7, and 8.
- Stale docs are covered by Task 6.
- Cloud/InsForge/leaderboard/share/wrapped cleanup is covered by Task 5.
- TokenTracker to VibeDeck visible rename is covered by Tasks 2, 6, and 7.
- Compatibility safety is covered by the explicit allowlist and by keeping migration/provider-hook tests.
- Verification is covered by Task 9.

### Placeholder Scan

This plan avoids open-ended placeholders. Cleanup loops use guard tests and exact search commands to produce concrete file lists during execution.

### Type And Name Consistency

The plan consistently uses `vibedeck-cli`, `VibeDeck`, `VibeDeckMac`, `VibeDeckWidget`, `VIBEDECK_PLUGIN`, and `vibedeck.js` for new product identity. Legacy `TokenTracker` names are retained only in the compatibility allowlist.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-11-vibedeck-cleanup-stabilization.md`. Two execution options:

1. **Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

2. **Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

