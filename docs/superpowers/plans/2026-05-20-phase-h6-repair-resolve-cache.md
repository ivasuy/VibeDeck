# Phase H.6 Repair Resolve Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `repair_pass` time by avoiding repeated `resolveRepo(cwd)` calls for identical CWD values during attribution repair.

**Architecture:** Keep repair semantics unchanged, but add per-run memoization for `cwd -> resolveRepo result` inside `repairMissingProjectAttribution`, including negative results. Preserve existing branch-fact and session metadata behavior; this phase only removes redundant resolver work.

**Tech Stack:** Node.js 22+, SQLite (`node:sqlite`), `src/lib/sessions/branch-usage-facts.js`, repair/rebuild tests, H.6 smoke harness.

---

## Baseline

From H.5 artifact (`docs/superpowers/plans/phase-h5-smoke-artifacts/phase-h5-rebuild-summary.json`):
- Wall clock: `285,133ms`
- `repair_pass`: `37,710.939ms`
- `branch_fact_rebuild_pass`: `25,900.448ms`
- Overall summary: `fail` (`repair_pass` regression)

H.6 target:
- `repair_pass` <= `37,710.939ms` (recover regression)
- Keep wall-clock <= `300,000ms`
- Keep branch-fact non-regression against H.5 baseline.

## Task 1: Add CWD resolver memoization inside repair pass

**Files:**
- Modify: `src/lib/sessions/branch-usage-facts.js`
- Modify: `test/sessions-branch-usage-facts.test.js`
- Modify: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add fail-first tests**

Add tests that fail before implementation:
1. Repair pass reuses cached repo-resolution results for repeated CWDs in one run (include negative-result reuse).
2. Dirty post-drain rebuild still preserves canonical counts/totals with memoization enabled.

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected before implementation: FAIL on new assertions.

- [ ] **Step 2: Implement repair-pass memoization**

Implementation requirements:
1. In `repairMissingProjectAttribution`, create per-run map keyed by normalized `cwd`.
2. Cache both successful and null/negative `resolveRepo` outcomes.
3. Reuse cached result for repeated CWDs before calling `resolveRepo`.
4. Preserve all existing writes and progress callbacks.
5. No schema changes, no public API changes.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 1**

`git add src/lib/sessions/branch-usage-facts.js test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
`git commit -m "rebuild: memoize repair repo resolution by cwd"`

## Task 2: H.6 parity + smoke harness and artifacts

**Files:**
- Modify: `test/sync-rebuild-profile.test.js`
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Create: `scripts/smoke/rebuild-hot-path-phase-h6.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h6-smoke-artifacts/*`

- [ ] **Step 1: Add H.6 harness tests**

In `test/sync-rebuild-profile.test.js`, add H.6 smoke summary tests:
1. Includes wall-clock, repair-pass, and branch-fact gates.
2. Missing key stages are uncovered/failed (fail-closed).

- [ ] **Step 2: Implement and run H.6 smoke harness**

Create `scripts/smoke/rebuild-hot-path-phase-h6.cjs` with H.5 baseline constants and gates:
- wall clock <= `300,000ms`
- `repair_pass` <= `37,710.939ms`
- `branch_fact_rebuild_pass` <= `25,900.448ms`

Run:
`node scripts/smoke/rebuild-hot-path-phase-h6.cjs`
Expected: artifacts generated; exit reflects honest gate status.

- [ ] **Step 3: Run parity/rebuild suite**

Run:
`node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 2**

`git add test/sync-rebuild-profile.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js scripts/smoke/rebuild-hot-path-phase-h6.cjs docs/superpowers/plans/phase-h6-smoke-artifacts`
`git commit -m "smoke: add phase-h6 repair-pass benchmark pack"`

## Task 3: H.6 evidence + project update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h6-smoke-evidence.md`
- Modify: `PROJECT.md`

- [ ] **Step 1: Record measured H.6 outcomes from artifacts**

Include explicit pass/fail for overall result, wall-clock gate, repair-pass gate, and branch-fact gate.

- [ ] **Step 2: Update `PROJECT.md` with Phase H.6 block**

Document measured deltas vs H.5 baseline and identify next bottleneck if any.

- [ ] **Step 3: Commit Task 3**

`git add -f docs/superpowers/plans/2026-05-20-phase-h6-smoke-evidence.md docs/superpowers/plans/phase-h6-smoke-artifacts PROJECT.md`
`git commit -m "docs: add phase-h6 smoke evidence and project update"`

## Exit Criteria

- Repeated CWD repair candidates do not trigger repeated `resolveRepo` shell calls within one repair run.
- Rebuild/parity tests pass.
- H.6 smoke artifacts report real local performance and honest gate status.
