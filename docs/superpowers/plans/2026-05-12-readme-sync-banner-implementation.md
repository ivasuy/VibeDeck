# VibeDeck README Sync Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in GitHub README sync feature that generates a VibeDeck SVG banner from canonical usage data and updates the configured GitHub README on every successful sync.

**Architecture:** Keep one backend-owned pipeline. `vibedeck readme-sync ...` manages local config/token and can run the updater manually, while successful `cmdSync()` runs the same updater automatically. The dashboard `/usage` Sync button already goes through `/functions/vibedeck-local-sync` -> `runSyncCommand()` -> `vibedeck sync`, so no dashboard-only write path is needed. Banner data should be assembled from the same canonical usage read models behind `/usage`, and the SVG month labels must be computed from actual week boundaries instead of hardcoded x positions.

**Tech Stack:** Node.js CommonJS, built-in `fetch`, `node:test`, `node:sqlite`, existing local API/data aggregation modules, GitHub Contents API, static SVG output.

---

## File Structure

### CLI Surface And Local Storage

- Create: `src/commands/readme-sync.js`
  - Subcommand runner for `set`, `update`, `status`, `unset`.
- Modify: `src/cli.js`
  - Register `readme-sync`.
- Modify: `test/cli-help.test.js`
  - Show the new command in help output.
- Create: `src/lib/readme-sync/config.js`
  - Resolve paths under `~/.vibedeck/`, read/write config, read/write token, validate repo strings, scrub token from status output.
- Create: `test/readme-sync-config.test.js`
  - Unit tests for config/token persistence and validation.
- Create: `test/readme-sync-command.test.js`
  - Command-level tests for `set`, `status`, `unset`, `update`.

### Banner Data And SVG Rendering

- Create: `src/lib/readme-sync/banner-data.js`
  - Read canonical usage data and shape banner totals, top models, and 52-week heatmap input.
- Create: `src/lib/readme-sync/render-svg.js`
  - Convert banner data into deterministic SVG, including GitHub-like month/week label placement.
- Modify: `readme-banner.svg`
  - Regenerated artifact produced by `render-svg.js`.
- Modify: `dashboard/public/banner-preview.html`
  - Keep preview pointing at the generated SVG.
- Create: `test/readme-sync-banner.test.js`
  - Validate totals extraction, month-marker spacing, week-window alignment, and stable SVG output.

### GitHub API And README Mutation

- Create: `src/lib/readme-sync/github.js`
  - Minimal GitHub Contents API wrapper: get file, put file, base64 encode/decode, commit messages.
- Create: `src/lib/readme-sync/update-readme.js`
  - Managed marker insertion/replacement logic and combined SVG + README upload flow.
- Create: `test/readme-sync-github.test.js`
  - API wrapper tests and marker replacement tests.

### Sync Integration

- Create: `src/lib/readme-sync/service.js`
  - Orchestrator for manual update and post-sync auto-update, with non-fatal warning behavior.
- Modify: `src/commands/sync.js`
  - Call the README sync service after a successful sync.
- Create: `test/sync-readme-sync.test.js`
  - Verifies successful sync triggers updater, disabled config skips it, and GitHub failures do not fail sync.

### Documentation

- Modify: `README.md`
  - Document setup, PAT expectations, commands, automatic sync behavior, and how the `/usage` Sync button reuses the same path.

---

## Implementation Notes

- Reuse canonical DB-first usage reads instead of scraping the dashboard or using `readme-banner.svg` as a template.
- The dashboard `/usage` button already calls `triggerLocalSync()` in `dashboard/src/lib/api.ts`, which POSTs `/functions/vibedeck-local-sync`. That local API route already shells out to `vibedeck sync`, so putting the post-sync README update inside `src/commands/sync.js` is the correct single integration point.
- Keep remote GitHub failures non-fatal. A sync that updates local SQLite successfully must still exit `0`.
- Use marker boundaries exactly:

```md
<!-- vibedeck:stats:start -->
![VibeDeck Usage](./readme-banner.svg)
<!-- vibedeck:stats:end -->
```

- Store local files under:

```text
~/.vibedeck/readme-sync.json
~/.vibedeck/github.token
```

- Token file should be `0600` when possible.

---

### Task 1: Add README Sync Config And CLI Surface

**Files:**
- Create: `src/lib/readme-sync/config.js`
- Create: `src/commands/readme-sync.js`
- Modify: `src/cli.js`
- Modify: `test/cli-help.test.js`
- Test: `test/readme-sync-config.test.js`
- Test: `test/readme-sync-command.test.js`

- [ ] **Step 1: Write failing config tests**

Create `test/readme-sync-config.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseRepoRef,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  writeGitHubToken,
  readGitHubToken,
  removeReadmeSyncState,
} = require("../src/lib/readme-sync/config");

test("parseRepoRef accepts owner/repo", () => {
  assert.deepEqual(parseRepoRef("ivasuy/vibedeck"), { owner: "ivasuy", repo: "vibedeck" });
});

test("parseRepoRef rejects malformed repo refs", () => {
  assert.throws(() => parseRepoRef("ivasuy"), /owner\/repo/);
  assert.throws(() => parseRepoRef("ivasuy/"), /owner\/repo/);
});

test("config and token round-trip under VIBEDECK_HOME", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-sync-"));
  process.env.VIBEDECK_HOME = tmp;
  await writeReadmeSyncConfig({
    enabled: true,
    repo_owner: "ivasuy",
    repo_name: "ivasuy",
    branch: "main",
    readme_path: "README.md",
    svg_path: "readme-banner.svg",
    marker_start: "<!-- vibedeck:stats:start -->",
    marker_end: "<!-- vibedeck:stats:end -->",
  });
  await writeGitHubToken("ghp_test_token");

  const config = await readReadmeSyncConfig();
  const token = await readGitHubToken();
  const tokenMode = fs.statSync(path.join(tmp, "github.token")).mode & 0o777;

  assert.equal(config.enabled, true);
  assert.equal(config.repo_owner, "ivasuy");
  assert.equal(token, "ghp_test_token");
  assert.equal(tokenMode, 0o600);

  await removeReadmeSyncState();
  assert.equal(await readReadmeSyncConfig(), null);
  assert.equal(await readGitHubToken(), null);
});
```

Run:

```bash
rtk node --test test/readme-sync-config.test.js
```

Expected: FAIL with `Cannot find module '../src/lib/readme-sync/config'`.

- [ ] **Step 2: Implement config/token storage**

Create `src/lib/readme-sync/config.js` with this shape:

```js
'use strict';

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { ensureDir, readJsonStrict, writeJson, writeFileAtomic, chmod600IfPossible } = require('../fs');

function resolveReadmeSyncRoot() {
  return process.env.VIBEDECK_HOME || path.join(os.homedir(), '.vibedeck');
}

function resolveReadmeSyncPaths() {
  const rootDir = resolveReadmeSyncRoot();
  return {
    rootDir,
    configPath: path.join(rootDir, 'readme-sync.json'),
    tokenPath: path.join(rootDir, 'github.token'),
  };
}

function parseRepoRef(repoRef) {
  const raw = String(repoRef || '').trim();
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(raw);
  if (!match) throw new Error('Expected --repo owner/repo');
  return { owner: match[1], repo: match[2] };
}

async function readReadmeSyncConfig() {
  const { configPath } = resolveReadmeSyncPaths();
  const result = await readJsonStrict(configPath);
  return result.status === 'ok' ? result.value : null;
}

async function writeReadmeSyncConfig(config) {
  const { rootDir, configPath } = resolveReadmeSyncPaths();
  await ensureDir(rootDir);
  await writeJson(configPath, config);
}

async function readGitHubToken() {
  const { tokenPath } = resolveReadmeSyncPaths();
  try {
    const raw = await fs.readFile(tokenPath, 'utf8');
    const token = raw.trim();
    return token ? token : null;
  } catch {
    return null;
  }
}

async function writeGitHubToken(token) {
  const value = String(token || '').trim();
  if (!value) throw new Error('Expected non-empty --token');
  const { rootDir, tokenPath } = resolveReadmeSyncPaths();
  await ensureDir(rootDir);
  await writeFileAtomic(tokenPath, `${value}\n`);
  await chmod600IfPossible(tokenPath);
}

async function removeReadmeSyncState() {
  const { configPath, tokenPath } = resolveReadmeSyncPaths();
  await fs.unlink(configPath).catch(() => {});
  await fs.unlink(tokenPath).catch(() => {});
}

module.exports = {
  parseRepoRef,
  resolveReadmeSyncPaths,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  readGitHubToken,
  writeGitHubToken,
  removeReadmeSyncState,
};
```

