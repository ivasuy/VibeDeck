# VibeDeck

**Version:** 0.1.4 (PR, unreleased)
**Last updated:** 2026-05-23
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

### 0.1.4 PR - Provider Enrichment And Subagent Grouping

**Status:** in progress on stacked agent branches, unreleased.

**Branches:**

| Branch | Purpose |
|---|---|
| `agent/phase-1-claude-codex-enrichment` | Phase 1: Claude/Codex cost, token-bucket, tool, and session enrichment. |
| `agent/phase-1-5-subagent-grouping` | Phase 1.5: Claude/Codex subagent grouping as an additive read-model layer. |

#### Problem

The 0.1.3 work made attribution safer, but the product still lacked enough session-level richness for heavy Claude Code and Codex users:

- `/usage`, `/dashboard`, and `/branches` could show totals without enough detail about why a session cost what it cost.
- Claude cache/token-bucket behavior and Codex reasoning/tool activity were not carried consistently through live, branch, and drawer payloads.
- Main sessions and spawned subagents appeared as separate raw sessions, which made agentic runs hard to understand even when provider logs had proof of parent/child relationships.
- Any grouping work had to preserve the honesty rules from 0.1.3: no fake branch inheritance, no token/cost movement, and no loss of `Unknown` or `Historical unknown` buckets.

#### Phase 1 - Claude/Codex Cost And Session Enrichment

**Plan direction:** provider expansion, richer Claude/Codex session facts, and deeper usage drilldown without changing the canonical totals contract.

What changed:

- Added session enrichment schema and carried enrichment data through session events, session rows, branch facts, bucket facts, live rollups, and drawer APIs.
- Extracted Claude cache and tool enrichment from local Claude Code records.
- Extracted Codex tool enrichment and persisted pending Codex tool calls across parse boundaries.
- Added shadow enhanced cost calculation, then used enhanced token buckets for Claude/Codex cost estimates where provider data supports it.
- Exposed enrichment in live and branch rollups so `/dashboard`, `/branches`, and side drawers can show richer model/tool/cost quality context.
- Added reconciliation guardrails so enriched cost views do not silently break canonical usage totals.

Evidence from local machine:

| Check | Result |
|---|---:|
| Targeted Phase 1 test suite | `166/166` passed |
| Copied-live DB `/usage` smoke | `131ms` |
| Copied-live DB `/branches` smoke | `36ms` |
| Copied-live DB live snapshot smoke | `132ms` |
| Copied-live DB branch drawer smoke | `43ms` |
| Isolated real-log rebuild wall clock | `368.6s` |
| Rebuilt files | `998` |
| Rebuilt sessions | `934` |
| Rebuilt session events | `49,369` |
| Rebuilt branch facts | `935` |
| Enriched sessions | `878` |
| `Unknown` facts | `1` |
| `Historical unknown` facts | `58` |

Full-suite status after Phase 1: `1,131` passed, `12` failed, `1` cancelled. The failing group was the known baseline outside the new enrichment path: init/uninstall, serve session pipeline, sync entire checkpoint backfill, OpenClaw trigger, and rebuild DB tests.

Important commits:

| Area | Commits |
|---|---|
| Enrichment schema and carry-through | `9214517`, `142ed3c`, `65edd77` |
| Claude/Codex extraction | `10b2252`, `3fb2e77`, `abe0fdb` |
| Enhanced cost and token buckets | `a85f2df`, `be6f00a`, `e8dadea` |
| Facts and APIs | `77a2147`, `03e1045`, `8504764` |
| UI and reconciliation | `9d60b41`, `5011948`, `ba10d38`, `0da6c6f` |

#### Phase 1.5 - Claude/Codex Subagent Session Grouping

**Plan:** `docs/superpowers/plans/2026-05-23-claude-codex-subagent-session-grouping.md`

What changed:

- Added additive grouping tables: `vibedeck_session_group_edges` and `vibedeck_session_group_skips`.
- Added Claude subagent grouping from local transcript path proof: root transcript plus sibling `subagents/*.jsonl`.
- Added Codex subagent grouping from `session_meta` thread-spawn proof only.
- Added sync-time projection rebuild and diagnostics at `diagnostics/session-groups.json`.
- Added branch read-model grouping that annotates raw sessions and returns `session_groups` only in `preview`/`on`.
- Added live snapshot grouping without changing SSE raw-session routing.
- Added group cards in `/branches` drawer and live/dashboard workstream drawer.
- Kept raw sessions visible under `Raw sessions`; group cards are additive, not replacements.

Safety rules preserved:

