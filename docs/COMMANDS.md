# Commands

This file lists the public CLI, build, test, and release commands used by VibeDeck.

The package entry point is:

```bash
vibedeck
```

For local development in this repository, the equivalent command is:

```bash
rtk node bin/vibedeck.js
```

## CLI

### Open the dashboard

```bash
vibedeck
vibedeck serve
vibedeck serve --port 7690
vibedeck serve --port 7690 --no-open
vibedeck serve --port 7690 --no-sync
```

Development equivalent:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

`serve` ensures the local database schema exists, ensures the local auth token exists, refreshes the embedded runtime, optionally syncs local data, starts the head watcher, starts stale-session reaping, serves the local API, and serves `dashboard/dist`.

### Initialize local integrations

```bash
vibedeck init
vibedeck init --yes
vibedeck init --dry-run
vibedeck init --no-open
vibedeck init --skip-entire-login
vibedeck init --link-code <code>
```

Development equivalent:

```bash
rtk node bin/vibedeck.js init
```

`init` installs or refreshes provider hooks where supported. It writes local runtime files under `~/.vibedeck/tracker/app`, creates local auth state, and links supported integrations such as Codex, Claude, Gemini, OpenCode, CodeBuddy, Every Code, GitHub Copilot, and OpenClaw when their local config is present.

### Sync local usage

```bash
vibedeck sync
vibedeck sync --auto
vibedeck sync --drain
vibedeck sync --from-openclaw
vibedeck sync --rebuild-vibedeck-db
```

Development equivalent:

```bash
rtk node bin/vibedeck.js sync
```

`sync` parses provider logs and writes normalized usage into:

```text
~/.vibedeck/tracker/vibedeck.sqlite3
```

It also maintains compatibility exports:

```text
~/.vibedeck/tracker/queue.jsonl
~/.vibedeck/tracker/project.queue.jsonl
```

Use `--rebuild-vibedeck-db` when you need to clear and rebuild canonical VibeDeck session state from local provider logs.

### Inspect local state

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

`status` is a quick provider and local-state summary. `doctor` runs deeper checks over the local API, canonical database completeness, hook integrity, live-session health, session cost quality, and Entire checkpoint coverage.

### Attribute sessions manually

```bash
vibedeck attribute --provider codex --session <session-id> --branch <branch>
vibedeck attribute --provider codex --session <session-id> --clear
```

Manual attribution writes to `vibedeck_attribution_overrides` and wins over automatic branch resolution.

### Local auth token

```bash
vibedeck auth show
vibedeck auth rotate
```

The local token is stored at:

```text
~/.vibedeck/auth.token
```

Dashboard write endpoints use this token for local mutation protection.

### Repository migration

```bash
vibedeck repo migrate /old/path /new/path
```

Use this after moving a repository on disk. It updates stored repo roots and related canonical metadata.

### README sync

```bash
vibedeck readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
vibedeck readme-sync status
vibedeck readme-sync update
vibedeck readme-sync unset
```

README sync stores the GitHub token locally at:

```text
~/.vibedeck/github.token
```

After configuration, `vibedeck sync` runs a warning-only post-sync README update path.

### Entire helpers

```bash
vibedeck entire login
```

The dashboard also exposes local, auth-gated Entire actions for checkpoint rewind and cleanup.

### Uninstall hooks

```bash
vibedeck uninstall
vibedeck uninstall --purge
```

`uninstall` removes VibeDeck-managed hooks and plugin links without removing unrelated provider config.

## Build Commands

Root package:

```bash
rtk npm run dashboard:build
```

Dashboard only:

```bash
rtk npm --prefix dashboard run build
```

Dashboard dev server:

```bash
rtk npm --prefix dashboard run dev
```

Native project generation:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
```

Native debug build without signing:

```bash
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

Native release build:

```bash
bash scripts/build-release-mac.sh
```

Manual release path:

```bash
bash VibeDeckMac/scripts/bundle-node.sh
xcodegen generate --spec VibeDeckMac/project.yml
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

## Test Commands

Backend and CLI:

```bash
npm test
rtk node --test test/*.test.js
```

Focused backend examples:

```bash
rtk node --test test/local-api-vibedeck-checkpoints.test.js
rtk node --test test/local-api-vibedeck-branch-usage.test.js
rtk node --test test/local-api-vibedeck-sessions-live.test.js
```

Dashboard:

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

Native:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
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

Some legacy environment variable names remain for migration and hook compatibility.