- [ ] **Step 3: Write failing command tests**

Create `test/readme-sync-command.test.js`:

```js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { run } = require("../src/cli");

test("readme-sync set stores config and status redacts the token", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-readme-sync-cli-"));
  process.env.VIBEDECK_HOME = tmp;

  let out = "";
  const prevStdout = process.stdout.write;
  try {
    process.stdout.write = (chunk) => ((out += String(chunk || "")), true);
    await run([
      "readme-sync",
      "set",
      "--repo",
      "ivasuy/ivasuy",
      "--token",
      "ghp_secret_token",
      "--branch",
      "main",
      "--path",
      "README.md",
    ]);
    await run(["readme-sync", "status"]);
  } finally {
    process.stdout.write = prevStdout;
  }

  assert.match(out, /enabled/i);
  assert.match(out, /ivasuy\/ivasuy/);
  assert.doesNotMatch(out, /ghp_secret_token/);
  assert.match(out, /token: present/i);
});
```

Run:

```bash
rtk node --test test/readme-sync-command.test.js
```

Expected: FAIL with `Unknown command: readme-sync`.

- [ ] **Step 4: Implement `readme-sync` command runner**

Create `src/commands/readme-sync.js`:

```js
'use strict';

const {
  parseRepoRef,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  readGitHubToken,
  writeGitHubToken,
  removeReadmeSyncState,
} = require('../lib/readme-sync/config');
const { runReadmeSyncUpdate } = require('../lib/readme-sync/service');

async function run(argv = []) {
  const [subcommand, ...rest] = argv;

  if (subcommand === 'set') return runSet(rest);
  if (subcommand === 'update') return runUpdate();
  if (subcommand === 'status') return runStatus();
  if (subcommand === 'unset') return runUnset();

  process.stderr.write(
    'Usage: vibedeck readme-sync <set|update|status|unset> [options]\\n',
  );
  return 1;
}
```

Implement `runSet`, `runUpdate`, `runStatus`, and `runUnset` with these rules:

```js
const config = {
  enabled: true,
  repo_owner: owner,
  repo_name: repo,
  branch: branch || 'main',
  readme_path: readmePath || 'README.md',
  svg_path: 'readme-banner.svg',
  marker_start: '<!-- vibedeck:stats:start -->',
  marker_end: '<!-- vibedeck:stats:end -->',
};
```

`status` output should follow this shape:

```text
README sync: enabled
Repo: ivasuy/ivasuy
Branch: main
README: README.md
Token: present
```

- [ ] **Step 5: Register the command and help text**

Modify `src/cli.js`:

```js
    case "readme-sync":
      process.exitCode = await require("./commands/readme-sync").run(rest);
      return;
```

Add this help line inside `printHelp()`:

```text
  npx vibedeck-cli [--debug] readme-sync <set|update|status|unset>
```

Update `test/cli-help.test.js` to assert:

```js
assert.match(out, /readme-sync/);
```

- [ ] **Step 6: Run tests**

Run:

```bash
rtk node --test test/readme-sync-config.test.js test/readme-sync-command.test.js test/cli-help.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/cli.js src/commands/readme-sync.js src/lib/readme-sync/config.js test/readme-sync-config.test.js test/readme-sync-command.test.js test/cli-help.test.js
git commit -m "feat: add readme sync cli config"
```

Expected: commit succeeds.

---

### Task 2: Build Canonical Banner Data And GitHub-Like SVG Layout

**Files:**
- Create: `src/lib/readme-sync/banner-data.js`
- Create: `src/lib/readme-sync/render-svg.js`
- Modify: `readme-banner.svg`
- Modify: `dashboard/public/banner-preview.html`
- Test: `test/readme-sync-banner.test.js`

- [ ] **Step 1: Write failing banner tests**

Create `test/readme-sync-banner.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { buildMonthAnchors, renderReadmeBannerSvg } = require("../src/lib/readme-sync/render-svg");

test("month anchors are derived from week transitions instead of hardcoded positions", () => {
  const anchors = buildMonthAnchors({
    to: "2026-05-12",
    weeks: 52,
    weekStartsOn: "sun",
  });

  assert.ok(anchors.length >= 11);
  assert.equal(anchors[0].label, "May");
  assert.ok(anchors[1].x > anchors[0].x);
  assert.ok(anchors.at(-1).x > anchors[0].x);
});

test("svg renders computed month labels for the visible 52-week window", () => {
  const svg = renderReadmeBannerSvg({
    updatedDateLabel: "May 12, 2026",
    totalTokensLabel: "12.4M",
    totalTokensSubLabel: "12,400,000 tokens total",
    totalCostLabel: "$184.21",
    topModels: [
      { name: "claude-opus-4-1", valueLabel: "5.2M", percentLabel: "42%" },
      { name: "gpt-5.4", valueLabel: "3.1M", percentLabel: "25%" },
    ],
    heatmap: { to: "2026-05-12", weekStartsOn: "sun", weeks: Array.from({ length: 52 }, () => Array(7).fill({ level: 0 })) },
  });

  assert.match(svg, />May</);
  assert.match(svg, />Jun</);
  assert.match(svg, />Apr</);
  assert.doesNotMatch(svg, /x=\"78\"[^>]*>Jun</);
});
```

Run:

```bash
rtk node --test test/readme-sync-banner.test.js
```

Expected: FAIL with `Cannot find module '../src/lib/readme-sync/render-svg'`.

- [ ] **Step 2: Implement banner data assembly from canonical usage sources**

Create `src/lib/readme-sync/banner-data.js` with one entry point:

```js
'use strict';

const os = require('node:os');
const path = require('node:path');
const { resolveTrackerPaths } = require('../tracker-paths');
const { readUsageRowsFromDb } = require('../usage-read-models');
const { buildActivityHeatmap } = require('../../dashboard/src/lib/activity-heatmap.ts');
```

Do not keep that import. Instead copy only the date/heatmap shaping logic needed into Node-owned code. The exported function should be:

```js
async function buildReadmeBannerData({ home = os.homedir(), now = new Date() } = {}) {
  const { trackerDir } = await resolveTrackerPaths({ home });
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const rows = readUsageRowsFromDb(dbPath);

  const totals = rows.reduce(
    (acc, row) => {
      acc.total_tokens += Number(row?.billable_total_tokens ?? row?.total_tokens ?? 0) || 0;
      acc.total_cost_usd += Number(row?.total_cost_usd || 0) || 0;
      return acc;
    },
    { total_tokens: 0, total_cost_usd: 0 },
  );
```

Then build:

```js
  return {
    updatedDateLabel: formatUpdatedDate(now),
    totalTokensLabel: formatCompactTokenCount(totals.total_tokens),
    totalTokensSubLabel: `${Math.round(totals.total_tokens).toLocaleString()} tokens total`,
    totalCostLabel: formatUsd(totals.total_cost_usd),
    topModels,
    heatmap,
  };
}
```

