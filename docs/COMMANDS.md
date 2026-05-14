# Commands

This file is for developers working on the VibeDeck codebase.

Public install commands live in the root [README](../README.md). This document focuses on local development, debugging, testing, packaging, and release workflows inside this repository.

## Fresh Clone Setup

Use this section when you are setting up the repository from scratch on a new machine.

### Prerequisites

- Node.js `22.5+`
- npm
- Git
- macOS plus Xcode command line tools if you plan to build the native app
- `gh` if you plan to trigger or inspect GitHub Actions locally

Check your versions:

```bash
node -v
npm -v
git --version
gh --version
```

### Clone and install

```bash
git clone https://github.com/ivasuy/VibeDeck.git
cd VibeDeck
npm install
npm --prefix dashboard install
```

What this does:

- installs CLI/runtime dependencies from the root `package.json`
- installs dashboard dependencies from `dashboard/package.json`
- runs the root `postinstall` bootstrap

### First local run

Initialize local hooks and tracker state:

```bash
rtk node bin/vibedeck.js init --yes
```

Build the dashboard once:

```bash
rtk npm --prefix dashboard run build
```

Pull local provider data into the canonical database:

```bash
rtk node bin/vibedeck.js sync
```

Start the app:

```bash
rtk node bin/vibedeck.js serve --no-open
```

Then open:

```text
http://127.0.0.1:7690
```

### First-time troubleshooting

If `serve` fails, run these in order:

```bash
rtk node bin/vibedeck.js status --diagnostics
rtk node bin/vibedeck.js doctor
rtk node bin/vibedeck.js sync --rebuild-vibedeck-db
```

Important: commands such as `init`, `sync`, and `serve` write into:

```text
~/.vibedeck/
```

Run them from a normal local shell. If you run them inside a restricted sandbox that cannot write to your home directory, SQLite startup can fail even when the app itself is healthy.

## Command Entry Points

Installed CLI:

```bash
vibedeck
```

Repository-local equivalent:

```bash
rtk node bin/vibedeck.js
```

## Local Dev Loops

### Backend loop

Initialize local integrations:

```bash
rtk node bin/vibedeck.js init
```

Incrementally sync local provider activity:

```bash
rtk node bin/vibedeck.js sync
```

Run the local server:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

Useful serve variants:

```bash
rtk node bin/vibedeck.js serve --no-open
rtk node bin/vibedeck.js serve --no-sync
rtk node bin/vibedeck.js serve --port 7690 --no-open --no-sync
```

What `serve` does:

- ensures the SQLite schema exists
- ensures local auth state exists
- optionally runs sync first
- starts the local API
- starts HEAD watching and stale-session reaping
- serves `dashboard/dist`

### Frontend loop

Run the Vite dev server:

```bash
rtk npm --prefix dashboard run dev
```

Build the production dashboard:

```bash
rtk npm --prefix dashboard run build
```

The production CLI/native app path expects built assets under:

```text
dashboard/dist
```

### Native macOS loop

Generate the Xcode project:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
```

Run a local debug build without signing:

```bash
rtk xcodebuild \
  -project VibeDeckMac/VibeDeckMac.xcodeproj \
  -scheme VibeDeckMac \
  -configuration Debug \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  build