- No token or cost movement between sessions, branches, projects, or providers.
- No branch inheritance from parent to child sessions.
- `Unknown` and `Historical unknown` remain honest buckets.
- Group cost is `null` if any member cost is unknown, while `known_cost_usd` still reports finite known cost.
- Default mode is `VIBEDECK_SESSION_GROUPING_V1=shadow`; UI/API group cards require `preview` or `on`.

Evidence from local machine:

| Check | Result |
|---|---:|
| Targeted backend reconciliation | `54/54` passed |
| Dashboard group-card tests | `28/28` passed |
| Dashboard production build | Passed, existing large-chunk warning only |
| Copied-live DB SQLite `quick_check` | `ok` |
| Copied-live DB `/usage` preview vs shadow | Totals unchanged |
| Copied-live DB `/branches` preview vs shadow | Totals unchanged |
| Copied-live DB raw branch sessions | `1,152` |
| Copied-live DB `Historical unknown` facts | `58` |
| Copied-live DB API `Historical unknown` rows | `2` |
| Copied-live DB API timings | `/usage` `10.9-20.1ms`, `/branches` `18.4-30ms`, live `123.6ms` |
| Isolated real-log rebuild wall clock | `370.846s` |
| Rebuilt files | `1,013` |
| Rebuilt sessions | `949` |
| Rebuilt branch facts | `950` |
| Rebuilt session group edges | `594` |
| Rebuilt session group skips | `2` |
| Rebuilt `Unknown` facts | `0` |
| Rebuilt `Historical unknown` facts | `58` |
| Rebuilt DB API timings | `/usage` `23.7ms`, `/branches` `65.9ms`, live `144.1ms` |

Full-suite status after Phase 1.5: `1,146` passed, `14` failed. The failures remained outside the session-grouping, branch grouping, live snapshot grouping, pricing, and dashboard group-card paths: init local runtime, init uninstall, serve session pipeline, entire checkpoint backfill, OpenClaw trigger, and rebuild DB tests.

Important commits:

| Area | Commits |
|---|---|
| Implementation plan | `406e9a9` |
| Group schema and projection | `5870684`, `5a81944`, `dcf2989`, `1e9ba53` |
| Branch read model | `4f87dbf`, `7b3ce75` |
| Live read model | `4c10e9c`, `fb9f887` |
| Dashboard group cards | `27162ff` |

#### Phase 2 - Tier 1+2 Provider Breadth

**Date:** 2026-05-23
**Branch:** `agent/phase-2-tier-1-2-provider-breadth`
**Plan:** `docs/superpowers/plans/2026-05-23-phase-2-tier-1-2-provider-breadth.md`

What changed:

- Repaired proof-backed cwd pass-through for OpenCode, OMP, Pi, Copilot, and Kiro CLI where the local provider source exposes a real workspace path.
- Added Goose and Crush provider ingestion through the canonical `SessionEvent` pipeline.
- Kept Cursor account CSV as account-level/provider-only data; no fake branch/project attribution is inferred.
- Preserved `/dashboard`, `/usage`, `/branches`, `Unknown branch`, `Historical unknown`, and session grouping totals through smoke checks.
- Inspected dashboard and Mac provider display paths and left UI code unchanged: existing dashboard provider icons/text handle arbitrary provider ids honestly, and providers without committed assets continue to use generic fallback rendering.

Smoke results:

| Check | Result |
|---|---:|
| Exact dashboard test command from plan | Failed before running tests: `npm --prefix dashboard` makes `dashboard/` the package root, so `dashboard/src/pages/...` filters matched no files |
| Dashboard page tests with package-root-relative paths | `21/21` passed |
| Dashboard production build | Passed, existing large-chunk warning only |
| Backend provider/session/branch smoke suite | `168/168` passed |
| Copied-live DB sessions | `1,202` |
| Copied-live DB `Unknown branch` facts | `1` |
| Copied-live DB `Historical unknown` facts | `58` |
| Copied-live DB provider rows | Claude `94`, Codex `864`, Cursor `242`, Gemini `2` |
| Isolated rebuild wall clock | `365s` |
| Isolated rebuild sessions | `1,202` |
| Isolated rebuild session events | `51,407` |
| Isolated rebuild branch facts | `1,203` |
| Isolated rebuild `Unknown branch` facts | `1` |
| Isolated rebuild `Historical unknown` facts | `58` |
| Isolated rebuild session group edges/skips | `605` / `2` |
| Isolated rebuild provider rows | Claude `94`, Codex `864`, Cursor `242`, Gemini `2` |
| Isolated rebuild doctor | `ok: true`; non-critical `base_url` fail plus expected local config/device-token warnings |

