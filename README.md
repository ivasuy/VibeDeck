# VibeDeck

VibeDeck is a local-first dashboard for AI coding usage, cost, branch attribution, live sessions, and checkpoint audit data.

It reads activity that AI coding tools already write on your machine, normalizes that activity into a local SQLite database, computes model-aware cost, and serves the result through a local dashboard, CLI, and macOS app.

VibeDeck is intentionally local-first:

- Prompts and responses are not uploaded by VibeDeck.
- Usage data is stored under `~/.vibedeck/`.
- The dashboard is served from `http://127.0.0.1:7690` by default.
- Write endpoints are protected by a local auth token.

## What It Shows

- Live workstreams with active and recently completed sessions.
- Project, worktree, and branch-level tokens, cost, model, and provider breakdowns.
- Usage history by day, model, source, and project.
- Entire checkpoint files with model and cost metadata.
- Provider setup, hook health, local database completeness, and sync diagnostics.

## Supported Providers

VibeDeck currently supports local usage ingestion for:

- Codex CLI
- Claude Code
- Cursor
- Gemini CLI
- OpenCode
- OpenClaw
- Kiro and Kiro CLI
- Kimi Code
- GitHub Copilot CLI
- CodeBuddy
- Every Code
- Hermes Agent
- oh-my-pi
- Craft Agents

Some providers are hook-based. Others are passive readers over local JSONL, SQLite, CSV, or OTEL files.

## Quick Start

Requirements:

- Node.js `22.5+`
- npm or pnpm
- macOS and Xcode only if you are building the native app

Install dependencies:

```bash
npm install
npm --prefix dashboard install
```

Build the dashboard:

```bash
rtk npm --prefix dashboard run build
```

Install or refresh local provider hooks:

```bash
rtk node bin/vibedeck.js init
```

Parse local provider activity:

```bash
rtk node bin/vibedeck.js sync
```

Serve the local dashboard:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

Open:

```text
http://127.0.0.1:7690
```

## Local Data Paths

Default local state:

```text
~/.vibedeck/
  auth.token
  cache/pricing.json
  tracker/
    vibedeck.sqlite3
    cursors.json
    queue.jsonl
    project.queue.jsonl
    diagnostics/
```

`vibedeck.sqlite3` is the canonical local store. The queue JSONL files are compatibility exports and reconciliation inputs, not the primary cost source.

## Documentation

- [Commands](docs/COMMANDS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [OpenClaw integration](docs/OPENCLAW.md)

## Repository Layout

```text
bin/vibedeck.js         CLI entry point
src/commands/           CLI command implementations
src/lib/rollout.js      Provider parsers and compatibility queue writers
src/lib/sessions/       Canonical session event pipeline, live rollups, branch attribution
src/lib/db/             SQLite schema and migrations
src/lib/local-api.js    Local HTTP API used by dashboard and native app
dashboard/              Vite and React dashboard
VibeDeckMac/            macOS app and widget targets
test/                   Node test suite
docs/                   Public documentation
```

## Common Checks

```bash
rtk node bin/vibedeck.js status
rtk node bin/vibedeck.js doctor
rtk node --test test/*.test.js
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run build
```

More commands are documented in [docs/COMMANDS.md](docs/COMMANDS.md).

## Packaging

The CLI package can bootstrap the macOS app on supported macOS installs. Native release builds use:

```bash
bash scripts/build-release-mac.sh
```

Manual native builds require `xcodegen`:

```bash
rtk xcodegen generate --spec VibeDeckMac/project.yml
rtk xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO build
```

## License

MIT