Use the same raw DB rows for:
- `topModels`: group by `model`, sort descending by billable tokens, take 4.
- `heatmap`: group by UTC day, then build a 52-week array with `level` values `0..4`.

- [ ] **Step 3: Implement deterministic SVG renderer**

Create `src/lib/readme-sync/render-svg.js` and export:

```js
function buildMonthAnchors({ to, weeks, weekStartsOn = 'sun', cellSize = 13, gap = 3, startX = 46 }) {
  // derive month starts from the visible aligned week window
}

function renderReadmeBannerSvg(data) {
  // return the final SVG string
}

module.exports = {
  buildMonthAnchors,
  renderReadmeBannerSvg,
};
```

Use this anchor calculation:

```js
const columnX = startX + weekIndex * (cellSize + gap);
anchors.push({ label: MONTHS[monthStart.getUTCMonth()], weekIndex, x: columnX });
```

Keep the month-selection rule GitHub-like:
- start from the aligned first week in the visible 52-week window
- detect the first visible column where a new month appears
- skip duplicate month names only when they point to the same visible column
- do not hardcode label x offsets from the current static SVG

- [ ] **Step 4: Add a stable regeneration helper and update the checked-in SVG**

At the bottom of `src/lib/readme-sync/render-svg.js`, expose:

```js
async function writeReadmeBannerSvg(filePath, data) {
  const { writeFileAtomic } = require('../fs');
  const svg = renderReadmeBannerSvg(data);
  await writeFileAtomic(filePath, `${svg}\n`);
  return svg;
}
```

Then regenerate `readme-banner.svg` using current local data once the implementation exists.

Keep `dashboard/public/banner-preview.html` pointed at:

```html
<img src="/readme-banner.svg" style="width:900px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,0.5)"/>
```

- [ ] **Step 5: Run tests**

Run:

```bash
rtk node --test test/readme-sync-banner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/readme-sync/banner-data.js src/lib/readme-sync/render-svg.js readme-banner.svg dashboard/public/banner-preview.html test/readme-sync-banner.test.js
git commit -m "feat: generate readme banner from canonical usage"
```

Expected: commit succeeds.

---

### Task 3: Implement GitHub Contents API Uploads And README Marker Replacement

**Files:**
- Create: `src/lib/readme-sync/github.js`
- Create: `src/lib/readme-sync/update-readme.js`
- Test: `test/readme-sync-github.test.js`

- [ ] **Step 1: Write failing GitHub/update tests**

Create `test/readme-sync-github.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { upsertManagedReadmeBlock } = require("../src/lib/readme-sync/update-readme");

test("appends managed block when markers are missing", () => {
  const next = upsertManagedReadmeBlock({
    readme: "# Hello\\n",
    markerStart: "<!-- vibedeck:stats:start -->",
    markerEnd: "<!-- vibedeck:stats:end -->",
    imagePath: "./readme-banner.svg",
  });

  assert.match(next, /# Hello/);
  assert.match(next, /<!-- vibedeck:stats:start -->/);
  assert.match(next, /!\\[VibeDeck Usage\\]\\(\\.\\/readme-banner\\.svg\\)/);
});

test("replaces only the managed block when markers already exist", () => {
  const existing = [
    "# Hello",
    "",
    "<!-- vibedeck:stats:start -->",
    "old block",
    "<!-- vibedeck:stats:end -->",
    "",
    "tail",
  ].join("\\n");

  const next = upsertManagedReadmeBlock({
    readme: existing,
    markerStart: "<!-- vibedeck:stats:start -->",
    markerEnd: "<!-- vibedeck:stats:end -->",
    imagePath: "./readme-banner.svg",
  });

  assert.doesNotMatch(next, /old block/);
  assert.match(next, /tail/);
  assert.equal((next.match(/vibedeck:stats:start/g) || []).length, 1);
});
```

Run:

```bash
rtk node --test test/readme-sync-github.test.js
```

Expected: FAIL with `Cannot find module '../src/lib/readme-sync/update-readme'`.

- [ ] **Step 2: Implement marker replacement logic**

