# VibeDeck

VibeDeck is a local-first dashboard for AI coding work. It parses usage from supported coding agents, attributes activity to projects and branches, estimates model cost, and serves everything from your machine.

The project is intentionally local-only. It does not include remote account features, public rankings, public profiles, generated social cards, or marketing pages.

## Quick Start

Requirements:

- Node.js 22.5 or newer
- macOS, Linux, or Windows for the CLI
- macOS for the native menu bar app and widget targets

```bash
npx vibedeck-cli
```

First run installs supported hooks, syncs local usage data, and opens the dashboard at `http://localhost:7690`.

For local development:

```bash
npm install
npm --prefix dashboard install
npm --prefix dashboard run build
node bin/vibedeck.js serve
```

## Commands

```bash
vibedeck              # Start the local dashboard
vibedeck sync         # Parse provider logs into the local database
vibedeck status       # Show integration status
vibedeck doctor       # Run health checks
vibedeck init         # Install or refresh provider hooks
vibedeck uninstall    # Remove installed hooks and local config
```

## Supported Providers

VibeDeck tracks local usage from:

- Claude Code
- Codex CLI and Every Code
- Cursor
- Gemini CLI
- Kiro
- OpenCode and OpenClaw
- Hermes Agent
- GitHub Copilot
- Kimi Code
- CodeBuddy
- oh-my-pi

Hook-based providers get lightweight local hooks. Passive providers are read from files they already write, such as SQLite databases, JSONL logs, or OpenTelemetry exports.

## What VibeDeck Tracks

- Token usage by day, hour, model, provider, project, branch, and live workstream
- Estimated USD cost using bundled pricing data and local overrides
- Active and recently stale sessions
- Provider configuration and sync freshness
- Entire CLI status and checkpoints for selected repositories
- Skills installation and per-provider sync state

VibeDeck tracks counts and metadata. It is designed not to upload prompts, responses, file contents, or conversation text.

## Data Flow

```text
AI coding tools
  -> hooks and passive log readers
  -> local sync
  -> ~/.vibedeck/tracker/vibedeck.sqlite3
  -> local API
  -> dashboard, menu bar app, and widgets
```

Compatibility exports such as `queue.jsonl` may still be written for older readers, but the canonical local store is the SQLite database under `~/.vibedeck/tracker/`.

## Configuration

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `VIBEDECK_DEBUG` | Enable debug output |
| `VIBEDECK_HTTP_TIMEOUT_MS` | Override HTTP timeout in milliseconds |
| `VIBEDECK_BACKEND_BASE_URL` | Point dashboard/native clients at a specific local backend |
| `CODEX_HOME` | Override Codex config directory |
| `GEMINI_HOME` | Override Gemini config directory |

Some legacy environment aliases are still accepted for migration or provider-hook compatibility.

## Development

```bash
rtk node --test test/*.test.js
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run build
```

Useful focused commands:

```bash
rtk node --test test/rollout-parser.test.js
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js serve --port 7690
```

## macOS App

The native app lives in `VibeDeckMac/`. It embeds the local Node server, hosts the dashboard in a WKWebView, and writes WidgetKit snapshots for the VibeDeck widget target.

## License

MIT.
