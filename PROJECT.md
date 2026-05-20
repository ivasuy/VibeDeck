# VibeDeck

**Version:** 0.1.3 (PR, unreleased)
**Last updated:** 2026-05-20
**Tagline:** Live AI coding spend across every tool you use, on your machine.

VibeDeck is a local-first dashboard for developers who use multiple AI coding tools. It reads local provider records, stores the usage in SQLite, and shows live cost, token, project, branch, model, and provider breakdowns without routing traffic through a proxy.

## Product Contract

VibeDeck should stay true to five promises:

| Promise | Meaning |
|---|---|
| Live | Active sessions update quickly in the dashboard, Mac app, menubar, and widgets. |
| Multi-provider | Claude, Codex, Cursor, Gemini, Copilot, OpenCode, Kiro, and other local providers roll into one view where data is available. |
| Local-first | Usage is read and stored on the user's machine. No hosted service is required. |
| Branch-aware | When evidence exists, spend is attributed to project, repo, worktree, branch, and session. |
| Honest | Unknown data stays visible as unknown. VibeDeck must not fake precision. |

## Current Surfaces

| Surface | Purpose |
|---|---|
| Web dashboard | Deep view for live sessions, projects, branches, usage, models, and providers. |
| Mac app | Native desktop shell for the dashboard. |
| Menubar and widgets | Glanceable live spend and session state. |
| CLI (`vibedeck`) | Sync, serve, status, doctor, README banner, and project README commands. |
| Local server | HTTP and SSE backend used by the dashboard and native surfaces. |

## Release Audit History

This section is intentionally short. It records the problem, the fix, the evidence, and the commits worth reading. It is not a raw commit dump.

### 0.1.3 PR - Trust Foundation And Rebuild Speed

**Status:** PR, unreleased.

**Branches:**

| Branch | Purpose |
|---|---|
| `release/0.1.3` | Main PR branch. |
| `agent/phase-1-5-historical-branch-recovery` | Branch attribution trust work. |
| `agent/sync-rebuild-performance` | Safe rebuild and first performance pass. |
| `agent/phase-a-sync-rebuild-safe-speedup` | Rebuild speedup without reducing data richness. |

#### Problem

Branch and project attribution had too many ways to be wrong:

- `/dashboard`, `/usage`, and `/branches` could disagree because they read different sources.
- Cross-branch sessions could charge the wrong branch.
- Old sessions with missing branch data became `Unknown branch`, even when provider logs had clean branch proof.
- Git fallback could surface unsafe names like tags or detached refs as user-facing branches.
- Old unclosed live transcripts could make a previous branch look active after work moved to a newer branch in the same workspace.
- Full rebuilds were safer after the first pass, but still too slow for heavy users.

#### What Changed

- Added a canonical branch usage projection so branch-aware surfaces read the same source.
- Changed branch allocation to use recorded usage events instead of elapsed-time guesses.
- Repaired project attribution before branch fact rebuilds, so resolvable historical sessions can re-enter project views.
- Added safe historical branch recovery when local Git can prove a clean branch.
- Added `Historical unknown` for old rows that belong to a project but cannot safely be assigned to a branch.
- Extracted clean branch proof from Codex `payload.git.branch` and Claude `gitBranch` while parsing logs.
- Preferred provider branch proof before Git fallback.
- Cached Git fallback metadata and hid unsafe refs from user-facing branch usage.
- Decoupled GitHub README banner writes from `sync` and `serve`; banner updates are explicit commands now.
- Added staged rebuild output so failed rebuilds do not leave the live DB half-built.
- Added rebuild-only batch session processing so historical rebuilds avoid repeated per-event recomputation.
- Reused provider branch evidence during rebuild instead of rereading the same provider logs repeatedly.
- Changed provider fallback branch recovery to stream files instead of loading and splitting whole logs.
- Flushed rebuild session batches per provider file, reducing long-lived in-memory event groups.
- Added live-scale verification fixtures for token, cost, branch, and unknown-fallback preservation.
- Added live supersession state so an older open session becomes stale when a newer same-provider, same-repo, same-cwd session is active on another branch.
- Kept parallel live work visible for different providers and separate worktrees.
- Updated the frontend fallback workstream grouping to treat superseded open sessions as stale.

