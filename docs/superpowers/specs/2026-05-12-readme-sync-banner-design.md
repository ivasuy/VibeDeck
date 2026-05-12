# VibeDeck README Sync Banner Design

## Goal

Add an opt-in README sync feature that publishes a VibeDeck usage banner to a user-selected GitHub repository README through the GitHub API.

The banner is derived from the same canonical local usage data that powers the `/usage` page. Once configured, it updates automatically:

- after every successful `vibedeck sync`
- after every dashboard `/usage` Sync button action

This feature is CLI-configured only. No dashboard UI is added for setup.

## Scope

### Included

- A small CLI surface for configuring, updating, inspecting, and disabling README sync
- Local config and token storage under `~/.vibedeck/`
- SVG generation from canonical usage data
- GitHub Contents API integration for:
  - updating `readme-banner.svg`
  - appending/replacing a managed README block at the bottom of the configured README
- Automatic hook into sync flows
- Heatmap month/week layout fix so month labels are spaced correctly and track week boundaries like GitHub’s contribution heatmap

### Excluded

- No UI configuration flow
- No multi-repo syncing
- No commit-history or PR-based flow
- No local git clone editing
- No support for arbitrary banner placement outside the managed bottom block

## CLI Surface

### Commands

```bash
vibedeck readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
vibedeck readme-sync update
vibedeck readme-sync status
vibedeck readme-sync unset
```

### Behavior

#### `set`

Stores:

- repo owner/name
- branch
- README path
- GitHub token
- managed marker strategy

Defaults:

- `--branch main`
- `--path README.md`

This command enables automatic README updates on future syncs.

#### `update`

Runs the full pipeline immediately:

1. read local canonical usage data
2. generate/update `readme-banner.svg`
3. fetch target README from GitHub
4. upload or update the SVG in the target repo
5. append or replace the managed README block

#### `status`

Shows:

- whether README sync is enabled
- repo target
- branch
- README path
- whether a token is present

It must not print the raw token.

#### `unset`

Deletes local token/config and disables future updates.

It does **not** modify the remote GitHub README.

## Local Storage

### Config

Path:

```text
~/.vibedeck/readme-sync.json
```

Suggested shape:

```json
{
  "enabled": true,
  "repo_owner": "ivasuy",
  "repo_name": "ivasuy",
  "branch": "main",
  "readme_path": "README.md",
  "svg_path": "readme-banner.svg",
  "marker_start": "<!-- vibedeck:stats:start -->",
  "marker_end": "<!-- vibedeck:stats:end -->"
}
```

### Token

Path:

```text
~/.vibedeck/github.token
```

Permissions should match existing local secret handling patterns, ideally `0600`.

## Data Source

The banner must be generated from canonical local usage data, not scraped dashboard DOM.

### Required metrics

- total tokens
- total cost
- top models
- 52-week activity heatmap
- updated date

### Source alignment

The data should come from the same backend/database logic that powers `/usage`, so the README banner matches the dashboard.

Preferred source path:

- existing local API/data assembly functions already used by `/usage`
- or shared core aggregators beneath those routes

The implementation should avoid duplicating metric logic where possible.

## SVG Design and Heatmap Behavior

### Requirement

The heatmap section should behave visually like GitHub’s contribution heatmap:

- weeks are fixed-width vertical columns
- days are rows
- month labels are derived from real week boundaries
- label positions are computed, not hardcoded
- labels must spread correctly across the banner width regardless of month length

### Banner-specific rules

- This is for README/LLM consumption, so the SVG should remain static and lightweight
- month names should update according to the actual visible 52-week window
- week alignment should reflect the canonical heatmap’s actual week layout
- month labels should avoid bunching at the left or drifting away from their visible month start

### Layout fix

The current `readme-banner.svg` uses hardcoded month x positions. This must be replaced with generated month anchors based on the heatmap week index where each month first appears in the visible window.

### Rendering strategy

Generate the banner from a script/template layer, not by manually editing a static SVG forever.

Recommended output flow:

- keep a generator script
- compute:
  - displayed date window
  - week columns
  - month transitions
  - heatmap cell fills
  - top model rows
- emit deterministic SVG

## GitHub API Behavior

### Target files

1. README target file, e.g. `README.md`
2. SVG asset target, default:

```text
readme-banner.svg
```

### README insertion strategy

Manage only a bottom block delimited by markers:

```md
<!-- vibedeck:stats:start -->
![VibeDeck Usage](./readme-banner.svg)
<!-- vibedeck:stats:end -->
```

Rules:

- if markers already exist, replace only the block contents
- if markers do not exist, append the block to the bottom of the README
- do not rewrite unrelated README content

### API mechanics

Use GitHub Contents API with the stored PAT.

Operations:

1. GET README contents and SHA
2. GET existing SVG contents and SHA if present
3. PUT updated SVG
4. PUT updated README with marker block inserted/replaced

### Commit messages

Use simple machine-authored messages, e.g.:

- `chore: update VibeDeck README banner`

## Sync Integration

### CLI sync

At the end of a successful `vibedeck sync`:

- if README sync config exists and is enabled
- attempt README sync update

Failure policy:

- local sync still succeeds
- GitHub failure is surfaced as warning/log output

### Dashboard sync button

The `/usage` Sync button already triggers sync through the backend path.

That path should call the same post-sync README updater so behavior is identical between:

- CLI sync
- dashboard sync action

There must be one shared updater path, not separate implementations.

## Failure Handling

### Non-fatal failures

These should warn but not fail local sync:

- missing README sync config
- missing token
- GitHub 401/403
- README fetch/update failure
- SVG upload failure
- network timeout to GitHub

### Fatal failures

These should fail only the explicit `vibedeck readme-sync update` command:

- invalid repo format
- invalid stored config
- missing token for explicit update
- README not found when explicit update is invoked and path is incorrect

## Testing

### Unit tests

- config read/write
- token storage/removal
- `set` argument parsing and defaults
- `status` redaction behavior
- `unset` local cleanup
- README marker append when missing
- README marker replacement when present
- SVG month-label position generation
- heatmap week/month boundary mapping

### Integration tests

- `readme-sync update` builds payloads correctly from mocked usage data
- sync command invokes README updater when config enabled
- sync command does not fail overall when README sync fails
- dashboard-triggered sync uses same updater path
- GitHub API wrapper handles create vs update SHA flows correctly

## Implementation Plan Shape

Expected modules:

- `src/commands/readme-sync.js`
- `src/lib/readme-sync/config.js`
- `src/lib/readme-sync/github.js`
- `src/lib/readme-sync/banner-data.js`
- `src/lib/readme-sync/render-svg.js`
- `src/lib/readme-sync/update-readme.js`

Integration points likely include:

- `src/commands/sync.js`
- local API/dashboard sync endpoint path
- existing usage aggregation helpers

## Open Decisions Locked In

- GitHub writes happen through GitHub API directly
- token is stored locally under `~/.vibedeck/`
- feature auto-runs on every successful sync
- configuration is CLI-only
- `unset` disables future updates locally and does not touch remote README
- heatmap month/week spacing should mimic GitHub’s contribution graph behavior
