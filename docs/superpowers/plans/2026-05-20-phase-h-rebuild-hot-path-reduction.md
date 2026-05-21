# Phase H Rebuild Hot-Path Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce real local rebuild wall-clock from ~4m29s toward ~2m30s without losing canonical richness across `/dashboard`, `/usage`, `/branches`, side-drawers, Unknown branch, and Historical unknown.

**Architecture:** Keep canonical semantics unchanged, but remove synchronous hot-path work inside rebuild by splitting recent-lane canonical session-event flush from historical parsing, narrowing expensive full-table post-processing to dirty scopes, and isolating provider parse stage timing so bottlenecks are measurable and actionable. Implement behind feature flags with parity and smoke gates.

**Tech Stack:** Node.js 22, SQLite (`node:sqlite`), existing sync/rebuild pipeline (`src/commands/sync.js`), provider parsing (`src/lib/rollout.js`), session pipeline (`src/lib/sessions/*`), dashboard tests, Playwright smoke harnesses.

---

## Baseline For This Phase

Use this measured baseline for pass/fail comparisons (captured on 2026-05-20, local machine):

- Rebuild command: `VIBEDECK_REBUILD_PROFILE=1 VIBEDECK_FRESH_STAGED_REBUILD=1 VIBEDECK_REBUILD_CACHE=1 VIBEDECK_SINGLE_REBUILD_WRITER=1 VIBEDECK_PARALLEL_PARSE=1 VIBEDECK_PROVIDER_BRANCH_FIX=1 node bin/vibedeck.js sync --rebuild-vibedeck-db`
- Wall clock: `4m 28.89s`
- Dominant profile stages:
  - `claude_discovery_and_parse`: `182,449ms`
  - `recent_lane_session_event_flush`: `176,196ms`
  - `repair_missing_project_attribution`: `29,485ms`
  - `post_drain_full_branch_fact_rebuild`: `30,102ms`

Exit target for Phase H:
- Wall clock <= `3m 15s` on same local corpus and flags.
- No regressions in parity invariants and live smoke gates.

## Scope And Safety

- Worktree: `.worktrees/phase-h-rebuild-hot-path-reduction`
- Branch: `agent/phase-h-rebuild-hot-path-reduction`
- Preserve current user-facing data contract and bucket richness.
- Keep watcher rollout state unchanged from Phase G decisions unless new evidence demands change.

## Task 1: Add Profile Stage Decomposition And Hard Counters

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/rollout.js`
- Test: `test/sync-rebuild-profile.test.js`

- [ ] **Step 1: Write failing profile decomposition tests**

Add tests asserting `rebuild_profile.json` contains separate stages for:
- recent codex parse,
- recent claude parse,
- recent-lane session-event flush,
- historical codex parse,
- historical claude parse,
- repair pass,
- branch-fact rebuild pass.

Also assert counters exist for:
- recent-session events flushed,
- historical-session events flushed,
- repair candidates attempted,
- branch facts rebuilt by scope.

Run: `node --test test/sync-rebuild-profile.test.js`
Expected before implementation: FAIL on missing stage names/counters.

- [ ] **Step 2: Implement profile stage split and counters**

Update rebuild profiling so stage timing is structurally decomposed instead of wrapping broad mixed work under `claude_discovery_and_parse`.

- [ ] **Step 3: Re-run profile tests**

Run: `node --test test/sync-rebuild-profile.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js src/lib/rollout.js test/sync-rebuild-profile.test.js`
`git commit -m "rebuild-profile: split hot-path stages and add scope counters"`

## Task 2: Recent-Lane Flush Fast Path (Delta-Only Session Event Materialization)

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/sessions/pipeline.js`
- Modify: `src/lib/rollout.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/rebuild-parity-harness.test.js`

- [ ] **Step 1: Write failing tests for reduced recent-lane flush pressure**

Add tests that simulate large recent-lane input and assert:
- recent lane does not trigger per-file/per-event synchronous canonical writes in the old path,
- session-event materialization uses grouped batch boundaries,
- totals and branch-window persistence remain identical.

Run: `node --test test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js`
Expected before implementation: FAIL on old flush behavior assumptions.

- [ ] **Step 2: Implement feature-flagged fast path**

Add `VIBEDECK_REBUILD_RECENT_FASTPATH=1` for rebuild-only behavior:
- keep parser output unchanged,
- defer recent-lane canonical session-event materialization to grouped session batches,
- flush grouped writes once per lane/slice, not per provider file,
- retain branch-window writes and per-session facts.

- [ ] **Step 3: Re-run tests**

Run: `node --test test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js src/lib/sessions/pipeline.js src/lib/rollout.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js`
`git commit -m "rebuild: add recent-lane grouped flush fast path"`

## Task 3: Dirty-Scoped Repair + Branch-Fact Rebuild In Rebuild Mode

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/lib/sessions/branch-usage-facts.js`
- Modify: `src/lib/sessions/provider-branch-cache.js` (or equivalent cache module used by rebuild)
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/parallel-parse-parity.test.js`