#### Evidence

Live DB after a real rebuild against local data:

| Metric | Result |
|---|---:|
| SQLite `quick_check` | `ok` |
| Sessions | 1,026 |
| Session events | 42,938 |
| Branch usage facts | 1,027 |
| Session buckets | 1,698 |
| `Unknown branch` with cost | 1 real project, `$97.4731` |
| `Historical unknown` with cost | 2 real projects, `$380.4749` |

Before this work, the audit showed 8 `Unknown branch` projects costing `$616.5441` and 3 `Historical unknown` projects costing `$414.5178`.

The remaining unknown cost is intentional. If the app cannot prove the branch, it should show an honest bucket instead of inventing one.

Live branch-state verification after the supersession fix:

| Branch | Codex facts | Tokens | Cost |
|---|---:|---:|---:|
| `entire/ui-fix` | 22 | 286,540,055 | `$214.3296` |
| `release/0.1.3` | 68 | 145,848,722 | `$100.3989` |

The active/stale label can change as live sessions move or idle out, but these totals stay on their original branches.

#### Important Commits

| Area | Commits |
|---|---|
| Canonical branch facts | `0df6401`, `871aee5`, `9c769a4`, `68ddd49`, `a9f1a28` |
| Project repair and README identity | `47f6ef8`, `f5a2b78`, `60e0e92` |
| Branch drawer and dashboard stability | `db0e848`, `1d79409`, `bda06fd`, `cf5943f` |
| Safe historical recovery | `e32421a`, `4eae109`, `ee16b2b`, `a7766c4`, `f55034a` |
| Provider branch proof | `396c1a8`, `1fa2221`, `dcfdc66`, `2d23acb`, `c91af76` |
| Git fallback and unsafe refs | `10eb7b9`, `883d7c2`, `6f8199e`, `97093b1`, `8006b83` |
| Rebuild safety and batching | `25c32d2`, `ad28830`, `ab0949b`, `49f100a`, `ae5471e` |
| Rebuild progress and guards | `b2825aa`, `c6b8e42`, `777c605` |
| README and banner behavior | `86876bd`, `81a692b`, `9025c96` |
| Skills and local dashboard polish | `2f3a586`, `5066a76`, `d44d773` |
| Phase A rebuild speedup | `d862ab4`, `c22a4ba`, `082c6eb`, `67ad61b`, `13d32d4`, `f46c4c4` |
| Live branch supersession | `e5120ef`, `60e8488`, `424d2e0`, `1511ddd` |

#### Rebuild Performance

The rebuild is now safe and materially faster, but still not at the user-feel target.

| Stage | Result |
|---|---:|
| Pre-fix failure mode | `30+ minutes`, manually stopped |
| First safe measured rebuild | `10m 32s` |
| Phase A live rebuild after speedup | `5m 59s` |
| Target | `1-2 minutes` |

What improved:

- The worst repeated provider-log reread path was removed from the rebuild loop.
- Branch evidence is carried forward from the provider parse path instead of rediscovered late.
- Fallback branch recovery is streaming, so large logs no longer need full-file materialization.
- Rebuild batches are released per file/session instead of held until the full parser drain.

What remains:

- Keep serving the last complete DB while a staged rebuild runs in the background.
- Start serving immediately instead of blocking `serve` on startup sync/index rebuild.
- Persist file/session fingerprints so unchanged historical logs can be skipped.
- Stop retrying known-unrepairable historical attribution rows every startup.
- Add recent-first rebuild so current work appears quickly while older history backfills.
- Add materialized read models for `/usage`, `/dashboard`, and `/branches` at 10x data.