Caveats:

- `dashboard/node_modules` was absent in the task worktree, so dashboard dependencies were installed locally before smoke checks; no tracked files changed from install.
- The CLI supports `sync --rebuild-vibedeck-db` but not the plan's `--no-progress`, so the isolated rebuild used `--auto`.
- The plan's copied-live path `~/.vibedeck/vibedeck.sqlite3` is a zero-byte placeholder on this machine; copied-live DB smoke used the actual tracker DB at `~/.vibedeck/tracker/vibedeck.sqlite3`.
- `VIBEDECK_HOME=<tmp>` alone makes this CLI discover provider logs under the temp home too, producing an empty rebuild. The measured rebuild used a temporary `HOME` with symlinks to provider log directories and an isolated temp `.vibedeck/tracker` DB, so no live DB writes occurred.
- Cursor IDE local composer workspace mapping remains a future adapter, not part of account CSV.
- Goose/Crush grouping support is explicitly `none` until those providers expose parent-child proof.

#### Phase 3 - Tier 3+4 Provider Breadth

**Date:** 2026-05-23
**Branch:** `agent/phase-3-tier-3-4-provider-breadth`
**Plan:** `docs/superpowers/plans/2026-05-23-phase-3-tier-3-4-provider-breadth.md`

What changed:

- Added missing Tier 3+4 session-safe providers through canonical `SessionEvent` ingestion.
- Hardened Gemini, Kiro IDE, and OpenClaw so cwd is used only when local proof exists.
- Added Droid, Qwen, Cursor Agent, Antigravity, and Cline-family adapters with provider-only/cwd-optional honesty rules.
- Preserved `/dashboard`, `/usage`, `/branches`, `Unknown branch`, `Historical unknown`, and session grouping totals through smoke checks.

Smoke results:

| Check | Result |
|---|---:|
| Backend provider/session/branch smoke suite | `192/192` passed |
| Dashboard page tests | `21/21` passed |
| Dashboard production build | Passed, existing large-chunk warning only |
| Copied-live DB sessions/events/branch facts | `1,214` / `53,517` / `1,152` |
| Copied-live DB Unknown/Historical | `1` / `58` |
| Copied-live DB provider rows | Claude `94`, Codex `876`, Cursor `242`, Gemini `2` |
| Isolated rebuild wall clock | `339s` |
| Isolated rebuild sessions/events/branch facts | `972` / `51,040` / `973` |
| Isolated rebuild Unknown/Historical | `1` / `58` |
| Isolated rebuild providers | Claude `94`, Codex `876`, Gemini `2` |
| Isolated rebuild doctor | `ok: 14`, `warn: 5`, `fail: 1`, `critical: 0`; expected missing `base_url` fail and local config warnings |
| Direct branch-fact write boundary scan | Passed: provider adapters do not write `vibedeck_branch_usage_facts` directly |

Caveats:

- Antigravity `.pb` files remain provider-only and unparsed unless a JSON usage cache exists.
- Cursor Agent transcript rows are estimated when numeric token fields are absent.
- Cline-family rows are branch/project eligible only when `Current Workspace Directory (...)` contains an absolute path.
- `dashboard/node_modules` was absent in the task worktree, so dashboard dependencies were installed locally before smoke checks; no tracked files changed from install. The install/audit output reported `9` dependency audit warnings (`7` moderate, `2` high, `0` critical); this is an existing packaging/frontend follow-up, not a Phase 3 smoke failure.
- The legacy copied-live path `~/.vibedeck/vibedeck.sqlite3` is a zero-byte placeholder on this machine; copied-live DB smoke used the actual tracker DB at `~/.vibedeck/tracker/vibedeck.sqlite3`.
- The isolated rebuild used a temporary `HOME` with symlinks to provider log directories and an isolated temp `.vibedeck/tracker` DB, so no live DB writes occurred.
- The isolated rebuild's doctor output still reports the existing non-critical local configuration state: missing `base_url`, missing device token/config, unattributed distribution warning, and one stale live-session warning.

#### What Remains For 0.1.4

- Decide whether subagent grouping should stay in `shadow`, move to `preview`, or become default-on after more local/beta soak.
- Add grouping support for other providers only where provider logs expose proof, not heuristics.
- Continue provider expansion and tool/activity drilldowns beyond Claude/Codex.
- Keep fixing the unrelated full-suite baseline failures before treating the whole repository as release-clean.

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

### 0.1.3 PR - Phase H.2: Mixed-Lane Flush Splitting (Incomplete Speed Gate)

