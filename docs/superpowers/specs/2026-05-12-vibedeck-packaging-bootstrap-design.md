# VibeDeck Packaging And Bootstrap Design

## Goal

Package VibeDeck so users can install it through both Homebrew and npm, while treating the native macOS app/widget bundle and `Entire` as managed prerequisites of the product on macOS.

The user-facing contract should be:

- install VibeDeck once through Homebrew or npm
- get the CLI, dashboard assets, and signed mac app bundle
- let `vibedeck` itself guide the user through missing prerequisites on first run
- keep setup resumable through explicit VibeDeck commands

## Scope

### Included

- Homebrew distribution design
- npm distribution design
- native macOS app/widget bundling strategy
- `Entire` auto-install and VibeDeck-owned login command
- CLI-first first-run prerequisite prompts
- README sync prerequisite prompting on first run
- install/update/failure behavior
- release artifact and version alignment strategy
- testing and verification strategy

### Excluded

- No mac app setup wizard for this phase
- No dashboard setup wizard for this phase
- No building the native app from source during normal package install
- No requirement that package installation fails if OAuth/login is incomplete
- No change to the existing README sync feature surface beyond first-run prompting and packaging integration

## Context

Current repo shape:

- npm package currently ships the CLI/runtime and dashboard bundle
- mac app and widget already have a release/build pipeline under `VibeDeckMac/`
- `Entire` is already treated as a product dependency in install/doctor flows
- `Entire` login already exists as an optional step in `init`
- the mac app consumes local API/snapshot state and does not need to own bootstrap/auth orchestration

This means packaging should not invent a second setup surface. The CLI is already the correct control plane.

## Product Direction

### Decision

Use one shared bootstrap flow for both Homebrew and npm, with a strong preference for prebuilt signed native artifacts.

On macOS:

1. install the CLI/runtime
2. ensure `Entire` is installed
3. fetch the signed native `VibeDeckMac.app` release artifact that contains the widget extension
4. install the app into `/Applications` first, with fallback to `~/Applications`
5. let `vibedeck` first-run prompt for incomplete prerequisite steps:
   - `Entire` login
   - README sync setup (repo/token/config)

On non-macOS:

- install CLI/runtime only
- skip native app/widget
- skip `Entire` auto-install unless future product scope explicitly expands it

## Approaches Considered

### Approach 1: Shared bootstrap installer for both Homebrew and npm

Homebrew and npm both install the CLI, then invoke the same VibeDeck-managed bootstrap logic on macOS.

Pros:

- one product behavior
- one prerequisite model
- one upgrade path
- easy to keep first-run prompting centralized in `vibedeck`

Cons:

- requires careful packaging and bootstrap boundaries

### Approach 2: Homebrew does full native install, npm delegates differently

Pros:

- simpler Homebrew path

Cons:

- product behavior diverges by package manager
- harder to test and document

### Approach 3: Build native app from source during install

Pros:

- no binary artifact hosting dependency

Cons:

- bad UX
- brittle due Xcode/signing/toolchain requirements
- poor fit for package-manager installs

### Recommendation

Use Approach 1.

It gives the cleanest user story and keeps all setup semantics inside VibeDeck rather than scattering them across Homebrew, npm, Xcode, and separate install docs.

## Architecture

### Packaging Layers

There are three distinct layers:

1. **CLI/runtime package**
   - installed by Homebrew or npm
   - contains `bin/vibedeck.js`, `src/`, dashboard assets, bootstrap code

2. **Native artifact**
   - signed prebuilt `VibeDeckMac.app`
   - contains widget extension inside the app bundle
   - distributed as a release artifact suitable for non-interactive download/install

3. **Managed external prerequisite**
   - `Entire`
   - installed automatically if missing
   - authenticated later through interactive first-run flow or explicit command

### Native Artifact Strategy

Use a signed prebuilt app artifact downloaded from releases.

Normal install must **not** build the app from source.

Reason:

- package-manager installs must be predictable
- local source builds require Xcode/signing/toolchain state
- the widget is embedded in the app bundle, so installing the app bundle is sufficient

Preferred automation artifact:

- zipped/signed `.app` bundle for scripted installation