Data richness must stay intact: provider, model, hour, token buckets, cost quality, project, repo, worktree, branch confidence, branch kind, date buckets, session drawer details, and live session updates.

### 0.1.2 - Publish And Public README Cleanup

**Status:** released on `main`.

#### Problem

The first public release path still had packaging and presentation rough edges:

- CLI publish dependencies needed a final fix.
- The README needed to explain the product clearly instead of looking like an internal build log.
- Local-only assets needed to stay out of the tracked release surface.

#### What Changed

- Fixed CLI publish dependencies.
- Reworked the README into a product-facing showcase.
- Cleaned media links and provider presentation.
- Stopped tracking local-only release artifacts.

#### Important Commits

| Area | Commits |
|---|---|
| CLI publish fix | `4076520` |
| README product showcase | `aaef604`, `2fb66a0`, `43a5b87`, `924d767` |
| Media and local artifact cleanup | `bde999f`, `3a70aa7`, `4ca01a2`, `333935d` |

#### Lesson

A release is not only code. If install, packaging, and the first README screen are confusing, users will not reach the product value.

### 0.1.1 - First Public Release

**Status:** released and tagged as `v0.1.1`.

#### Problem

VibeDeck needed a shippable baseline:

- Local usage had to be captured into a stable store.
- Live updates had to be dependable enough for the dashboard and native surfaces.
- The Mac app and CLI needed a working release path.
- Checkpoint and branch context needed to be linked without breaking cost totals.

#### What Changed

- Added the first public release packaging path for npm, Mac assets, and Homebrew planning.
- Added first-run bootstrap and native app installer support.
- Hardened live SSE rollups and recent-session behavior.
- Added canonical cost summary helpers and stable release audit checks.
- Linked Entire checkpoint metadata to usage sessions and surfaced checkpoint usage status.
- Added README banner generation from local canonical usage.

#### Important Commits

| Area | Commits |
|---|---|
| Release tag and packaging | `b6762ba`, `9f001bd`, `01a79f4` |
| Bootstrap and native app | `63c2871`, `046bd60`, `762ee99`, `7098780` |
| Live rollups and attribution payloads | `6859924`, `49a3645`, `4f8f42f`, `6e71898` |
| Cost summary and audit checks | `46f56bd`, `e75d6c9`, `6eadbe0`, `c2c9c78` |
| Entire checkpoint linking | `a7de2a6`, `bc8397d`, `cecbe06`, `2230efb` |
| README banner | `a770206`, `96f6bd9`, `179e256`, `6ba8286` |

#### Lesson

The first useful version proved the shape: local data, live UI, native shell, and historical context can work together. The later releases are mostly about making that data more honest, faster, and easier to explain.

## Known Boundaries

VibeDeck should not overclaim these areas yet:

- Provider attribution is mixed. Some providers do not expose enough local project or branch context.
- Pricing remains best-effort where providers hide billing details, subscription quotas, web search charges, or special cache tiers.
- Cursor Auto and subscription-style billing are estimates, not exact invoice totals.
- Full export, model comparison, task/activity classification, waste scanning, and productivity scoring are not part of the current release.
- VibeDeck is not a hosted service, proxy, compliance product, prompt inspector, or team-sharing platform.

## Release Rule

Every release note should answer four questions:

1. What user-visible problem existed?
2. What changed to solve it?
3. What evidence proves the fix?
4. What is still deliberately not claimed?

### 0.1.3 PR - Phase H: Rebuild Hot-Path Reduction (Incomplete Speed Gate)

**Status:** implemented, verified, speed target missed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h-rebuild-hot-path-reduction.md`  
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h-smoke-evidence.md`  
**Artifacts:** `docs/superpowers/plans/phase-h-smoke-artifacts/`

#### What changed