**Status:** implemented, verified, speed target missed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h2-mixed-lane-flush-splitting.md`
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h2-smoke-evidence.md`
**Artifacts:** `docs/superpowers/plans/phase-h2-smoke-artifacts/`

#### What changed

- Split grouped rebuild session-event buffers by lane so historical events can flush without forcing recent events in the same session to drain early.
- Added `VIBEDECK_REBUILD_SESSION_BATCH_EVENTS=1000` as a rebuild-only cap for grouped session-event processor calls.
- Added H.2 smoke artifacts for the benchmark profile, benchmark summary, and no-token-loss proof status.
- Recorded explicit pass, fail, and uncovered gates instead of treating missing commands as silent success.

#### Measured outcome on local corpus

| Metric | Phase H.1 baseline | Phase H.2 result | Gate |
|---|---:|---:|---|
| Wall clock | `6m 08.37s` | `6m 06.30s` | Fail |
| Target wall clock | n/a | `5m 00s` | Missed by `66,301ms` |
| `recent_lane_session_event_flush` | `309,554.010ms` | `307,974.929ms` | Fail |
| Flush count | `10` | `11` | Pass |

H.2 improved wall clock by only `2,065ms` and improved the dominant flush stage by only `1,579.081ms` versus H.1. The rebuild command itself exited cleanly, but the H.2 smoke gate remains failed because both speed targets were missed.

#### Integrity checks

| Check | Result |
|---|---|
| Rebuild/parity-focused suites | Passed (`24` tests, `0` failed) |
| H.2 benchmark gate | Failed (`366,301ms` wall clock; `307,974.929ms` `recent_lane_session_event_flush`) |
| Dashboard targeted usage/branches command | Uncovered (`vitest` missing in this worktree; `UsageOverview.test.jsx` absent on this branch) |
| No-token-loss proof gate | Uncovered (`missing_collect_rollout_source_deltas_api`) |

#### What remains

- `recent_lane_session_event_flush` is still the dominant bottleneck and needs inner-stage profiling or a deeper write-path redesign.
- Flush count stayed bounded, so the remaining speed issue is not just number of flushes.
- UI smoke coverage still needs installable dashboard test dependencies and an actual `/usage` test file on this branch.
- The no-token-loss proof harness still needs a compatible source-delta collector before it can prove source-vs-canonical token preservation.

### 0.1.3 PR - Phase H.3: Defer Branch-Fact Rebuild In Flush Path (Incomplete Speed Gate)

**Status:** implemented, benchmarked, overall speed target missed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h3-defer-branch-fact-rebuild.md`
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h3-smoke-evidence.md`
**Artifacts:** `docs/superpowers/plans/phase-h3-smoke-artifacts/`

#### What changed

- Deferred inline branch-fact rebuild work during rebuild session-event flushing when dirty post-drain rebuild is enabled.
- Kept the post-drain dirty branch-fact rebuild pass as the single rebuild source of truth for the affected mode.
- Added H.3 smoke artifacts for the benchmark profile and benchmark summary.
- Recorded that the flush-stage gate passed while the wall-clock and branch-fact gates failed.

#### Measured outcome on local corpus

| Metric | Phase H.2 baseline | Phase H.3 result | Gate |
|---|---:|---:|---|
| Wall clock | `366,301ms` | `337,412ms` | Fail |
| Target wall clock | n/a | `300,000ms` | Missed by `37,412ms` |
| `recent_lane_session_event_flush` | `307,974.929ms` | `218,370.394ms` | Pass |
| `branch_fact_rebuild_pass` | `25,939.595ms` | `27,321.343ms` | Fail |

H.3 improved wall clock by `28,889ms` versus H.2 and reduced `recent_lane_session_event_flush` by `89,604.535ms`, but it did not meet the `300,000ms` wall-clock target. The benchmark result remains failed, and this phase should not be described as a target success.

Raw artifact values: `wall_clock_ms=337412`, `wall_clock_target_ms=300000`, `flush_stage_ms=218370.394`, `branch_fact_stage_ms=27321.343`.

#### Integrity checks

| Check | Result |
|---|---|
| H.3 benchmark gate | Failed (`337,412ms` wall clock; target `300,000ms`) |
| Flush-stage gate | Passed (`218,370.394ms`; target `220,000ms`) |
| Branch-fact gate | Failed (`27,321.343ms`; baseline/target `25,939.595ms`) |
| Rebuild/parity-focused suites | Uncovered in the current H.3 evidence artifacts; the available artifacts only record benchmark summary/profile output |
| Dashboard targeted usage/branches command | Uncovered in the current H.3 evidence artifacts |
| No-token-loss proof gate | Uncovered in the current H.3 evidence artifacts |

