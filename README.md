# VibeDeck

VibeDeck is a local-first usage, cost, provenance, and live-session dashboard for AI coding agents. It parses local provider activity, stores normalized usage in a local SQLite database, serves a local API, and exposes the same data through the CLI, the web dashboard, and the macOS menu bar app.

The product is intentionally local-only. It does not include remote account features, public rankings, public profiles, generated social cards, or marketing pages.

## Requirements

- Node.js `22.5+`
- npm or pnpm
- macOS for the native app and widget targets
- Xcode 16+ for the native app
- `xcodegen` for regenerating the native project from `VibeDeckMac/project.yml`

Canonical local paths:

- data root: `~/.vibedeck/`
- SQLite database: `~/.vibedeck/tracker/vibedeck.sqlite3`
- default dashboard URL: `http://localhost:7690`

## Repo Layout

- `bin/vibedeck.js` - CLI entry point
- `src/commands/` - CLI commands such as `serve`, `sync`, `init`, `status`, and `doctor`
- `src/lib/local-api.js` - local backend consumed by dashboard and native app
- `dashboard/` - Vite/React dashboard
- `VibeDeckMac/` - macOS menu bar app and widget extension
- `test/` - Node test suite

## Install

Install root and dashboard dependencies:

```bash
npm install
npm --prefix dashboard install
```

If you are working on the native app, generate the Xcode project:

```bash
xcodegen generate --spec VibeDeckMac/project.yml
```

## CLI Commands

```bash
vibedeck                      # start the local server and dashboard
vibedeck sync                 # parse provider logs into ~/.vibedeck/tracker/vibedeck.sqlite3
vibedeck status               # show provider/configuration state
vibedeck doctor               # run local health checks
vibedeck init                 # install or refresh provider hooks
vibedeck uninstall            # remove hooks and local config
vibedeck readme-sync set      # configure README sync target and token
vibedeck readme-sync status   # show configured README sync settings
vibedeck readme-sync update   # regenerate and upload the README banner immediately
vibedeck readme-sync unset    # remove README sync configuration and token
```

Equivalent local dev entrypoints:

```bash
rtk node bin/vibedeck.js serve --port 7690
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js status
rtk node bin/vibedeck.js doctor
rtk node bin/vibedeck.js init
```

## README Sync

Configure a GitHub README to be updated automatically from canonical local usage after successful syncs:

```bash
rtk node bin/vibedeck.js readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
rtk node bin/vibedeck.js readme-sync status
rtk node bin/vibedeck.js readme-sync update
rtk node bin/vibedeck.js readme-sync unset
```

`--token` stores your GitHub personal access token on disk at `~/.vibedeck/github.token` and is not printed in status output.

After a successful `readme-sync set`, every `rtk node bin/vibedeck.js sync` run regenerates `readme-banner.svg`, uploads it to the configured repo path, and updates the managed README marker block through the same GitHub API flow used by manual `readme-sync update`.

The dashboard `/usage` Sync button uses the same backend sync path (`vibedeck sync` via local API), so README updates use the same post-sync path and failure mode (`warning` only; sync remains successful).

## Packaging Bootstrap

- `vibedeck` packages bootstrap the macOS native app during install, so on macOS installs from Homebrew or npm you get `VibeDeckMac.app` automatically.
- The installer prefers `/Applications` and falls back to `~/Applications` when `/Applications` is unavailable.

```bash
# Homebrew
brew install --cask --verbose vibedeck

# npm global install (requires macOS interactive shell for bootstrap)
npm install -g vibedeck-cli
```

`brew` install runs the package formula’s post-install flow, and npm uses
`node scripts/npm-postinstall.js`. The script is non-interactive-safe and skips in CI/non-interactive shells.

If prerequisite checks fail during bootstrap, `vibedeck` prompts:

```text
The following VibeDeck prerequisites are not fully configured:
  - native_app
  - entire_login
  - readme_sync

Would you like to fix these missing prerequisites now?
  1) Continue without setup
  2) Fix missing prerequisites now
```

Declining or cancelling continues into `vibedeck` normally, leaving the soft prerequisites unresolved.

- `vibedeck entire login` runs the `Entire` auth flow when needed.
- `vibedeck status` and `vibedeck doctor` include bootstrap/ prerequisite state (native app, `Entire`, and README sync config).
- `readme-sync` setup command remains the recovery path for README sync, for example:

```bash
rtk node bin/vibedeck.js readme-sync set --repo owner/repo --token <github_pat>
```

## Build Commands

Root package:

```bash
rtk npm run dashboard:build
```

Dashboard only:

```bash
rtk npm --prefix dashboard run build
```

Native app:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Signed native build on a machine with a valid Apple Development identity:

```bash
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -allowProvisioningUpdates build
```

## Test Commands

CLI and backend tests:

```bash
npm test
rtk node --test test/*.test.js
```

Focused Node tests:

```bash
rtk node --test test/rollout-parser.test.js
rtk node --test test/local-api.test.js
```

Dashboard tests:

```bash
rtk npm --prefix dashboard run test
```

