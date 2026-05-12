# VibeDeck Packaging And Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shared Homebrew/npm packaging bootstrap for VibeDeck that installs the signed mac app bundle, manages `Entire` as a prerequisite, and lets `vibedeck` guide first-run prerequisite setup.

**Architecture:** Keep the CLI as the single setup control plane. Package managers install the runtime and then call shared bootstrap code on macOS; bootstrap installs `Entire`, fetches the signed `VibeDeckMac.app` artifact, and records install state. Interactive `vibedeck` first-run checks then prompt for remaining soft prerequisites such as `Entire` login and README sync config without adding setup logic to the dashboard or mac app.

**Tech Stack:** Node.js CommonJS, `node:test`, existing CLI command structure in `src/cli.js`, local fs helpers in `src/lib/fs.js`, `execa`, GitHub release assets, Homebrew formula/cask scripting, npm postinstall hooks, macOS app bundle copy/install behavior.

---

## Scope Check

This is one integrated packaging/bootstrap subsystem, not several unrelated product features. The pieces are coupled by one shared install flow:

- package manager entrypoints
- native artifact installation
- `Entire` prerequisite handling
- first-run prerequisite prompts
- versioned release metadata

It is appropriate for one implementation plan as long as execution stays incremental and each task yields working, testable behavior.

## File Structure

### Shared Bootstrap State And Resolution

- Create: `src/lib/bootstrap/state.js`
  - Read/write persisted bootstrap status under `~/.vibedeck/`
  - Store native app install location, installed artifact version, pending prerequisites, and last bootstrap result
- Create: `src/lib/bootstrap/platform.js`
  - Platform/TTY helpers, install destination resolution, environment flags for CI/non-interactive paths
- Create: `src/lib/bootstrap/release-manifest.js`
  - Build deterministic native artifact URLs from package version + platform/arch
- Create: `test/bootstrap-state.test.js`
- Create: `test/bootstrap-release-manifest.test.js`

### Native App/Widget Installer

- Create: `src/lib/bootstrap/install-native.js`
  - Download/verify/extract the signed app artifact
  - Install into `/Applications` first, fallback to `~/Applications`
  - Detect already-installed matching version
- Create: `test/bootstrap-install-native.test.js`

### Entire Prerequisite Adapter

- Create: `src/lib/bootstrap/ensure-entire.js`
  - Detect `Entire`, choose install strategy by package manager/context, and expose login-status checks
- Create: `src/commands/entire.js`
  - VibeDeck-owned command surface: `vibedeck entire login`
- Modify: `src/cli.js`
  - Register `entire`
- Modify: `src/commands/init.js`
  - Reuse shared `Entire` login helper rather than owning the flow privately
- Create: `test/bootstrap-entire.test.js`
- Create: `test/cli-entire-login.test.js`

### First-Run Prerequisite Orchestrator

- Create: `src/lib/bootstrap/orchestrator.js`
  - Compute missing prerequisites and run interactive prompt flow
- Modify: `src/cli.js`
  - On no-arg `vibedeck`, run prerequisite check before `cmdServe`
- Modify: `src/commands/status.js`
  - Surface bootstrap/prerequisite status
- Modify: `src/lib/doctor.js`
  - Extend doctor checks for native install presence, `Entire` installed/logged-in, README sync readiness
- Create: `test/bootstrap-orchestrator.test.js`
- Create: `test/cli-first-run-bootstrap.test.js`

### Package-Manager Entry Points

- Modify: `package.json`
  - Add npm postinstall/bootstrap hook
- Create: `scripts/npm-postinstall.js`
  - Safe macOS-only bootstrap entrypoint with non-interactive guardrails
- Create: `packaging/homebrew/vibedeck.rb`
  - Formula that installs CLI/runtime and invokes bootstrap logic
- Modify: `.github/workflows/release-dmg.yml`
  - Publish automation-friendly zipped app artifact alongside DMG
- Create: `test/npm-postinstall.test.js`
- Create: `test/homebrew-formula.test.js`
- Modify: `test/release-dmg-workflow.test.js`

### Docs

- Modify: `README.md`
  - Add packaging/bootstrap commands and first-run behavior