Manual user artifact can still remain:

- `.dmg`

The bootstrap should prefer the zipped app payload, not DMG mounting.

### Version Alignment

The following versions should match:

- npm package version
- Homebrew formula version
- native release artifact version

Bootstrap must fetch the native artifact for the exact VibeDeck version being installed.

If the matching artifact is unavailable:

- package installation is considered incomplete on macOS
- bootstrap should fail the native install step clearly
- CLI install can still exist, but the install summary must say native setup failed

## Install Flows

### Homebrew Flow

`brew install vibedeck`

Behavior:

1. install CLI/runtime files
2. run VibeDeck bootstrap on macOS
3. bootstrap:
   - detect/install `Entire`
   - fetch signed app artifact for the installed version
   - copy app to `/Applications`, fallback to `~/Applications`
   - record bootstrap state
   - if interactive, offer/run prerequisite prompts

### npm Flow

`npm install -g vibedeck-cli`

Behavior:

1. install CLI/runtime files
2. run the same VibeDeck bootstrap on macOS
3. bootstrap:
   - detect/install `Entire`
   - fetch signed app artifact for the installed version
   - copy app to `/Applications`, fallback to `~/Applications`
   - record bootstrap state
   - if interactive, offer/run prerequisite prompts

### Shared Bootstrap Requirements

The bootstrap logic must be:

- idempotent
- retry-safe
- usable on upgrade as well as first install
- able to distinguish:
  - already installed
  - newly installed
  - deferred
  - failed

## App Install Destination

### Decision

Use `/Applications` first, then fallback to `~/Applications`.

Behavior:

1. attempt install/update in `/Applications/VibeDeckMac.app`
2. if permission denied or directory unavailable:
   - fallback to `~/Applications/VibeDeckMac.app`
3. print/install summary with the final location

This gives the expected system-level install location when possible without making permissions fatal.

## Entire Handling

### Install Behavior

If `Entire` is missing during bootstrap:

- Homebrew path:
  - use Homebrew install path for `Entire` if available
- npm path:
  - prefer Homebrew if installed
  - otherwise fall back to `Entire`’s official install mechanism

The bootstrap owns prerequisite installation, not the user.

### Auth Behavior

Do **not** require `entire login` to succeed during package installation.

Instead:

- if interactive, package bootstrap may offer to run it
- if the user declines or the install is non-interactive, mark `Entire` auth as pending
- `vibedeck` first run becomes the primary place to complete it

### VibeDeck-Owned Command

Add a VibeDeck surface for Entire auth:

```bash
vibedeck entire login
```

This keeps the user inside the VibeDeck command surface even though the actual auth action delegates to the `entire` CLI.

Future compatible commands may include:

```bash
vibedeck entire status
vibedeck entire doctor
```

but only `vibedeck entire login` is required for this phase.

## First-Run Prerequisite Orchestrator

### Decision

`vibedeck` itself should detect and offer to resolve missing prerequisites on first run.

This runs when the user invokes `vibedeck` interactively.

It should not block non-interactive use.

### Missing Prerequisites To Check

On macOS first run:

1. native app installed?
2. `Entire` installed?
3. `Entire` logged in?
4. README sync configured?
   - repo present
   - GitHub token present

### Prompt Behavior

If interactive and missing prerequisites exist:

- show a concise prerequisite summary
- ask whether the user wants VibeDeck to fix them now
- run only the accepted steps
- if the user cancels, continue without failing the command

If non-interactive:

- do not prompt
- print a short setup-needed message when appropriate

### Scope Boundary

This orchestrator belongs to the CLI only for this phase.

The mac app should **not** own prerequisite prompting right now.

Reason:

- the mac app does not own `Entire` or README sync configuration today
- adding setup logic there would create a second bootstrap surface
- CLI-first orchestration is simpler and more reliable

## README Sync First-Run Handling

The README sync feature already has its own explicit commands:

```bash
vibedeck readme-sync set --repo owner/repo --token <github_pat> [--branch main] [--path README.md]
vibedeck readme-sync status
vibedeck readme-sync update
vibedeck readme-sync unset
```