#### What remains

- Overall rebuild time still needs another reduction of at least `37,412ms` to meet the current target.
- `repair_pass` (`65,127.053ms`) and `branch_fact_rebuild_pass` (`27,321.343ms`) are now the largest non-flush stages after the H.3 flush improvement.
- The branch-fact pass regressed against the H.2 baseline target, so the next phase should profile or reduce dirty branch-fact rebuild cost.
- H.3 needs separately recorded parity, dashboard, and no-token-loss evidence before those checks can be claimed as covered for this phase.

### 0.1.3 PR - Phase H.4: Repair Pass De-Duplication (Incomplete Gate)

**Status:** implemented, benchmarked, overall gate failed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h4-repair-pass-dedupe.md`  
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h4-smoke-evidence.md`  
**Artifacts:** `docs/superpowers/plans/phase-h4-smoke-artifacts/`

#### What changed

- Removed duplicate branch-fact rebuild work from the dirty rebuild repair path when the post-drain branch-fact pass is guaranteed to run.
- Kept `repair_pass` responsible for recovering project/repo attribution, while `branch_fact_rebuild_pass` remains the single materialization pass for dirty branch facts in this mode.
- Added H.4 smoke artifacts for benchmark profile and benchmark summary.
- Recorded the artifact result honestly as `fail`, even though the wall-clock and repair-pass gates passed.

#### Measured outcome on local corpus

| Metric | H.3 baseline | H.4 result | Gate |
|---|---:|---:|---|
| Wall clock | `337,412ms` | `284,982ms` | Pass |
| Target wall clock | n/a | `300,000ms` | Passed by `15,018ms` |
| `repair_pass` | `65,127.053ms` | `36,400.351ms` | Pass |
| `branch_fact_rebuild_pass` | `27,321.343ms` | `28,946.879ms` | Fail |

H.4 improved wall clock by `52,430ms` versus H.3 and reduced `repair_pass` by `28,726.702ms`. The overall summary result is still `fail` because `branch_fact_rebuild_pass` regressed by `1,625.536ms` versus the H.3 baseline target.

Raw artifact values: `wall_clock_ms=284982`, `wall_clock_target_ms=300000`, `repair_pass_ms=36400.351`, `branch_fact_rebuild_pass_ms=28946.879`.

#### Integrity checks

| Check | Result |
|---|---|
| H.4 benchmark gate | Failed overall (`branch_fact_rebuild_pass` `28,946.879ms`; target `27,321.343ms`) |
| Wall-clock gate | Passed (`284,982ms`; target `300,000ms`) |
| Repair-pass gate | Passed (`36,400.351ms`; baseline/target `65,127.053ms`) |
| Branch-fact gate | Failed (`28,946.879ms`; baseline/target `27,321.343ms`) |
| Parity/no-token-loss proof | Uncovered in the current H.4 evidence artifacts; the available artifacts only record benchmark summary/profile output |

#### What remains

- The prior `repair_pass` bottleneck is materially reduced but not a full phase success because the artifact's overall result is `fail`.
- The bottleneck has shifted to dirty `branch_fact_rebuild_pass` cost.
- The next phase should reduce dirty branch-fact rebuild work or split its cost further before claiming the rebuild speed gate is solved.
- H.4 needs separately recorded parity and no-token-loss evidence before those checks can be claimed as covered for this phase.

### 0.1.3 PR - Phase H.5: Branch-Fact Head-History Cache (Incomplete Gate)

**Status:** implemented, benchmarked, overall gate failed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h5-branch-fact-head-history-cache.md`
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h5-smoke-evidence.md`
**Artifacts:** `docs/superpowers/plans/phase-h5-smoke-artifacts/`

#### What changed

- Routed Tier-B head-history branch lookups in the branch-fact rebuild pass through the active rebuild DB handle and a shared per-run cache.
- Cached head-history transitions by `worktree_root` and resolved the branch in memory with binary search.
- Preserved the existing `findBranchAt` fallback for call sites that do not provide the active DB/cache path.
- Added H.5 smoke artifacts for benchmark profile and benchmark summary.
- Recorded the artifact result honestly as `fail`, even though the targeted `branch_fact_rebuild_pass` gate passed.

#### Measured outcome on local corpus

