# Phase H.4 Repair Pass De-Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce rebuild wall-clock by removing duplicate per-session branch-fact rebuild work currently executed in both `repair_pass` and `branch_fact_rebuild_pass` during dirty post-drain rebuild mode.

**Architecture:** Keep `repair_pass` responsible for project/repo attribution recovery, and make branch-fact materialization single-source in the post-drain branch-fact pass when that pass is guaranteed to run. Introduce an explicit `rebuildFacts` switch to `repairMissingProjectAttribution` (default `true`) so non-rebuild and fallback paths preserve current behavior. Preserve parity and honest smoke-gate reporting.

**Tech Stack:** Node.js 22+, SQLite (`node:sqlite`), `src/commands/sync.js`, `src/lib/sessions/branch-usage-facts.js`, rebuild/parity tests, H.4 smoke harness.

---

## Baseline

From H.3 artifact (`docs/superpowers/plans/phase-h3-smoke-artifacts/phase-h3-rebuild-summary.json`):
- Wall clock: `337,412ms`
- `recent_lane_session_event_flush`: `218,370.394ms`
- `repair_pass`: `65,127.053ms`
- `branch_fact_rebuild_pass`: `27,321.343ms`

H.4 target:
- Wall clock <= `300,000ms`
- `repair_pass` materially reduced versus `65,127.053ms`
- Parity unchanged.

## Task 1: Remove duplicate branch-fact rebuild work from repair pass in dirty rebuild mode

**Files:**
- Modify: `src/lib/sessions/branch-usage-facts.js`
- Modify: `src/commands/sync.js`
- Modify: `test/sessions-branch-usage-facts.test.js`
- Modify: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add fail-first tests for new repair behavior**

Add tests that fail before implementation:
1. `repairMissingProjectAttribution(..., { rebuildFacts: false })` backfills repo metadata but does not write branch usage facts.
2. `sync --rebuild-vibedeck-db` with dirty post-drain enabled calls repair pass with `rebuildFacts: false` when branch-fact pass is guaranteed; fallback/full rebuild paths continue passing `rebuildFacts: true`.

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected before implementation: FAIL on new assertions.

- [ ] **Step 2: Implement explicit repair-pass fact rebuild switch**

Code changes:
1. `repairMissingProjectAttribution` options accept `rebuildFacts = true`.
2. Inside repair loop, call `rebuildBranchUsageFactsForSession` only when `rebuildFacts` is true.
3. In `sync.js`, compute whether a post-drain branch-fact pass will run (`runFullBranchFactRebuild || runDirtyBranchFactRebuild || fallbackToFullBranchFactRebuild`) before repair invocation.
4. Pass `rebuildFacts: !willRunBranchFactPass` to `repairMissingProjectAttribution` so dirty rebuild path avoids duplicate facts, while non-rebuild/auto/fallback semantics stay safe.

- [ ] **Step 3: Run targeted verification**

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 1**

`git add src/lib/sessions/branch-usage-facts.js src/commands/sync.js test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
`git commit -m "rebuild: dedupe repair and branch-fact rebuild passes"`

## Task 2: H.4 parity + smoke harness and artifact pack

**Files:**
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Modify: `test/sync-rebuild-profile.test.js`
- Create: `scripts/smoke/rebuild-hot-path-phase-h4.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h4-smoke-artifacts/*`

- [ ] **Step 1: Extend harness tests for H.4 artifact gate semantics**

Add H.4 smoke harness tests in `test/sync-rebuild-profile.test.js` that assert:
1. Summary includes wall-clock gate, repair-pass gate, and branch-fact gate.
2. Missing key stages are reported honestly as uncovered/failed (not silent pass).

- [ ] **Step 2: Add and run H.4 smoke harness**

Add `scripts/smoke/rebuild-hot-path-phase-h4.cjs` using H.3 baseline constants and explicit gates:
- wall-clock target: `300,000ms`
- repair-pass improvement target from H.3 baseline
- branch-fact gate non-regression target from H.3 baseline

Run:
`node scripts/smoke/rebuild-hot-path-phase-h4.cjs`
Expected: Generates `phase-h4-rebuild-summary.json` and `phase-h4-rebuild-profile.json`; exit status reflects gates honestly.

- [ ] **Step 3: Run parity/rebuild suites**

Run:
`node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 2**

`git add test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js test/sync-rebuild-profile.test.js scripts/smoke/rebuild-hot-path-phase-h4.cjs docs/superpowers/plans/phase-h4-smoke-artifacts`
`git commit -m "smoke: add phase-h4 repair-pass dedupe benchmark pack"`

## Task 3: H.4 evidence + project update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h4-smoke-evidence.md`
- Modify: `PROJECT.md`

- [ ] **Step 1: Record measured outcomes from H.4 artifacts**

Document pass/fail honestly with concrete numbers for:
- wall-clock gate
- `repair_pass` gate
- `branch_fact_rebuild_pass` gate
- parity/no-token-loss status and any uncovered items.

- [ ] **Step 2: Update `PROJECT.md` phase block**

Add Phase H.4 entry with:
- bottleneck solved or remaining
- exact metrics vs H.3 baseline
- explicit note if target remains unmet.

- [ ] **Step 3: Commit Task 3**

`git add -f docs/superpowers/plans/2026-05-20-phase-h4-smoke-evidence.md docs/superpowers/plans/phase-h4-smoke-artifacts PROJECT.md`
`git commit -m "docs: add phase-h4 smoke evidence and project update"`

## Exit Criteria

- Dirty rebuild mode no longer does duplicate per-session fact rebuild in both repair and post-drain passes.
- Rebuild/parity tests pass.
- H.4 smoke artifact provides honest gate status with real local wall-clock metrics.
- `PROJECT.md` updated with measured outcome and next bottleneck clarity.