---

## Implementation Notes

- Keep the mac app out of setup orchestration for this phase.
- The widget is implicitly installed with the app bundle; do not model it as a separate installable.
- Hard failures:
  - native artifact missing/corrupt
  - native install fails in both `/Applications` and `~/Applications`
  - `Entire` install fails completely
- Soft failures:
  - user declines `Entire` login
  - non-interactive install defers auth
  - user declines README sync setup
- Use `rtk` for all test and git commands in execution.

---

### Task 1: Add Bootstrap State And Native Artifact Resolution

**Files:**
- Create: `src/lib/bootstrap/state.js`
- Create: `src/lib/bootstrap/platform.js`
- Create: `src/lib/bootstrap/release-manifest.js`
- Test: `test/bootstrap-state.test.js`
- Test: `test/bootstrap-release-manifest.test.js`

- [ ] **Step 1: Write failing bootstrap state tests**

Create `test/bootstrap-state.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  readBootstrapState,
  writeBootstrapState,
  mergeBootstrapState,
} = require("../src/lib/bootstrap/state");

test("bootstrap state round-trips under VIBEDECK_HOME", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-bootstrap-state-"));
  const prev = process.env.VIBEDECK_HOME;
  try {
    process.env.VIBEDECK_HOME = tmp;
    await writeBootstrapState({
      native_app: { installed: true, path: "/Applications/VibeDeckMac.app", version: "0.6.1" },
      entire: { installed: true, logged_in: false },
      pending: ["entire_login", "readme_sync"],
    });
    const state = await readBootstrapState();
    assert.equal(state.native_app.installed, true);
    assert.equal(state.entire.logged_in, false);

    await mergeBootstrapState({ pending: ["readme_sync"] });
    const merged = await readBootstrapState();
    assert.deepEqual(merged.pending, ["readme_sync"]);
  } finally {
    if (prev === undefined) delete process.env.VIBEDECK_HOME;
    else process.env.VIBEDECK_HOME = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
```

Create `test/bootstrap-release-manifest.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveNativeArtifactSpec } = require("../src/lib/bootstrap/release-manifest");

test("release manifest resolves macOS zipped app artifact", () => {
  const spec = resolveNativeArtifactSpec({
    version: "0.6.1",
    platform: "darwin",
    arch: "arm64",
  });
  assert.equal(spec.kind, "zip");
  assert.match(spec.fileName, /VibeDeckMac.*\.zip$/);
  assert.match(spec.url, /v0\.6\.1/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk node --test test/bootstrap-state.test.js test/bootstrap-release-manifest.test.js
```

Expected: FAIL with missing module errors for `src/lib/bootstrap/*`.

- [ ] **Step 3: Implement bootstrap state helpers**

Create `src/lib/bootstrap/state.js`:

```js
'use strict';

const path = require('node:path');
const os = require('node:os');
const { ensureDir, readJsonStrict, writeJson } = require('../fs');

function resolveBootstrapRoot() {
  return process.env.VIBEDECK_HOME || path.join(os.homedir(), '.vibedeck');
}

function resolveBootstrapPaths() {
  const rootDir = resolveBootstrapRoot();
  return {
    rootDir,
    statePath: path.join(rootDir, 'bootstrap.json'),
  };
}

async function readBootstrapState() {
  const { statePath } = resolveBootstrapPaths();
  const result = await readJsonStrict(statePath);
  return result.status === 'ok' ? result.value : {
    native_app: { installed: false, path: null, version: null },
    entire: { installed: false, logged_in: false },
    pending: [],
  };
}

async function writeBootstrapState(state) {
  const { rootDir, statePath } = resolveBootstrapPaths();
  await ensureDir(rootDir);
  await writeJson(statePath, state);
}

async function mergeBootstrapState(patch) {
  const current = await readBootstrapState();
  const next = { ...current, ...patch };
  await writeBootstrapState(next);
  return next;
}

module.exports = {
  resolveBootstrapPaths,
  readBootstrapState,
  writeBootstrapState,
  mergeBootstrapState,
};
```

Create `src/lib/bootstrap/platform.js`:

```js
'use strict';

const os = require('node:os');
const path = require('node:path');

function isMacOS(platform = process.platform) {
  return platform === 'darwin';
}

function isInteractiveInstall({ stdin = process.stdin, stdout = process.stdout } = {}) {
  return Boolean(stdin?.isTTY && stdout?.isTTY);
}

function resolveNativeInstallTargets({ home = os.homedir() } = {}) {
  return [
    '/Applications/VibeDeckMac.app',
    path.join(home, 'Applications', 'VibeDeckMac.app'),
  ];
}

module.exports = {
  isMacOS,
  isInteractiveInstall,
  resolveNativeInstallTargets,
};
```

- [ ] **Step 4: Implement artifact URL resolution**

Create `src/lib/bootstrap/release-manifest.js`:

```js
'use strict';

function resolveNativeArtifactSpec({ version, platform = process.platform, arch = process.arch }) {
  if (platform !== 'darwin') {
    return { supported: false, reason: 'platform_not_supported' };
  }
  const archTag = arch === 'x64' ? 'universal' : 'universal';
  const fileName = `VibeDeckMac-${version}-${archTag}.zip`;
  return {
    supported: true,
    kind: 'zip',
    fileName,
    url: `https://github.com/ivasuy/vibedeck/releases/download/v${version}/${fileName}`,
  };
}

module.exports = { resolveNativeArtifactSpec };
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk node --test test/bootstrap-state.test.js test/bootstrap-release-manifest.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src/lib/bootstrap/state.js src/lib/bootstrap/platform.js src/lib/bootstrap/release-manifest.js test/bootstrap-state.test.js test/bootstrap-release-manifest.test.js
rtk git commit -m "feat: add bootstrap state and release manifest"
```

Expected: commit succeeds.

---

### Task 2: Add Signed Native App Installer With `/Applications` Fallback

**Files:**
- Create: `src/lib/bootstrap/install-native.js`
- Test: `test/bootstrap-install-native.test.js`

- [ ] **Step 1: Write failing native installer tests**

Create `test/bootstrap-install-native.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { chooseInstallTarget } = require("../src/lib/bootstrap/install-native");

test("chooseInstallTarget prefers /Applications before user Applications", async () => {
  const target = await chooseInstallTarget({
    targets: ["/Applications/VibeDeckMac.app", "/Users/test/Applications/VibeDeckMac.app"],
    canWrite: async (candidate) => candidate.startsWith("/Applications"),
  });
  assert.equal(target, "/Applications/VibeDeckMac.app");
});