- [ ] **Step 1: Write failing scope tests**

Add tests asserting rebuild-mode post-drain steps can run dirty-scoped when flag enabled:
- repair only attempts dirty/unattributed candidates,
- branch-fact rebuild only touches dirty sessions unless forced full mode,
- first bootstrap still supports full rebuild when required.

Run: `node --test test/sync-rebuild-vibedeck-db.test.js test/parallel-parse-parity.test.js`
Expected before implementation: FAIL on full-scan assumptions.

- [ ] **Step 2: Implement dirty-scoped post-drain path**

Add `VIBEDECK_REBUILD_DIRTY_POST_DRAIN=1`:
- use dirty session tracker output to bound repair and branch-fact rebuild scope,
- preserve fallback to full rebuild on missing/invalid scope metadata,
- persist profile counters for scoped rows processed.

- [ ] **Step 3: Re-run tests**

Run: `node --test test/sync-rebuild-vibedeck-db.test.js test/parallel-parse-parity.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js src/lib/sessions/branch-usage-facts.js src/lib/sessions/provider-branch-cache.js test/sync-rebuild-vibedeck-db.test.js test/parallel-parse-parity.test.js`
`git commit -m "rebuild: scope repair and branch-fact rebuild to dirty sessions"`

## Task 4: Real-Corpus Smoke Pack And Performance Gate

**Files:**
- Modify/Create: `scripts/smoke/rebuild-hot-path-phase-h.cjs`
- Modify: `docs/superpowers/plans/phase-g-smoke-artifacts/*` (new phase-h artifact dir)
- Test: `test/sync-rebuild-profile.test.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add smoke harness script**

Script must run:
- rebuild with Phase H flags,
- capture wall clock,
- copy `rebuild_profile.json` into `docs/superpowers/plans/phase-h-smoke-artifacts/`,
- emit a compact summary JSON including stage top-10, totals, and pass/fail versus baseline.

- [ ] **Step 2: Run local smoke + regression tests**

Run:
- `node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
- `node scripts/smoke/rebuild-hot-path-phase-h.cjs`

Expected:
- all tests pass,
- wall clock <= `3m 15s`, or explicit fail artifact with diagnosed top stage.

- [ ] **Step 3: Commit**

`git add scripts/smoke/rebuild-hot-path-phase-h.cjs docs/superpowers/plans/phase-h-smoke-artifacts test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
`git commit -m "smoke: add phase-h rebuild hot-path benchmark pack"`

## Task 5: UI/Data Integrity Smoke + Evidence Update

**Files:**
- Modify: `docs/superpowers/plans/2026-05-20-phase-h-rebuild-hot-path-reduction.md` (status notes)
- Create: `docs/superpowers/plans/2026-05-20-phase-h-smoke-evidence.md`
- Modify: `PROJECT.md`
- Modify/Add: `docs/superpowers/plans/phase-h-smoke-artifacts/*`

- [ ] **Step 1: Run integrity and UI checks**

Run:
- `node scripts/smoke/no-token-loss-proof.cjs --output docs/superpowers/plans/phase-h-smoke-artifacts/no-token-loss-proof.json`
- `npm --prefix dashboard test -- UsageOverview.test.jsx BranchesPage.test.jsx`
- Playwright usage/branches freshness screenshots if UI behavior changed.

Verify explicitly:
- `/usage`, `/dashboard`, `/branches` totals remain coherent,
- Unknown branch and Historical unknown totals do not regress,
- side-drawer data richness preserved.

- [ ] **Step 2: Document evidence with pass/fail matrix**

Write `2026-05-20-phase-h-smoke-evidence.md` with:
- baseline vs after timings,
- top stage movement,
- parity/no-token-loss summary,
- UI smoke summary,
- residual risks and rollout recommendation.

- [ ] **Step 3: Update product changelog**

Append Phase H block to `PROJECT.md` with:
- what bottleneck was solved,
- measured before/after,
- what remains.

- [ ] **Step 4: Commit**

`git add -f docs/superpowers/plans/phase-h-smoke-artifacts docs/superpowers/plans/2026-05-20-phase-h-smoke-evidence.md PROJECT.md docs/superpowers/plans/2026-05-20-phase-h-rebuild-hot-path-reduction.md`
`git commit -m "docs: add phase-h evidence and project update"`

## Exit Criteria

- Real local rebuild wall clock improves from `4m 28.89s` to <= `3m 15s` on same machine/corpus and flag set.
- `recent_lane_session_event_flush` and/or mixed parse stage time is materially reduced with profile evidence.
- Unknown/Historical unknown and branch-window parity remain stable.
- `/dashboard`, `/usage`, `/branches` and side-drawer richness remain intact.
- No-token-loss proof passes on local corpus.
- Phase H smoke evidence + `PROJECT.md` updates are committed.
