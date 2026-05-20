# Phase H.3 Defer Branch-Fact Rebuild In Flush Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce rebuild flush-stage time by removing duplicate branch-fact rebuild work from per-batch session processing when post-drain scoped branch-fact rebuild is enabled.

**Architecture:** Introduce an explicit `deferBranchFactRebuild` option in session batch processing and wire it from rebuild sync only when dirty post-drain index mode is active. Keep live/session correctness unchanged and rely on the post-drain dirty/full branch-fact pass as the single rebuild source of truth.

**Tech Stack:** Node.js 22, SQLite (`node:sqlite`), `src/commands/sync.js`, `src/lib/sessions/pipeline.js`, rebuild/parity tests, H.3 smoke artifacts.

---

## Baseline

H.2 artifact (`phase-h2-rebuild-summary.json`):
- Wall clock: `366,301ms`
- `recent_lane_session_event_flush`: `307,974.929ms`
- `branch_fact_rebuild_pass`: `25,939.595ms`

H.3 target:
- Wall clock <= `300,000ms`
- `recent_lane_session_event_flush` <= `220,000ms`
- Parity unchanged.

## Task 1: Defer per-batch branch-fact rebuild in rebuild mode

**Files:**
- Modify: `src/lib/sessions/pipeline.js`
- Modify: `src/commands/sync.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add fail-first test**

Add test asserting when rebuild + dirty post-drain mode is on:
- per-batch session processing does not rebuild branch usage facts inline,
- post-drain branch-fact pass still executes.

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js`
Expected before implementation: FAIL.

- [ ] **Step 2: Implement defer option**

- Add option to `processSessionEventBatch` and `processSessionEvent`:
  - `deferBranchFactRebuild` (default false)
- Skip inline `rebuildBranchUsageFactsForSession` and `persistBranchWindows` when defer is true.
- In rebuild sync path, pass `deferBranchFactRebuild: true` only when `dirtyPostDrainEnabled` is true.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/lib/sessions/pipeline.js src/commands/sync.js test/sync-rebuild-vibedeck-db.test.js`
`git commit -m "rebuild: defer per-batch branch-fact rebuild to post-drain pass"`

## Task 2: Parity/benchmark validation

**Files:**
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Create: `scripts/smoke/rebuild-hot-path-phase-h3.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h3-smoke-artifacts/*`

- [ ] **Step 1: Rebuild/parity suite**

Run:
`node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`

- [ ] **Step 2: H.3 smoke script + run**

- Add H.3 script mirroring H.2 contract with new baseline/targets.
- Run:
`node scripts/smoke/rebuild-hot-path-phase-h3.cjs`

- [ ] **Step 3: Commit**

`git add test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js scripts/smoke/rebuild-hot-path-phase-h3.cjs docs/superpowers/plans/phase-h3-smoke-artifacts`
`git commit -m "smoke: add phase-h3 defer-branch-fact benchmark pack"`

## Task 3: H.3 evidence and project update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h3-smoke-evidence.md`
- Modify: `PROJECT.md`

- [ ] **Step 1: Record pass/fail/uncovered status honestly**
- [ ] **Step 2: Update PROJECT.md with measured H.3 outcomes**
- [ ] **Step 3: Commit**

`git add -f docs/superpowers/plans/2026-05-20-phase-h3-smoke-evidence.md docs/superpowers/plans/phase-h3-smoke-artifacts PROJECT.md`
`git commit -m "docs: add phase-h3 smoke evidence and project update"`

## Exit Criteria

- Inline branch-fact rebuild work is deferred during rebuild flush when safe.
- Rebuild/parity tests stay green.
- H.3 smoke artifact clearly shows whether flush-stage time and wall-clock improved.