```

Build a release app and DMG locally:

```bash
bash scripts/build-release-mac.sh
```

Skip DMG during iteration:

```bash
bash scripts/build-release-mac.sh --skip-dmg
```

## Core CLI Commands

### `serve`

```bash
vibedeck serve
vibedeck serve --port 7690
vibedeck serve --no-open
vibedeck serve --no-sync
```

### `sync`

```bash
vibedeck sync
vibedeck sync --auto
vibedeck sync --drain
vibedeck sync --from-openclaw
vibedeck sync --rebuild-vibedeck-db
```

Canonical storage:

```text
~/.vibedeck/tracker/vibedeck.sqlite3
```

Compatibility exports:

```text
~/.vibedeck/tracker/queue.jsonl
~/.vibedeck/tracker/project.queue.jsonl
```

Use `--rebuild-vibedeck-db` when parser or canonical-session changes require a full rebuild from local provider logs.

### `init`

```bash
vibedeck init
vibedeck init --yes
vibedeck init --dry-run
vibedeck init --no-open
vibedeck init --skip-entire-login
vibedeck init --link-code <code>
```

This installs or refreshes provider hooks and local runtime state under:

```text
~/.vibedeck/tracker/app
```

### `status` and `doctor`

```bash
vibedeck status
vibedeck status --json
vibedeck status --diagnostics
vibedeck status --probe-keychain
vibedeck status --probe-keychain-details
```

```bash
vibedeck doctor
vibedeck doctor --json
vibedeck doctor --out doctor.json
vibedeck doctor --base-url http://127.0.0.1:7690
```

Use `status` for a quick provider/runtime summary. Use `doctor` for deeper checks across:

- canonical DB completeness
- hook integrity
- live-session health
- cost quality
- Entire checkpoint linkage
- local API reachability

### `attribute`

```bash
vibedeck attribute --provider codex --session <session-id> --branch <branch>
vibedeck attribute --provider codex --session <session-id> --clear
```

Writes to `vibedeck_attribution_overrides` and overrides automatic branch resolution.

### `auth`

```bash
vibedeck auth show
vibedeck auth rotate
```

Local auth token path:

```text
~/.vibedeck/auth.token
```

### `repo migrate`

```bash
vibedeck repo migrate /old/path /new/path
```

Use this after moving a repository on disk.

### `readme-sync`

```bash
vibedeck readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
vibedeck readme-sync status
vibedeck readme-sync update
vibedeck readme-sync unset
```

Local token path:

```text
~/.vibedeck/github.token
```

### `entire`

```bash
vibedeck entire login
```

### `uninstall`

```bash
vibedeck uninstall
vibedeck uninstall --purge
```

## Tests

### Full backend suite

```bash
npm test
rtk node --test test/*.test.js
```

### Focused backend examples

```bash
rtk node --test test/local-api-vibedeck-checkpoints.test.js
rtk node --test test/local-api-vibedeck-branch-usage.test.js
rtk node --test test/local-api-vibedeck-sessions-live.test.js
rtk node --test test/release-main-workflow.test.js
rtk node --test test/release-dmg-workflow.test.js
```

### Dashboard tests

```bash
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run test:watch
rtk npm --prefix dashboard run lint
rtk npm --prefix dashboard run typecheck
```

Focused dashboard examples:

```bash
rtk npm --prefix dashboard run test -- BranchesPage.test.jsx EntirePage.test.jsx CheckpointFileInspector.test.jsx
rtk npm --prefix dashboard run test -- vibedeck-api.test.ts
```

### Native and packaging checks

```bash
rtk node --test test/native-macos-theme-and-resources.test.js
rtk node --test test/bootstrap-release-manifest.test.js
rtk node --test test/bootstrap-state.test.js
rtk node --test test/homebrew-formula.test.js
```

## Release And Packaging

### Local package checks

```bash
node scripts/acceptance/npm-install-smoke.cjs
```

### Local release build

Recommended:

```bash
bash scripts/build-release-mac.sh
```

Manual equivalent:

```bash
bash VibeDeckMac/scripts/bundle-node.sh
xcodegen generate --spec VibeDeckMac/project.yml
ruby VibeDeckMac/scripts/patch-pbxproj-icon.rb
xcodebuild \
  -project VibeDeckMac/VibeDeckMac.xcodeproj \
  -scheme VibeDeckMac \
  -configuration Release \
  -derivedDataPath VibeDeckMac/build/DerivedData \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGN_IDENTITY="-" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGNING_ALLOWED=NO \
  clean build
```

### GitHub release automation

Push to `main`:

```bash
git push origin main
```

Current workflow chain:

1. `.github/workflows/npm-publish.yml`
2. `.github/workflows/release-main.yml`
3. Homebrew tap update inside `release-main.yml`

The chain requires:

- `NPM_TOKEN`
- `HOMEBREW_TAP_TOKEN`
- `HOMEBREW_TAP_REPO`

Watch recent runs:

```bash
gh run list --limit 10
gh run watch
```

Manual native release fallback:

```bash
gh workflow run release-dmg.yml -f version=0.1.1
```

## Useful Paths

Canonical local state:

```text
~/.vibedeck/
```

Main SQLite database:

```text
~/.vibedeck/tracker/vibedeck.sqlite3
```

Diagnostics:

```text
~/.vibedeck/tracker/diagnostics/
```

Dashboard build output:

```text
dashboard/dist/
```

Native derived data:

```text
VibeDeckMac/build/DerivedData/
```

## Useful Environment Variables

| Variable | Purpose |
| --- | --- |
| `VIBEDECK_DEBUG` | Enable debug output. |
| `VIBEDECK_HTTP_TIMEOUT_MS` | Override local HTTP timeout in milliseconds. |
| `VIBEDECK_BACKEND_BASE_URL` | Point dashboard or native clients at a specific local backend. |
| `VIBEDECK_SERVE_SYNC_MS` | Background sync interval while `serve` is running. |
| `CODEX_HOME` | Override Codex config and session directory root. |
| `GEMINI_HOME` | Override Gemini config and session directory root. |
| `OPENCODE_HOME` | Override OpenCode state root. |
| `OPENCLAW_CONFIG_PATH` | Override OpenClaw config file path. |
| `OPENCLAW_STATE_DIR` | Override OpenClaw state directory. |
| `TOKENTRACKER_OPENCLAW_HOME` | Legacy OpenClaw state override used by hooks. |

Some legacy variable names remain for compatibility with older hooks and migration paths.