Create `src/lib/readme-sync/update-readme.js`:

```js
'use strict';

function buildManagedReadmeBlock({ imagePath }) {
  return [
    '<!-- vibedeck:stats:start -->',
    `![VibeDeck Usage](${imagePath})`,
    '<!-- vibedeck:stats:end -->',
  ].join('\n');
}

function upsertManagedReadmeBlock({ readme, markerStart, markerEnd, imagePath }) {
  const source = String(readme || '');
  const block = buildManagedReadmeBlock({ imagePath });
  const start = source.indexOf(markerStart);
  const end = source.indexOf(markerEnd);
  if (start !== -1 && end !== -1 && end >= start) {
    const tailIndex = end + markerEnd.length;
    return `${source.slice(0, start).replace(/\s*$/, '')}\n\n${block}\n${source.slice(tailIndex).replace(/^\s*/, '\n')}`;
  }
  return `${source.replace(/\s*$/, '')}\n\n${block}\n`;
}
```

- [ ] **Step 3: Implement GitHub Contents API wrapper**

Create `src/lib/readme-sync/github.js` with:

```js
'use strict';

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'VibeDeck',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function getRepoFile({ owner, repo, path, branch, token, fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
  const res = await fetchImpl(url, { headers: githubHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub GET failed (${res.status})`);
  const body = await res.json();
  return {
    sha: body.sha,
    content: Buffer.from(String(body.content || '').replace(/\n/g, ''), 'base64').toString('utf8'),
  };
}

async function putRepoFile({ owner, repo, path, branch, token, content, sha = null, message = 'chore: update VibeDeck README banner', fetchImpl = fetch }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      branch,
      content: Buffer.from(content, 'utf8').toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) throw new Error(`GitHub PUT failed (${res.status})`);
  return res.json();
}
```

- [ ] **Step 4: Compose SVG upload + README update**

Add to `src/lib/readme-sync/update-readme.js`:

```js
const { getRepoFile, putRepoFile } = require('./github');

