# CLAUDE.md - VibeDeck

This repository is VibeDeck: a local-first cost, provenance, and live-session dashboard for AI coding agents.

## Current Product Shape

- Default dashboard port: `7690`.
- Canonical data directory: `~/.vibedeck/`.
- Canonical usage database: `~/.vibedeck/tracker/vibedeck.sqlite3`.
- Remote auth, public ranking pages, generated social cards, public profile pages, IP-check pages, and marketing landing pages are removed.
- Keep legacy compatibility only where it protects migration, old local API routes, installed provider hooks, or existing local data.

## Development Commands

```bash
rtk node --test test/*.test.js
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run build
rtk node bin/vibedeck.js serve --port 7690
rtk node bin/vibedeck.js sync
```

## Architecture

```text
provider logs and hooks
  -> src/commands/sync.js
  -> src/lib/rollout.js parser output
  -> src/lib/sessions/* canonical session pipeline
  -> ~/.vibedeck/tracker/vibedeck.sqlite3
  -> src/lib/local-api.js
  -> dashboard and native app
```

Compatibility exports such as queue files may still exist, but they should be rebuildable from provider logs plus the canonical database.

## Main Areas

- `bin/vibedeck.js` - CLI entry point.
- `src/commands/` - CLI commands such as `serve`, `sync`, `init`, `status`, and `doctor`.
- `src/lib/rollout.js` - inherited parser and pricing core. Treat parser math and token normalization as high-risk.
- `src/lib/sessions/` - canonical event ledger, bucket facts, attribution, and live-session pipeline.
- `src/lib/local-api.js` - local HTTP API consumed by the dashboard and native app.
- `dashboard/` - React/Vite dashboard served by the CLI.
- `VibeDeckMac/` - Swift menu bar app and widget targets.
- `test/` - Node test suite for parser, local API, sync, package identity, and cleanup guards.

## Supported Providers

VibeDeck reads local usage from Claude Code, Codex CLI, Cursor, Gemini CLI, Kiro, OpenCode, OpenClaw, Every Code, Hermes Agent, GitHub Copilot, Kimi Code, CodeBuddy, and oh-my-pi.

Provider integrations use a mix of hooks, plugins, SQLite readers, JSONL readers, and API-backed local readers. Preserve provider-specific compatibility unless a migration plan explicitly removes it.

## Local API

Prefer VibeDeck route names for new work:

- `/functions/vibedeck-usage-summary`
- `/functions/vibedeck-usage-daily`
- `/functions/vibedeck-usage-hourly`
- `/functions/vibedeck-usage-monthly`
- `/functions/vibedeck-usage-heatmap`
- `/functions/vibedeck-usage-model-breakdown`
- `/functions/vibedeck-project-usage-summary`
- `/functions/vibedeck-usage-limits`
- `/functions/vibedeck-user-status`
- `/functions/vibedeck-local-sync`

Legacy local route aliases may remain for old dashboard/native builds, but do not add new product-facing usage of those names.

## Token Normalization

`input_tokens` means non-cached input. `cached_input_tokens` means cache reads. `cache_creation_input_tokens` means cache writes. `total_tokens` includes input, output, cache reads, and cache writes. Cost calculation must use the correct input/output/cached pricing buckets and must not price all tokens at a single blended rate.

## Cleanup Rules

- Do not reintroduce removed remote account, public ranking, public profile, generated social card, recap, or marketing landing code.
- Do not add Chinese localization or bilingual UI copy.
- Product-facing docs, UI, package metadata, and native labels should say VibeDeck.
- Use compatibility names only in migration paths, old route aliases, installed hook fallbacks, or tests that explicitly verify those compatibility paths.
- Keep edits scoped. This repo often has concurrent dirty work, so stage explicit files only.

@CODEX.md