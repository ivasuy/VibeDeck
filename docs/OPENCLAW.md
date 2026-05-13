# OPENCLAW

VibeDeck ships OpenClaw hook and session-plugin integration inside the CLI package. Running `vibedeck init` links the integration into OpenClaw and enables it through OpenClaw's plugin manager when OpenClaw is installed.

## Install

```bash
vibedeck init
```

The installer checks for the `openclaw` binary, resolves the local VibeDeck runtime under `~/.vibedeck/`, links the bundled integration, and marks it configured when OpenClaw reports it as enabled.

The integration can signal VibeDeck with:

- OpenClaw agent id
- session id
- session key
- previous token totals
- previous model
- updated timestamp

VibeDeck then runs incremental sync using `vibedeck sync --from-openclaw`.

## Verify

```bash
vibedeck status
vibedeck sync
```

If status reports `skipped`, check that `openclaw --version` works in a fresh terminal and that `~/.openclaw/openclaw.json` exists.

If you use custom OpenClaw paths, set these before running `vibedeck init`:

```bash
export OPENCLAW_CONFIG_PATH=/path/to/openclaw.json
export OPENCLAW_STATE_DIR=/path/to/openclaw-state
```

## Troubleshooting

Run the OpenClaw plugin command directly if the setup path needs more detail:

```bash
openclaw plugins list
```

Resolve any OpenClaw-reported plugin error, then run `vibedeck init` again.

If OpenClaw is already running, restart the OpenClaw gateway after `vibedeck init` so newly linked plugins and hooks are loaded.

## Uninstall

```bash
vibedeck uninstall
```

This removes VibeDeck hooks and plugin links for every supported provider.