- Added rebuild profile stage decomposition and scoped counters so the hot path is measurable and no longer hidden in broad stage names.
- Added `VIBEDECK_REBUILD_RECENT_FASTPATH=1` and lane-aware grouped flush behavior to prevent recent-lane groups from being drained by historical file completions.
- Added `VIBEDECK_REBUILD_DIRTY_POST_DRAIN=1` to scope repair and branch-fact rebuild to dirty sessions when available, with safe full-rebuild fallback when scope is unavailable.
- Added a Phase H rebuild smoke harness (`scripts/smoke/rebuild-hot-path-phase-h.cjs`) that captures wall clock, top stages, and explicit gate pass/fail.

#### Measured outcome on local corpus

| Metric | Value |
|---|---:|
| Baseline wall clock | `4m 28.89s` |
| Phase H wall clock | `5m 48.98s` |
| Phase H target | `3m 15s` |
| Gate result | `fail` |
| Dominant stage | `recent_lane_session_event_flush` (`127,905.923ms`) |

#### Integrity checks

| Check | Result |
|---|---|
| Rebuild/parity-focused suites | Passed (`19` tests, `0` failed) |
| Dashboard targeted usage/branches tests | Partial | `BranchesPage.test.jsx` passed (`17` tests); `UsageOverview.test.jsx` was not present in this branch, so `/usage` and `/dashboard` UI smoke coverage remains uncovered in Phase H |
| No-token-loss proof gate | Uncovered on this branch lineage (`missing_collect_rollout_source_deltas_api`) |

#### What remains

- The hot bottleneck is still synchronous recent-lane session-event flush.
- Branch-fact and repair passes are still expensive even after dirty scoping.
- Phase H should be treated as observability + correctness-hardening for the next speed iteration, not as a final speed win.

### 0.1.3 PR - Phase H.1: Recent Flush Batching (Incomplete Speed Gate)

**Status:** implemented, verified, speed target missed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h1-recent-flush-batching.md`  
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h1-smoke-evidence.md`  
**Artifacts:** `docs/superpowers/plans/phase-h1-smoke-artifacts/`

#### What changed

- Added rebuild-only flush slice controls so grouped historical session events are flushed by bounded slices instead of every file completion.
- Kept recent-lane grouped events deferred until explicit lane drain while preserving canonical totals and branch/window parity in rebuild tests.
- Added a Phase H.1 smoke artifact pack that reports wall clock, top stages, flush-count movement, and explicit gate pass/fail.

#### Measured outcome on local corpus

| Metric | Phase H baseline | Phase H.1 result | Gate |
|---|---:|---:|---|
| Wall clock | `5m 48.98s` | `6m 08.37s` | Fail |
| Target wall clock | n/a | `4m 00s` | Missed by `128,366ms` |
| `recent_lane_session_event_flush` | `127,905.923ms` | `309,554.010ms` | Fail |
| Flush count | `409` | `10` | Pass |

Flush batching reduced flush count from `409` to `10`, but it did not improve end-to-end rebuild time. The dominant stage moved in the wrong direction, so Phase H.1 is not a speed win.

#### Integrity checks

| Check | Result |
|---|---|
| Rebuild/parity-focused suites | Passed (`21` tests, `0` failed) |
| Dashboard targeted usage/branches command | Uncovered at exact required command (`vitest` missing in this worktree); branch contains `BranchesPage.test.jsx` but no `UsageOverview.test.jsx` |
| No-token-loss proof gate | Uncovered on this branch lineage (`missing_collect_rollout_source_deltas_api`) |

#### What remains

- The next bottleneck is no longer flush count alone; the grouped flush work itself dominates and needs profiling inside `recent_lane_session_event_flush`.
- UI smoke coverage for `/usage` remains uncovered on this branch because `UsageOverview.test.jsx` is absent.
- The no-token-loss proof harness needs a compatible source-delta collector before it can prove source-vs-canonical token preservation on this lineage.