| Metric | H.4 baseline | H.5 result | Gate |
|---|---:|---:|---|
| Wall clock | `284,982ms` | `285,133ms` | Pass |
| Target wall clock | n/a | `300,000ms` | Passed by `14,867ms` |
| `repair_pass` | `36,400.351ms` | `37,710.939ms` | Fail |
| `branch_fact_rebuild_pass` | `28,946.879ms` | `25,900.448ms` | Pass |

H.5 improved the targeted `branch_fact_rebuild_pass` by `3,046.431ms` versus H.4, so the branch-fact bottleneck moved in the right direction. The overall result is still `fail` because `repair_pass` regressed by `1,310.588ms` versus the H.4 target, and wall clock was essentially flat at `+151ms` versus H.4.

Raw artifact values: `wall_clock_ms=285133`, `wall_clock_target_ms=300000`, `repair_pass_ms=37710.939`, `branch_fact_rebuild_pass_ms=25900.448`, `overall result=fail`.

#### Integrity checks

| Check | Result |
|---|---|
| H.5 benchmark gate | Failed overall (`repair_pass` `37,710.939ms`; target `36,400.351ms`) |
| Wall-clock gate | Passed (`285,133ms`; target `300,000ms`) |
| Repair-pass gate | Failed (`37,710.939ms`; baseline/target `36,400.351ms`) |
| Branch-fact gate | Passed (`25,900.448ms`; baseline/target `28,946.879ms`) |

#### What remains

- H.5 should be treated as a targeted branch-fact-pass improvement, not as a full rebuild-speed success.
- The prior dirty `branch_fact_rebuild_pass` bottleneck improved enough to pass its H.4 gate.
- The remaining failed gate is `repair_pass`, and the profile still shows `recent_lane_session_event_flush` as the largest stage at `213,642.585ms`.
- The next phase should reduce or stabilize `repair_pass` while preserving the H.5 `branch_fact_rebuild_pass` improvement.

### 0.1.3 PR - Phase H.6: Repair Resolve Cache (Gate Passed)