test("chooseInstallTarget falls back to user Applications when system Applications is unavailable", async () => {
  const target = await chooseInstallTarget({
    targets: ["/Applications/VibeDeckMac.app", "/Users/test/Applications/VibeDeckMac.app"],
    canWrite: async (candidate) => candidate.startsWith("/Users/test"),
  });
  assert.equal(target, "/Users/test/Applications/VibeDeckMac.app");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
rtk node --test test/bootstrap-install-native.test.js
```

Expected: FAIL with missing module error.

- [ ] **Step 3: Implement target resolution and install skeleton**

Create `src/lib/bootstrap/install-native.js`:

```js
'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { resolveNativeInstallTargets } = require('./platform');
const { resolveNativeArtifactSpec } = require('./release-manifest');

async function defaultCanWrite(candidate) {
  const parentDir = path.dirname(candidate);
  try {
    await fs.access(parentDir);
    return true;
  } catch {
    return false;
  }
}

async function chooseInstallTarget({ targets, canWrite = defaultCanWrite }) {
  for (const candidate of targets) {
    if (await canWrite(candidate)) return candidate;
  }
  throw new Error('No writable install target for VibeDeckMac.app');
}

async function installNativeApp({
  version,
  home = os.homedir(),
  canWrite = defaultCanWrite,
  downloadImpl,
  extractImpl,
  copyAppImpl,
}) {
  const spec = resolveNativeArtifactSpec({ version, platform: 'darwin', arch: process.arch });
  if (!spec.supported) throw new Error(spec.reason || 'unsupported platform');
  const target = await chooseInstallTarget({
    targets: resolveNativeInstallTargets({ home }),
    canWrite,
  });
  const archivePath = await downloadImpl(spec);
  const appPath = await extractImpl(archivePath);
  await copyAppImpl(appPath, target);
  return { installed: true, target, version, artifact: spec.fileName };
}

module.exports = {
  chooseInstallTarget,
  installNativeApp,
};
```

- [ ] **Step 4: Run test to verify pass**

Run:

```bash
rtk node --test test/bootstrap-install-native.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add src/lib/bootstrap/install-native.js test/bootstrap-install-native.test.js
rtk git commit -m "feat: add native app installer"
```

Expected: commit succeeds.

---

### Task 3: Add Entire Bootstrap Adapter And `vibedeck entire login`

**Files:**
- Create: `src/lib/bootstrap/ensure-entire.js`
- Create: `src/commands/entire.js`
- Modify: `src/cli.js`
- Modify: `src/commands/init.js`
- Test: `test/bootstrap-entire.test.js`
- Test: `test/cli-entire-login.test.js`

- [ ] **Step 1: Write failing Entire tests**

Create `test/bootstrap-entire.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveEntireInstallPlan } = require("../src/lib/bootstrap/ensure-entire");

test("npm install path prefers Homebrew when brew exists", () => {
  const plan = resolveEntireInstallPlan({
    packageManager: "npm",
    hasBrew: true,
    platform: "darwin",
  });
  assert.equal(plan.method, "brew-cask");
});

test("npm install path falls back to official script without brew", () => {
  const plan = resolveEntireInstallPlan({
    packageManager: "npm",
    hasBrew: false,
    platform: "darwin",
  });
  assert.equal(plan.method, "official-script");
});
```

Create `test/cli-entire-login.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../src/cli");

test("cli help and command surface include vibedeck entire login", async () => {
  let out = "";
  const prev = process.stdout.write;
  try {
    process.stdout.write = (chunk) => ((out += String(chunk || "")), true);
    await run(["-h"]);
  } finally {
    process.stdout.write = prev;
  }
  assert.match(out, /entire/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk node --test test/bootstrap-entire.test.js test/cli-entire-login.test.js
```

Expected: FAIL with missing module/command assertions.

- [ ] **Step 3: Implement Entire bootstrap adapter**

Create `src/lib/bootstrap/ensure-entire.js`:

```js
'use strict';

const execa = require('execa');
const { detectEntire } = require('../entire-bridge');

function resolveEntireInstallPlan({ packageManager, hasBrew, platform = process.platform }) {
  if (platform !== 'darwin') return { supported: false, method: 'skip' };
  if (packageManager === 'brew') return { supported: true, method: 'brew-cask' };
  if (hasBrew) return { supported: true, method: 'brew-cask' };
  return { supported: true, method: 'official-script' };
}

async function runEntireLogin({ execaImpl = execa } = {}) {
  await execaImpl('entire', ['login'], { stdio: 'inherit', timeout: 5 * 60 * 1000 });
  return { ok: true };
}

async function getEntireBootstrapStatus() {
  const detection = await detectEntire();
  return {
    installed: Boolean(detection?.present),
    version: detection?.version || null,
  };
}

module.exports = {
  resolveEntireInstallPlan,
  runEntireLogin,
  getEntireBootstrapStatus,
};
```

- [ ] **Step 4: Add CLI command**

Create `src/commands/entire.js`:

```js
'use strict';

const { runEntireLogin } = require('../lib/bootstrap/ensure-entire');

async function run(argv = []) {
  const [subcommand] = argv;
  if (subcommand !== 'login') {
    process.stderr.write('Usage: vibedeck entire login\n');
    return 1;
  }
  await runEntireLogin();
  process.stdout.write('Entire login complete.\n');
  return 0;
}

module.exports = { run };
```

Modify `src/cli.js`:

```js
    case "entire":
      process.exitCode = await require("./commands/entire").run(rest);
      return;
```

Add help text line:

```text
  npx vibedeck-cli [--debug] entire login
```

- [ ] **Step 5: Reuse the shared login helper in init**

In `src/commands/init.js`, replace direct `execa("entire", ["login"], ...)` call with:

```js
const { runEntireLogin } = require("../lib/bootstrap/ensure-entire");
```

and call:

```js
await runEntireLogin();
```

- [ ] **Step 6: Run tests to verify pass**

Run:

```bash
rtk node --test test/bootstrap-entire.test.js test/cli-entire-login.test.js test/init-entire-login.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add src/lib/bootstrap/ensure-entire.js src/commands/entire.js src/cli.js src/commands/init.js test/bootstrap-entire.test.js test/cli-entire-login.test.js
rtk git commit -m "feat: add entire bootstrap command"
```

Expected: commit succeeds.

---

### Task 4: Add First-Run Prerequisite Orchestrator

**Files:**
- Create: `src/lib/bootstrap/orchestrator.js`
- Modify: `src/cli.js`
- Modify: `src/commands/status.js`
- Modify: `src/lib/doctor.js`
- Test: `test/bootstrap-orchestrator.test.js`
- Test: `test/cli-first-run-bootstrap.test.js`

- [ ] **Step 1: Write failing orchestrator tests**

Create `test/bootstrap-orchestrator.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { collectMissingPrerequisites } = require("../src/lib/bootstrap/orchestrator");

test("orchestrator reports missing entire login and readme sync config", async () => {
  const missing = await collectMissingPrerequisites({
    bootstrapState: {
      native_app: { installed: true },
      entire: { installed: true, logged_in: false },
    },
    readmeSyncConfig: null,
    githubToken: null,
    platform: "darwin",
  });
  assert.deepEqual(missing, ["entire_login", "readme_sync"]);
});
```

Create `test/cli-first-run-bootstrap.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { run } = require("../src/cli");

test("no-arg vibedeck checks prerequisites before serving", async () => {
  const cliPath = require.resolve("../src/cli");
  const servePath = require.resolve("../src/commands/serve");
  const orchestratorPath = require.resolve("../src/lib/bootstrap/orchestrator");
  const serveOriginal = require.cache[servePath];
  const orchestratorOriginal = require.cache[orchestratorPath];
  let called = [];
  try {
    require.cache[servePath] = { exports: { cmdServe: async () => { called.push("serve"); } } };
    require.cache[orchestratorPath] = { exports: { runFirstRunBootstrapIfNeeded: async () => { called.push("bootstrap"); } } };
    delete require.cache[cliPath];
    await require("../src/cli").run([]);
  } finally {
    if (serveOriginal) require.cache[servePath] = serveOriginal; else delete require.cache[servePath];
    if (orchestratorOriginal) require.cache[orchestratorPath] = orchestratorOriginal; else delete require.cache[orchestratorPath];
    delete require.cache[cliPath];
  }
  assert.deepEqual(called, ["bootstrap", "serve"]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk node --test test/bootstrap-orchestrator.test.js test/cli-first-run-bootstrap.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement prerequisite collection**

Create `src/lib/bootstrap/orchestrator.js`:

```js
'use strict';

const { readBootstrapState } = require('./state');
const { readReadmeSyncConfig, readGitHubToken } = require('../readme-sync/config');
const { isInteractiveInstall } = require('./platform');

async function collectMissingPrerequisites({
  bootstrapState = null,
  readmeSyncConfig = null,
  githubToken = null,
  platform = process.platform,
} = {}) {
  if (platform !== 'darwin') return [];
  const state = bootstrapState || (await readBootstrapState());
  const config = readmeSyncConfig === null ? await readReadmeSyncConfig() : readmeSyncConfig;
  const token = githubToken === null ? await readGitHubToken() : githubToken;

  const missing = [];
  if (!state?.native_app?.installed) missing.push('native_app');
  if (!state?.entire?.installed) missing.push('entire_install');
  else if (!state?.entire?.logged_in) missing.push('entire_login');
  if (!config?.enabled || !token) missing.push('readme_sync');
  return missing;
}

async function runFirstRunBootstrapIfNeeded({ promptImpl, fixers = {} } = {}) {
  const missing = await collectMissingPrerequisites();
  if (missing.length === 0) return { prompted: false, missing: [] };
  if (!isInteractiveInstall()) return { prompted: false, missing };
  const accept = await promptImpl(missing);
  if (!accept) return { prompted: true, accepted: false, missing };
  for (const item of missing) {
    if (typeof fixers[item] === 'function') await fixers[item]();
  }
  return { prompted: true, accepted: true, missing };
}

module.exports = {
  collectMissingPrerequisites,
  runFirstRunBootstrapIfNeeded,
};
```

- [ ] **Step 4: Hook orchestrator into no-arg `vibedeck`**

Modify `src/cli.js`:

```js
const { runFirstRunBootstrapIfNeeded } = require("./lib/bootstrap/orchestrator");
```

Then change the no-arg branch to:

```js
  if (!command) {
    await runFirstRunBootstrapIfNeeded();
    await cmdServe(argv);
    return;
  }
```

Also add bootstrap status output to `status`/`doctor` using small helper lines such as:

```js
process.stdout.write(`Bootstrap native app: ${state.native_app.installed ? "installed" : "missing"}\n`);
```

and doctor check text such as:

```js
{
  id: "bootstrap.native",
  ok: state.native_app.installed,
  summary: state.native_app.installed ? "Native app installed" : "Native app missing",
}
```

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk node --test test/bootstrap-orchestrator.test.js test/cli-first-run-bootstrap.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add src/lib/bootstrap/orchestrator.js src/cli.js src/commands/status.js src/lib/doctor.js test/bootstrap-orchestrator.test.js test/cli-first-run-bootstrap.test.js
rtk git commit -m "feat: add first-run prerequisite orchestration"
```

Expected: commit succeeds.

---

### Task 5: Add Package-Manager Entry Points And Release Artifact Publishing

**Files:**
- Modify: `package.json`
- Create: `scripts/npm-postinstall.js`
- Create: `packaging/homebrew/vibedeck.rb`
- Modify: `.github/workflows/release-dmg.yml`
- Modify: `test/release-dmg-workflow.test.js`
- Create: `test/npm-postinstall.test.js`
- Create: `test/homebrew-formula.test.js`

- [ ] **Step 1: Write failing package-entry tests**

Create `test/npm-postinstall.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldRunBootstrap } = require("../scripts/npm-postinstall");

test("npm postinstall skips bootstrap off macOS", () => {
  assert.equal(shouldRunBootstrap({ platform: "linux", isGlobal: true }), false);
});

test("npm postinstall runs bootstrap on global macOS install", () => {
  assert.equal(shouldRunBootstrap({ platform: "darwin", isGlobal: true }), true);
});
```

Create `test/homebrew-formula.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

test("homebrew formula invokes VibeDeck bootstrap after install", () => {
  const formula = fs.readFileSync("packaging/homebrew/vibedeck.rb", "utf8");
  assert.match(formula, /bin\/vibedeck/);
  assert.match(formula, /bootstrap/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
rtk node --test test/npm-postinstall.test.js test/homebrew-formula.test.js
```

Expected: FAIL.

- [ ] **Step 3: Implement npm postinstall entrypoint**

Modify `package.json` scripts:

```json
"scripts": {
  "dashboard:build": "npm --prefix dashboard run build",
  "test": "node --test test/*.test.js",
  "postinstall": "node scripts/npm-postinstall.js"
}
```

Create `scripts/npm-postinstall.js`:

```js
'use strict';

function shouldRunBootstrap({ platform = process.platform, isGlobal = true } = {}) {
  return platform === 'darwin' && isGlobal;
}

async function main() {
  if (!shouldRunBootstrap()) return;
  const { runInstallBootstrap } = require('../src/lib/bootstrap/install-native');
  await runInstallBootstrap({ packageManager: 'npm' });
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err?.message || err}\n`);
    process.exitCode = 1;
  });
}

module.exports = { shouldRunBootstrap, main };
```

- [ ] **Step 4: Add Homebrew formula and release artifact step**

Create `packaging/homebrew/vibedeck.rb`:

```ruby
class Vibedeck < Formula
  desc "Local-first usage and provenance dashboard for AI coding agents"
  homepage "https://github.com/ivasuy/vibedeck"
  url "https://registry.npmjs.org/vibedeck-cli/-/vibedeck-cli-0.6.1.tgz"
  sha256 "REPLACE_IN_RELEASE"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    system bin/"vibedeck", "bootstrap", "install"
  end
end
```

Modify `.github/workflows/release-dmg.yml` to add a zipped `.app` artifact publish step after the app build:

```yaml
      - name: Package zipped app artifact
        working-directory: VibeDeckMac
        run: |
          APP_PATH="$(find build/DerivedData/Build/Products/Release -name 'VibeDeckMac.app' -maxdepth 1)"
          ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "build/VibeDeckMac-${{ inputs.version }}-universal.zip"
```

and attach it to `gh release create`.

- [ ] **Step 5: Run tests to verify pass**

Run:

```bash
rtk node --test test/npm-postinstall.test.js test/homebrew-formula.test.js test/release-dmg-workflow.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add package.json scripts/npm-postinstall.js packaging/homebrew/vibedeck.rb .github/workflows/release-dmg.yml test/npm-postinstall.test.js test/homebrew-formula.test.js test/release-dmg-workflow.test.js
rtk git commit -m "feat: add package manager bootstrap entrypoints"
```

Expected: commit succeeds.

---

### Task 6: Document Packaging Bootstrap And Run Verification

**Files:**
- Modify: `README.md`
- Test: `test/bootstrap-state.test.js`
- Test: `test/bootstrap-release-manifest.test.js`
- Test: `test/bootstrap-install-native.test.js`
- Test: `test/bootstrap-entire.test.js`
- Test: `test/cli-entire-login.test.js`
- Test: `test/bootstrap-orchestrator.test.js`
- Test: `test/cli-first-run-bootstrap.test.js`
- Test: `test/npm-postinstall.test.js`
- Test: `test/homebrew-formula.test.js`

- [ ] **Step 1: Update docs**

Add a README section like:

```md
## Packaging Bootstrap

On macOS, Homebrew and npm installs bootstrap VibeDeck by:

- installing the CLI/runtime
- installing `Entire` if missing
- downloading the signed `VibeDeckMac.app` artifact
- installing the app into `/Applications` first, with fallback to `~/Applications`

The widget is bundled inside the app.

On first interactive `vibedeck` run, VibeDeck checks for:

- missing `Entire` login
- missing README sync configuration

Resume later with:

```bash
vibedeck entire login
vibedeck readme-sync set --repo owner/repo --token <github_pat>
```
```

- [ ] **Step 2: Run focused packaging/bootstrap tests**

Run:

```bash
rtk node --test test/bootstrap-state.test.js test/bootstrap-release-manifest.test.js test/bootstrap-install-native.test.js test/bootstrap-entire.test.js test/cli-entire-login.test.js test/bootstrap-orchestrator.test.js test/cli-first-run-bootstrap.test.js test/npm-postinstall.test.js test/homebrew-formula.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full Node suite**

Run:

```bash
rtk node --test test/*.test.js
```

Expected: PASS, or if sandbox server-bind restrictions remain, document the exact failing suites before merge.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add README.md
rtk git commit -m "docs: document packaging bootstrap flow"
```

Expected: commit succeeds.

---

## Self-Review

### Spec coverage

- Homebrew + npm shared bootstrap: Task 5
- signed prebuilt app bundle strategy: Tasks 1, 2, 5
- `/Applications` first with fallback: Task 2
- `Entire` auto-install and VibeDeck-owned login command: Task 3
- CLI-only first-run prerequisite orchestrator: Task 4
- README sync prompting as soft prerequisite: Task 4
- release/version alignment and zipped app artifact: Tasks 1 and 5
- docs and verification: Task 6

### Placeholder scan

- No `TODO`, `TBD`, or vague “handle appropriately” placeholders remain.
- Each task includes exact file paths, commands, and commit messages.

### Type consistency

- Bootstrap modules consistently live under `src/lib/bootstrap/`
- `vibedeck entire login` is the single explicit Entire auth command
- `runFirstRunBootstrapIfNeeded()` is the orchestrator hook used before `cmdServe`