The first-run orchestrator should not replace them.

Instead it should:

- detect missing README sync config/token
- offer to configure them now
- internally route to the same config logic as `readme-sync set`

If declined:

- keep working normally
- let the user resume later with the explicit `readme-sync` commands

## User Experience Summary

### Happy Path

1. user installs via Homebrew or npm
2. VibeDeck installs CLI/runtime
3. on macOS, bootstrap installs `Entire` and native app bundle
4. user runs `vibedeck`
5. VibeDeck says what is still missing:
   - `Entire` login
   - README sync config/token
6. user accepts desired steps
7. VibeDeck completes them
8. future `vibedeck sync` and dashboard `/usage` Sync continue to work normally

### Deferred Path

1. user installs
2. bootstrap installs what it can
3. user declines login/setup prompts
4. VibeDeck remains installed
5. later user can run:
   - `vibedeck entire login`
   - `vibedeck readme-sync set ...`

## Failure Handling

### Hard Failures

These should fail the relevant install/bootstrap step clearly:

- matching native artifact cannot be found
- downloaded native artifact is corrupt
- app copy fails in both `/Applications` and `~/Applications`
- `Entire` installation fails completely

### Soft Failures

These should not fail overall installation:

- user declines `entire login`
- installer is non-interactive and login is deferred
- user declines README sync setup
- README sync config remains absent

### Reporting

Bootstrap and first-run output should clearly separate:

- installed
- already present
- deferred
- failed

## Commands Surface

### Existing

- `vibedeck`
- `vibedeck init`
- `vibedeck sync`
- `vibedeck readme-sync ...`

### New

Required:

```bash
vibedeck entire login
```

Recommended bootstrap/diagnostic helpers:

```bash
vibedeck install-native
vibedeck bootstrap status
```

but these are optional for the first implementation cut if the logic can remain internal.

## Release And Artifact Workflow

### Release Outputs

Each release should publish:

- npm package
- Homebrew formula update
- signed zipped `VibeDeckMac.app`
- signed `.dmg` for manual installs

### Artifact Resolution

Bootstrap needs a deterministic release URL/layout for:

- version lookup
- macOS arch lookup if needed
- checksum verification

### Upgrade Behavior

On package upgrade:

- compare installed native app version to package version
- if mismatch, fetch and replace the native app bundle
- do not re-run `entire login` if already authenticated
- do not overwrite README sync config/token

## Testing Strategy

### Unit Tests

Test installer/bootstrap decision logic for:

- macOS vs non-macOS
- interactive vs non-interactive
- `/Applications` success vs fallback to `~/Applications`
- `Entire` installed vs missing
- `Entire` logged in vs pending
- README sync configured vs missing

### Integration Tests

Test:

- Homebrew install flow behavior abstraction
- npm postinstall/bootstrap behavior abstraction
- first-run prompt sequencing
- decline/accept flows
- upgrade idempotency

### Release Verification

Validate that:

- package version matches native artifact version
- native artifact download URL resolves
- installed app bundle contains widget extension
- widget extension survives signing and packaging

### Existing Product Verification

After installation/bootstrap:

- `vibedeck` runs
- local dashboard serves
- mac app launches
- widget-capable app bundle is present
- `vibedeck sync` still drives README sync and usage state as before

## Proposed Implementation Boundaries

Recommended internal modules:

- packaging/bootstrap resolver
- native artifact installer
- `Entire` prerequisite installer/login adapter
- first-run prerequisite orchestrator
- persisted bootstrap state reader/writer
- Homebrew/npm entry shims that call shared bootstrap logic

Keep these boundaries separate so install concerns do not bleed into:

- local API
- dashboard runtime
- mac app runtime
- README sync implementation details

## Final Recommendation

Build one shared VibeDeck bootstrap path used by both Homebrew and npm.

Use signed prebuilt native artifacts, install the app bundle into `/Applications` first with fallback to `~/Applications`, auto-install `Entire`, and let interactive `vibedeck` first run guide the user through the remaining soft prerequisites:

- `Entire` login
- README sync repo/token setup

Keep the mac app out of prerequisite orchestration for now. The CLI should remain the single setup control plane.
