# OpenClaw Integration

VibeDeck ships an OpenClaw session plugin inside the CLI package. Running `vibedeck init` links the plugin into OpenClaw and enables it through OpenClaw's plugin manager.

## Install

```bash
vibedeck init
```

The installer checks for the `openclaw` binary, resolves the local VibeDeck runtime under `~/.vibedeck/`, links the bundled session plugin, and marks the integration as configured when OpenClaw reports it as enabled.

## Verify

```bash
vibedeck status
vibedeck sync
```

If status reports `skipped`, check that `openclaw --version` works in a fresh terminal and that `~/.openclaw/openclaw.json` exists. If you use a custom OpenClaw config path, export `OPENCLAW_CONFIG_PATH` before running `vibedeck init`.

## Troubleshooting

Run the OpenClaw plugin command directly if the setup path needs more detail:

```bash
openclaw plugins list
```

Resolve any OpenClaw-reported plugin error, then run `vibedeck init` again.

## Uninstall

```bash
vibedeck uninstall
```

This removes VibeDeck hooks and plugin links for every supported provider.