**Status:** implemented, benchmarked, overall gate passed.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h6-repair-resolve-cache.md`
**Evidence:** `docs/superpowers/plans/2026-05-20-phase-h6-smoke-evidence.md`
**Artifacts:** `docs/superpowers/plans/phase-h6-smoke-artifacts/`
**Pre-merge audit:** `docs/superpowers/plans/2026-05-21-phase-h6-pre-merge-audit.md`

#### What changed

- Memoized `resolveRepo(cwd)` results inside the repair attribution pass for the duration of one rebuild run.
- Cached both successful repo resolutions and null/negative outcomes by CWD.
- Preserved repair callbacks, dirty post-drain scope behavior, and canonical rebuild parity.
- Added H.6 smoke artifacts for benchmark profile and benchmark summary.
- Recorded the artifact result honestly as `pass` because wall clock, `repair_pass`, and `branch_fact_rebuild_pass` all passed their gates.

#### Measured outcome on local corpus

| Metric | H.5 baseline | H.6 result | Gate |
|---|---:|---:|---|
| Wall clock | `285,133ms` | `242,596ms` | Pass |
| Target wall clock | n/a | `300,000ms` | Passed by `57,404ms` |
| `repair_pass` | `37,710.939ms` | `1,034.142ms` | Pass |
| `branch_fact_rebuild_pass` | `25,900.448ms` | `25,640.601ms` | Pass |

H.6 improved wall clock by `42,537ms` versus H.5 and reduced `repair_pass` by `36,676.797ms`. The H.5 failed `repair_pass` gate is solved in this artifact, and the H.5 `branch_fact_rebuild_pass` improvement was preserved with another `259.847ms` reduction. The remaining dominant stage is back to `recent_lane_session_event_flush` at `208,729.248ms`, so the next bottleneck is no longer resolver work inside `repair_pass`.

Raw artifact values: `wall_clock_ms=242596`, `wall_clock_target_ms=300000`, `repair_pass_ms=1034.142`, `branch_fact_rebuild_pass_ms=25640.601`, `overall result=pass`.

#### Integrity checks

| Check | Result |
|---|---|
| H.6 benchmark gate | Passed overall (`242,596ms` wall clock; target `300,000ms`) |
| Wall-clock gate | Passed (`242,596ms`; target `300,000ms`) |
| Repair-pass gate | Passed (`1,034.142ms`; baseline/target `37,710.939ms`) |
| Branch-fact gate | Passed (`25,640.601ms`; baseline/target `25,900.448ms`) |

#### What remains

- H.6 should be treated as the phase where the repair resolver bottleneck was solved for the measured corpus.
- `recent_lane_session_event_flush` remains the dominant measured stage at `208,729.248ms`.
- The H.6 gate passed, but the broader user-feel target of a `1-2 minute` rebuild is still not proven by this artifact.

#### Pre-merge audit on local machine

**Date:** 2026-05-21 IST

Before merging H.6 to the release branch, the worktree was audited again on the local machine with a fresh rebuild smoke, API checks, DB checks, and a source-worktree serve smoke.

| Check | Result |
|---|---|
| Rebuild/parity-focused tests | Passed (`35` tests, `0` failed) |
| Fresh H.6 rebuild command | Exited `0` and promoted data |
| Fresh H.6 wall clock | `249,396ms` (`4m 09.4s`), under the `300,000ms` gate |
| Fresh H.6 `repair_pass` | `1,015.193ms`, still solved versus H.5 baseline `37,710.939ms` |
| Fresh H.6 `branch_fact_rebuild_pass` | `26,290.685ms`, `390.237ms` slower than the strict H.5 baseline gate |
| Strict summary result | `fail` because of the `390.237ms` branch-fact micro-regression |
| Repeated `serve --no-sync` after dashboard build | Ready in `570ms` |
| API endpoints checked | `/sync-status`, `/usage-summary`, `/usage-daily`, `/usage-monthly`, `/usage-model-breakdown`, `/project-usage-summary`, `/branch-usage` all returned 200 |
| SQLite health | `PRAGMA quick_check = ok` |
| Unknown branch | Preserved: `1` row, `143,889,980` tokens, `$97.4731` |
| Historical unknown | Preserved: `58` rows, `867,703,265` tokens, `$380.4749` |

The audit confirms H.6 is still a real repair-pass speed fix, but it is not the complete rebuild speedup. On this machine the audited full rebuild is about `4m 09s`, not `1-2m`, and the remaining dominant stage is still `recent_lane_session_event_flush` at `215,845ms`.

The source worktree initially could not serve the UI because `dashboard/dist` was missing. After `npm --prefix dashboard ci` and `npm run dashboard:build`, serve worked and the repeated readiness check was fast. The dashboard build passed but reported a large Vite chunk (`1,011.35 kB`) and npm reported `9` dependency audit warnings (`7` moderate, `2` high). Those are packaging/frontend follow-ups, not H.6 data-integrity failures.

Data surface audit results:

| Surface | Evidence |
|---|---|
| `/usage` monthly backend | May 2026 row populated with `5,176,459,586` tokens and `$3,286.915378` |
| Codex in `/usage` model breakdown | Present with `4,204,597,474` May bucket tokens |
| Claude in `/usage` model breakdown | Present with `857,114,865` May bucket tokens |
| `/dashboard` top project | VibeDeck with `2,650,882,496` tokens, `6` branches, Codex and Claude provider detail |
| `/branches` | `263` repos, `282` branch rows, date buckets and session detail returned |
| VibeDeck `main` data consistency sample | Branch fact tokens exactly match session tokens at `1,487,998,879` |

Verdict for H.6 before release merge: mergeable with this audit note attached. It fixes repair resolver cost and keeps `/usage`, `/dashboard`, `/branches`, Unknown branch, and Historical unknown data intact. It does not solve the remaining flush/write bottleneck and should not be advertised as a complete rebuild speed solution.

### 0.1.3 PR - Phase H.7: Bucket-Cost Batch Recompute (Experiment, Not Accepted)

**Status:** investigated, implemented in a separate worktree, benchmark failed, not part of the H.6 merge candidate.

**Plan:** `docs/superpowers/plans/2026-05-20-phase-h7-bucket-cost-batch-recompute.md`
**External worktree:** `.worktrees/phase-h7-bucket-cost-batch-recompute`
**Artifacts:** `.worktrees/phase-h7-bucket-cost-batch-recompute/docs/superpowers/plans/phase-h7-smoke-artifacts/`

#### What we were trying to solve

After H.6, `repair_pass` was no longer the bottleneck. The remaining dominant stage was `recent_lane_session_event_flush`, still taking about `208-216s` by itself. H.7 tried to reduce repeated bucket-cost recomputation inside that flush/write path by recomputing bucket costs once per session batch instead of repeatedly per event.

This was worth testing because it targeted the only stage large enough to move rebuild time materially. It was not a branch/data correctness fix; it was a speed experiment on the rebuild write path.

#### Measured outcome on local corpus

| Metric | H.6 baseline | H.7 result | Gate |
|---|---:|---:|---|
| Wall clock | `242,596ms` | `471,991ms` | Fail |
| Target wall clock | n/a | `300,000ms` | Missed by `171,991ms` |
| `recent_lane_session_event_flush` | `208,729.248ms` | `440,355.683ms` | Fail |
| `repair_pass` | `1,034.142ms` | `976.273ms` | Pass |
| `branch_fact_rebuild_pass` | `25,640.601ms` | `24,630.661ms` | Pass |

H.7 confirmed the right area to study, but the implementation made the app slower. It should not be merged into the release branch. Keep the branch as an investigation trail only.

#### What remains

- Do not reject the idea that the flush path needs work; reject only the current H.7 implementation as a merge candidate.
- Before retrying, add inner-stage profiling inside `recent_lane_session_event_flush` so we know whether the actual cost is SQLite writes, bucket-cost calculation, transaction boundaries, indexes, or object allocation.
- Continue to preserve `/usage`, `/dashboard`, `/branches`, Unknown branch, Historical unknown, and branch/date richness as acceptance gates for any future flush-path rewrite.

### 0.1.3 PR - Phase H.7 Revised: Flush Profile Targeted Fix (Cleanup Still Not Accepted)

**Status:** investigated in a separate worktree, cleanup applied, latest benchmark still failed full acceptance, not part of the H.6 release candidate.

**External worktree:** `.worktrees/phase-h7-flush-profile-targeted-fix`
**Plan:** `.worktrees/phase-h7-flush-profile-targeted-fix/docs/superpowers/plans/2026-05-21-phase-h7-flush-profile-targeted-fix.md`
**Evidence:** `.worktrees/phase-h7-flush-profile-targeted-fix/docs/superpowers/plans/2026-05-21-phase-h7-revised-smoke-evidence.md`
**Artifacts:** `.worktrees/phase-h7-flush-profile-targeted-fix/docs/superpowers/plans/phase-h7-revised-smoke-artifacts/`

#### What was attempted

Revised H.7 returned to the H.6 code path, added rebuild-only substage counters inside `recent_lane_session_event_flush`, and kept only the low-risk bucket fact SQL reduction: bucket upsert returns the final bucket row with `RETURNING *`, while immediate cost materialization and session ledger recompute remain in place.

The final cleanup kept the useful parts and removed avoidable risk:

- Profiling timers are bypassed when batch profiling is disabled, so normal rebuilds do not pay `hrtime` instrumentation overhead.
- The H.7 repair-pass smoke gate allows only a bounded `500ms` timing-noise window, so small repair wobble does not create a false failure while real repair regressions still fail.

#### Measured outcome on local corpus

| Metric | H.6 pre-merge audit baseline | H.7 revised cleanup result | Gate |
|---|---:|---:|---|
| Wall clock | `249,396ms` | `271,228ms` | Fail |
| `recent_lane_session_event_flush` | `215,845ms` | `219,330.317ms` | Fail |
| `repair_pass` | `1,015.193ms` | `996.967ms` | Pass |
| `branch_fact_rebuild_pass` | `26,290.685ms` | `32,300.508ms` | Fail |

The cleanup removed the earlier repair-pass false failure, but the latest full local smoke still failed on the real speed gates. The branch is useful as profiling evidence, but not as a release speed improvement.

Top flush substage counter: `batch_transaction_ms=179,118.717ms`. The next largest measured flush substage was `batch_branch_resolution_ms=174,030.637ms`; bucket upsert work measured only `2,819.294ms`.

#### Integrity checks

| Surface | Result |
|---|---|
| Focused tests before cleanup | Passed (`41` tests, `0` failed) |
| Cleanup-focused tests | Passed (`43` tests, `0` failed) |
| Dashboard production build | Passed; existing large Vite chunk warning remains |
| H.7 revised rebuild smoke | Failed full acceptance (`wall`, `flush`, and `branch_fact` gates failed) |
| `/usage` | Earlier API/UI smoke passed on this branch; final post-cleanup probe skipped because rebuild benchmark failed |
| `/dashboard` | Earlier API/UI smoke passed on this branch; final post-cleanup probe skipped because rebuild benchmark failed |
| `/branches` | Earlier API/UI smoke passed on this branch; final post-cleanup probe skipped because rebuild benchmark failed |
| Unknown branch | Earlier API/UI smoke confirmed visibility; final post-cleanup probe skipped because rebuild benchmark failed |
| Historical unknown | Earlier API/UI smoke confirmed visibility; final post-cleanup probe skipped because rebuild benchmark failed |

Final decision: use H.6; do not merge H.7 revised as a speed phase. If we salvage anything later, salvage only the bucket upsert SQL reduction, the disabled-profile overhead guard, and the profiler evidence showing branch/repo resolution is the next real target.