Dashboard watch mode:

```bash
rtk npm --prefix dashboard run test:watch
```

Dashboard lint and typecheck:

```bash
rtk npm --prefix dashboard run lint
rtk npm --prefix dashboard run typecheck
```

Native app verification:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

## Local Development

### Run the backend and dashboard

Build the dashboard bundle and start the local backend:

```bash
rtk npm --prefix dashboard run build
rtk node bin/vibedeck.js serve --port 7690
```

Then open:

- `http://127.0.0.1:7690`
- or `http://localhost:7690`

For dashboard-only frontend work:

```bash
rtk npm --prefix dashboard run dev
```

### Sync local usage data

To populate the local database from supported provider logs:

```bash
rtk node bin/vibedeck.js init
rtk node bin/vibedeck.js sync
```

Useful follow-up checks:

```bash
rtk node bin/vibedeck.js status
rtk node bin/vibedeck.js doctor
```

## End-to-End Local Testing

This is the shortest reliable path to get data flowing into all three surfaces: CLI, dashboard, and mac app.

### 1. Install dependencies

```bash
npm install
npm --prefix dashboard install
```

### 2. Build the dashboard assets

```bash
rtk npm --prefix dashboard run build
```

### 3. Install hooks and provider integrations

```bash
rtk node bin/vibedeck.js init
```

This installs or refreshes local hooks for supported providers where applicable.

### 4. Generate some local data

Option A: use your existing supported tools normally so they write logs that VibeDeck can parse.

Option B: if you already have provider logs from Claude Code, Codex CLI, Cursor, Gemini CLI, or other supported tools on this machine, just proceed to sync.

### 5. Parse provider activity into the database

```bash
rtk node bin/vibedeck.js sync
```

This writes normalized usage into:

```bash
~/.vibedeck/tracker/vibedeck.sqlite3
```

### 6. Verify data exists from the CLI

```bash
rtk node bin/vibedeck.js status
rtk node bin/vibedeck.js doctor
```

If sync completed successfully, the CLI should show configured providers and recent activity state.

### 7. Start the local backend

```bash
rtk node bin/vibedeck.js serve --port 7690
```

This serves the local API and dashboard on port `7690`.

### 8. Test the dashboard

Open:

```text
http://localhost:7690
```

The dashboard reads from the same local backend and SQLite-backed API.

### 9. Test the CLI against the same local data

Run:

```bash
node bin/vibedeck.js status
node bin/vibedeck.js sync
```

You are now exercising the same local store that feeds the dashboard and native app.

### 10. Test the mac app

Generate the Xcode project if needed:

```bash
xcodegen generate --spec VibeDeckMac/project.yml
```

Build the app:

```bash
xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -allowProvisioningUpdates build
```

The built app will be under a DerivedData path similar to:

```text
/Users/<you>/Library/Developer/Xcode/DerivedData/.../Build/Products/Debug/VibeDeckMac.app
```

Launch that app, or open `VibeDeckMac/VibeDeckMac.xcodeproj` in Xcode and run the `VibeDeckMac` scheme.

The native app reads the same local backend and local data model:

- it embeds the Node server bundle
- it points at the same local API routes
- its widgets use snapshots written from the same local usage state

## How Data Reaches All Surfaces

```text
provider logs and hooks
  -> node bin/vibedeck.js sync
  -> ~/.vibedeck/tracker/vibedeck.sqlite3
  -> src/lib/local-api.js
  -> CLI / dashboard / mac app / widgets
```

If one surface looks empty while another has data, check these first:

1. `node bin/vibedeck.js sync`
2. `node bin/vibedeck.js status`
3. `node bin/vibedeck.js doctor`
4. confirm `~/.vibedeck/tracker/vibedeck.sqlite3` exists
5. confirm the local backend is running on `http://localhost:7690`

## Supported Providers

VibeDeck tracks local usage from:

- Claude Code
- Codex CLI
- Cursor
- Gemini CLI
- Kiro
- OpenCode
- OpenClaw
- Every Code
- Hermes Agent
- GitHub Copilot
- Kimi Code
- CodeBuddy
- oh-my-pi

Hook-based providers get lightweight local hooks. Passive providers are read from files they already write, including SQLite databases, JSONL logs, and local exports.

## Configuration

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `VIBEDECK_DEBUG` | Enable debug output |
| `VIBEDECK_HTTP_TIMEOUT_MS` | Override HTTP timeout in milliseconds |
| `VIBEDECK_BACKEND_BASE_URL` | Point dashboard/native clients at a specific local backend |
| `CODEX_HOME` | Override Codex config directory |
| `GEMINI_HOME` | Override Gemini config directory |

Some legacy aliases still exist for migration and hook compatibility.

## macOS Notes

- Native project source of truth: `VibeDeckMac/project.yml`
- Regenerated project: `VibeDeckMac/VibeDeckMac.xcodeproj`
- Signed builds require a valid Apple Development identity in Xcode
- Widget testing requires running the native app at least once so widget snapshot data can be written locally

## License

MIT