async function pushBannerAndReadme({ config, token, svg, fetchImpl = fetch }) {
  const owner = config.repo_owner;
  const repo = config.repo_name;
  const branch = config.branch;
  const svgPath = config.svg_path;
  const readmePath = config.readme_path;

  const existingSvg = await getRepoFile({ owner, repo, path: svgPath, branch, token, fetchImpl });
  await putRepoFile({
    owner,
    repo,
    path: svgPath,
    branch,
    token,
    content: svg,
    sha: existingSvg?.sha || null,
    fetchImpl,
  });

  const existingReadme = await getRepoFile({ owner, repo, path: readmePath, branch, token, fetchImpl });
  const nextReadme = upsertManagedReadmeBlock({
    readme: existingReadme?.content || '',
    markerStart: config.marker_start,
    markerEnd: config.marker_end,
    imagePath: `./${svgPath}`,
  });
  await putRepoFile({
    owner,
    repo,
    path: readmePath,
    branch,
    token,
    content: nextReadme,
    sha: existingReadme?.sha || null,
    fetchImpl,
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
rtk node --test test/readme-sync-github.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add src/lib/readme-sync/github.js src/lib/readme-sync/update-readme.js test/readme-sync-github.test.js
git commit -m "feat: add github readme banner updater"
```

Expected: commit succeeds.

---

### Task 4: Hook README Sync Into `vibedeck sync` And Manual `readme-sync update`

**Files:**
- Create: `src/lib/readme-sync/service.js`
- Modify: `src/commands/sync.js`
- Modify: `src/commands/readme-sync.js`
- Test: `test/sync-readme-sync.test.js`

- [ ] **Step 1: Write failing sync hook tests**

Create `test/sync-readme-sync.test.js`:

```js
const assert = require("node:assert/strict");
const test = require("node:test");

const { maybeRunPostSyncReadmeUpdate } = require("../src/lib/readme-sync/service");

test("disabled config skips the updater", async () => {
  const result = await maybeRunPostSyncReadmeUpdate({
    config: { enabled: false },
    token: null,
    updateImpl: async () => {
      throw new Error("should not run");
    },
  });
  assert.deepEqual(result, { attempted: false, ok: true, skipped: "disabled" });
});

test("github failures are downgraded to warnings", async () => {
  const result = await maybeRunPostSyncReadmeUpdate({
    config: { enabled: true },
    token: "ghp_token",
    updateImpl: async () => {
      throw new Error("GitHub PUT failed (401)");
    },
  });
  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.match(result.warning, /GitHub PUT failed/);
});
```

Run:

```bash
rtk node --test test/sync-readme-sync.test.js
```

Expected: FAIL with `Cannot find module '../src/lib/readme-sync/service'`.

- [ ] **Step 2: Implement the shared service**

Create `src/lib/readme-sync/service.js`:

```js
'use strict';

const path = require('node:path');
const { readReadmeSyncConfig, readGitHubToken } = require('./config');
const { buildReadmeBannerData } = require('./banner-data');
const { renderReadmeBannerSvg } = require('./render-svg');
const { pushBannerAndReadme } = require('./update-readme');
const { writeFileAtomic } = require('../fs');

async function runReadmeSyncUpdate({ fetchImpl = fetch, config = null, token = null } = {}) {
  const resolvedConfig = config || (await readReadmeSyncConfig());
  const resolvedToken = token || (await readGitHubToken());
  if (!resolvedConfig?.enabled) throw new Error('README sync is not configured');
  if (!resolvedToken) throw new Error('GitHub token is not configured');

  const data = await buildReadmeBannerData();
  const svg = renderReadmeBannerSvg(data);
  await writeFileAtomic(path.resolve('readme-banner.svg'), `${svg}\n`);
  await pushBannerAndReadme({ config: resolvedConfig, token: resolvedToken, svg, fetchImpl });
  return {
    ok: true,
    repo: `${resolvedConfig.repo_owner}/${resolvedConfig.repo_name}`,
    branch: resolvedConfig.branch,
    readme_path: resolvedConfig.readme_path,
  };
}

async function maybeRunPostSyncReadmeUpdate({ config = null, token = null, updateImpl = runReadmeSyncUpdate } = {}) {
  const resolvedConfig = config || (await readReadmeSyncConfig());
  if (!resolvedConfig?.enabled) return { attempted: false, ok: true, skipped: 'disabled' };

  const resolvedToken = token || (await readGitHubToken());
  if (!resolvedToken) return { attempted: false, ok: true, skipped: 'missing_token' };

  try {
    await updateImpl({ config: resolvedConfig, token: resolvedToken });
    return { attempted: true, ok: true, skipped: null };
  } catch (error) {
    return { attempted: true, ok: false, warning: error?.message || String(error) };
  }
}

module.exports = {
  runReadmeSyncUpdate,
  maybeRunPostSyncReadmeUpdate,
};
```

- [ ] **Step 3: Call the updater from `cmdSync()`**

Modify the success path near the end of `src/commands/sync.js`:

```js
    const { maybeRunPostSyncReadmeUpdate } = require("../lib/readme-sync/service");
    const readmeSyncResult = await maybeRunPostSyncReadmeUpdate();
    if (!opts.auto && readmeSyncResult.attempted && readmeSyncResult.ok) {
      process.stdout.write("- README banner updated on GitHub\n");
    }
    if (readmeSyncResult.warning && !opts.auto) {
      process.stderr.write(`README sync warning: ${readmeSyncResult.warning}\n`);
    }
```

Place this after local DB/cursor writes succeed and before the final success summary is printed.

Do not throw on GitHub failure.

- [ ] **Step 4: Make manual `readme-sync update` call the same service**

In `src/commands/readme-sync.js`, `runUpdate()` should be:

```js
async function runUpdate() {
  const result = await runReadmeSyncUpdate();
  process.stdout.write(
    [
      'README sync: updated',
      `Repo: ${result.repo}`,
      `Branch: ${result.branch}`,
      `README: ${result.readme_path}`,
    ].join('\n') + '\n',
  );
  return 0;
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
rtk node --test test/sync-readme-sync.test.js test/readme-sync-command.test.js
```

Expected: PASS.

- [ ] **Step 6: Verify the existing dashboard `/usage` sync mapping stays correct**

Run:

```bash
rg -n "triggerLocalSync|vibedeck-local-sync|runSyncCommand\\(|TRACKER_BIN, \\\"sync\\\"" dashboard/src/lib/api.ts src/lib/local-api.js
```

Expected output should still show this chain:
- `dashboard/src/lib/api.ts` -> `triggerLocalSync()`
- `src/lib/local-api.js` -> `/functions/vibedeck-local-sync`
- `src/lib/local-api.js` -> `runSyncCommand({})`
- `runSyncCommand()` -> `TRACKER_BIN, "sync"`

Do not add a second dashboard-specific GitHub write path.

- [ ] **Step 7: Commit**

Run:

```bash
git add src/commands/sync.js src/commands/readme-sync.js src/lib/readme-sync/service.js test/sync-readme-sync.test.js
git commit -m "feat: auto update readme banner after sync"
```

Expected: commit succeeds.

---

### Task 5: Document The Feature And Run End-To-End Verification

**Files:**
- Modify: `README.md`
- Test: `test/readme-sync-config.test.js`
- Test: `test/readme-sync-command.test.js`
- Test: `test/readme-sync-banner.test.js`
- Test: `test/readme-sync-github.test.js`
- Test: `test/sync-readme-sync.test.js`

- [ ] **Step 1: Document the new command surface**

Add a README section like:

```md
## README Sync

Configure GitHub README syncing:

```bash
vibedeck readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
vibedeck readme-sync status
vibedeck readme-sync update
vibedeck readme-sync unset
```

After `set`, every successful `vibedeck sync` also regenerates `readme-banner.svg` and updates the configured GitHub README through the GitHub API.

The dashboard `/usage` Sync button uses the same backend sync path, so it triggers the same README update automatically.
```

- [ ] **Step 2: Run focused feature tests**

Run:

```bash
rtk node --test test/readme-sync-config.test.js test/readme-sync-command.test.js test/readme-sync-banner.test.js test/readme-sync-github.test.js test/sync-readme-sync.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the full Node suite**

Run:

```bash
rtk node --test test/*.test.js
```

Expected: PASS with no new failures.

- [ ] **Step 4: Smoke-test the checked-in SVG locally**

Run:

```bash
sed -n '1,120p' readme-banner.svg
```

Expected:
- month labels are not hardcoded to the old fixed `x="78"` / `x="142"` pattern
- header date reflects the current generation date
- top model rows are populated when local data exists

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md readme-banner.svg
git commit -m "docs: document readme sync feature"
```

Expected: commit succeeds.

---

## Self-Review

### Spec coverage

- CLI surface: covered in Task 1.
- Local config/token storage: covered in Task 1.
- Canonical usage-driven totals/top models/heatmap: covered in Task 2.
- Month/week GitHub-like spacing fix: covered in Task 2.
- GitHub Contents API upload/update flow: covered in Task 3.
- Managed bottom-of-README marker replacement: covered in Task 3.
- Auto-run on every successful `vibedeck sync`: covered in Task 4.
- Existing `/usage` Sync button mapping to the same path: covered in Task 4, Step 6.
- Docs and verification: covered in Task 5.

### Placeholder scan

- No `TODO`, `TBD`, or “handle appropriately” placeholders remain.
- Every task includes file paths, commands, and target code shape.

### Type consistency

- Command names are consistently `readme-sync set|update|status|unset`.
- Shared service entry points are consistently `runReadmeSyncUpdate()` and `maybeRunPostSyncReadmeUpdate()`.
- Marker names are consistently `marker_start` and `marker_end`.

