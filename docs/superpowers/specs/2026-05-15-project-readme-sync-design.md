# Project README Sync Design

Date: 2026-05-15
Branch: `project-sync`
Status: Approved for planning

## Goal

Add a new top-level CLI command, `vibedeck project-readme-sync`, that updates a local project README with a VibeDeck usage banner for the current project only.

This feature is local-first:

- it operates only in the current directory
- it requires a local `README.md`
- it does not use a GitHub PAT
- it does not call the GitHub API
- it does not run automatically during `vibedeck sync`
- it does not traverse to the git root

The command writes a local `project-readme-banner.svg` and appends or refreshes a managed block at the bottom of the local `README.md`. The README change is published only if the user later commits and pushes it.

## Non-Goals

- changing the existing `vibedeck readme-sync` remote GitHub profile README flow
- reusing the existing GitHub sync config, token, or state files
- auto-running project README updates from `vibedeck sync`
- walking parent directories to find a repo root
- editing any file outside the current directory
- inserting the banner anywhere except the bottom managed block

## User Experience

### Command

The user runs:

```bash
vibedeck project-readme-sync
```

### Expected behavior

When run from a directory that contains `README.md`, the command:

1. computes usage stats for the current project only
2. renders `project-readme-banner.svg` into the current directory
3. appends or updates a managed banner block at the bottom of `README.md`
4. prints a short success summary

### Expected output

Success output should be concise and script-friendly:

```text
Project README sync: updated
README: /abs/path/to/README.md
Banner: /abs/path/to/project-readme-banner.svg
```

### Failure behavior

If `README.md` is missing in the current directory, the command exits non-zero with a clear message:

```text
README.md not found in current directory
```

No new README file should be created automatically.

## Architecture

Use a dedicated local-only pipeline rather than extending the existing remote `readme-sync` feature.

New top-level command:

- `src/commands/project-readme-sync.js`

CLI wiring:

- add `project-readme-sync` handling in `src/cli.js`
- add a short help line in `printHelp()`

New local pipeline modules:

- `src/lib/project-readme-sync/service.js`
- `src/lib/project-readme-sync/banner-data.js`
- `src/lib/project-readme-sync/render-svg.js`
- `src/lib/project-readme-sync/update-readme.js`

Only small helper sharing is allowed where it reduces duplication safely. The remote GitHub sync flow should remain behaviorally unchanged.

## Component Responsibilities

### `src/commands/project-readme-sync.js`

- parse the top-level command
- invoke the local sync service
- print success output
- convert thrown errors into concise CLI failures

### `src/lib/project-readme-sync/service.js`

- resolve `process.cwd()`
- verify `README.md` exists in the current directory
- derive the local project identity from the current directory
- build current-project usage data
- render the SVG
- write `project-readme-banner.svg`
- update the local README managed block
- return structured result metadata to the command layer

### `src/lib/project-readme-sync/banner-data.js`

- build metrics for the current project only
- source data from VibeDeck local state, not from GitHub
- produce a stable zero-state payload when the project has no usage yet

The data contract should be independent from the global GitHub README banner contract because the project banner has a different layout.

### `src/lib/project-readme-sync/render-svg.js`

- render the existing project-specific banner shape
- interpolate project usage data into that layout
- support zero-state rendering

This renderer should target the visual structure already represented by `project-readme-banner.svg`, not the existing heatmap-oriented GitHub profile banner.

### `src/lib/project-readme-sync/update-readme.js`

- manage insertion and replacement of the project README banner block
- preserve all README content outside the managed block
- append the block to the bottom if no managed block exists yet

## Data Scope

The banner must represent the current project only.

It must not:

- show global all-time VibeDeck usage
- aggregate unrelated repos
- depend on GitHub repo ownership metadata

The current directory is the scope boundary. If the directory has no matching VibeDeck usage yet, the banner should still render with zero values.

## README Managed Block

The local project flow should use its own markers so it cannot conflict with the existing GitHub sync block.

Markers:

```text
<!-- vibedeck:project-stats:start -->
<!-- vibedeck:project-stats:end -->
```

Managed block content:

```md
<!-- vibedeck:project-stats:start -->
![VibeDeck Project Usage](./project-readme-banner.svg)
<!-- vibedeck:project-stats:end -->
```

Rules:

- if both project markers exist, replace only the content within that managed block
- if the markers do not exist, append the block at the bottom of `README.md`
- do not modify or inspect the existing GitHub sync markers beyond leaving them untouched
- use the same markdown-image style as the current GitHub sync, not centered HTML

## Data Flow

1. User runs `vibedeck project-readme-sync`.
2. The command calls the local project README sync service.
3. The service resolves the current directory and checks for `README.md`.
4. The service computes project-only usage metrics.
5. The renderer generates `project-readme-banner.svg`.
6. The updater appends or refreshes the managed block in `README.md`.
7. The command prints the updated README path and banner path.

## Error Handling

### Missing README

- fail fast
- exit non-zero
- print `README.md not found in current directory`
- do not create a README automatically

### No usage data

- succeed
- render a zero-state banner
- still update the README block

### Write failures

- fail non-zero
- include which file could not be written

### Unknown project attribution

- succeed with zero-state values rather than failing

## Testing Strategy

Add focused tests for the new local-only pipeline.

### Unit tests

- `src/lib/project-readme-sync/update-readme.test.js`
  - append when block is missing
  - replace when block exists
  - preserve surrounding README content

- `src/lib/project-readme-sync/render-svg.test.js`
  - render expected labels and project fields
  - render zero-state output

- `src/lib/project-readme-sync/service.test.js`
  - success path
  - missing `README.md` failure
  - zero-data success
  - writes banner and README in the current directory only

- `src/commands/project-readme-sync.test.js`
  - success output
  - non-zero failure on missing README

### Integration-style fixture test

Use a temporary directory fixture containing a sample `README.md`.

Verify:

- `project-readme-banner.svg` is created
- the managed block is appended exactly once
- repeated runs update the existing block idempotently

## Compatibility And Safety

- no GitHub token required
- no GitHub network dependency
- no interaction with existing `readme-sync.json` or `github.token`
- no automatic invocation from `vibedeck sync`
- no repo-root discovery
- no edits outside the current directory

## Implementation Notes For Planning

The next planning step should resolve:

- which existing VibeDeck read models or aggregation helpers are the right source for current-project totals
- whether any generic README block helper should be extracted and shared across remote and local sync systems
- the exact result schema returned by the new service to the command layer

The implementation should preserve clean separation between:

- remote GitHub profile README sync
- local project README sync

That separation is the main design constraint.
