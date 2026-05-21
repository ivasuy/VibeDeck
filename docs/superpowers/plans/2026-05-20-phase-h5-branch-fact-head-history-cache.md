# Phase H.5 Branch-Fact Head-History Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce `branch_fact_rebuild_pass` duration by eliminating per-event SQLite reopen/lookups in head-history branch resolution during branch-fact rebuild.

**Architecture:** Keep rebuild semantics unchanged, but route head-history lookups through the active writable rebuild DB connection and a per-run cache keyed by `worktree_root`. The cache stores sorted transition arrays and does binary search in-memory, with fallback to current `findBranchAt` path when no DB handle is available.

**Tech Stack:** Node.js 22+, SQLite (`node:sqlite`), `src/lib/sessions/branch-usage-facts.js`, `src/lib/sessions/head-history.js`, rebuild/parity/profile tests, H.5 smoke harness.

---

## Baseline

From H.4 artifact (`docs/superpowers/plans/phase-h4-smoke-artifacts/phase-h4-rebuild-summary.json`):
- Wall clock: `284,982ms`
- `repair_pass`: `36,400.351ms`
- `branch_fact_rebuild_pass`: `28,946.879ms`
- Overall summary: `fail` (branch-fact gate)

H.5 target:
- `branch_fact_rebuild_pass` <= `28,946.879ms`
- Preserve H.4 wall-clock win (`<= 300,000ms`)
- Parity unchanged.

## Task 1: Cache head-history lookups inside branch-fact rebuild pass

**Files:**
- Modify: `src/lib/sessions/branch-usage-facts.js`
- Modify: `test/sessions-branch-usage-facts.test.js`
- Modify: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add fail-first tests**

Add tests that fail before implementation:
1. Branch-fact rebuild still resolves Tier-B head-history branches correctly when `cache` is provided.
2. Dirty rebuild path preserves canonical counts/totals with the new lookup path enabled.

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected before implementation: FAIL on new assertions.

- [ ] **Step 2: Implement shared head-history cache path**

Implementation requirements:
1. Add head-history resolver helper in `branch-usage-facts.js` that:
   - reads transitions from `vibedeck_head_history` via provided DB handle,
   - caches per `worktree_root` in `cache` object,
   - resolves branch via binary search on cached transitions.
2. Update `headHistoryBranch`/`factBranch` call chain to pass `{ db, cache }` from rebuild flow so the shared DB path is used.
3. Keep current `findBranchAt` fallback for call sites without DB handle.
4. No schema changes, no canonical shape changes.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 1**

`git add src/lib/sessions/branch-usage-facts.js test/sessions-branch-usage-facts.test.js test/sync-rebuild-vibedeck-db.test.js`
`git commit -m "rebuild: cache head-history lookups in branch-fact pass"`

## Task 2: H.5 parity + smoke harness and artifact pack

**Files:**
- Modify: `test/sync-rebuild-profile.test.js`
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Create: `scripts/smoke/rebuild-hot-path-phase-h5.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h5-smoke-artifacts/*`

- [ ] **Step 1: Add H.5 harness tests**

In `test/sync-rebuild-profile.test.js`, add tests that assert:
1. H.5 summary includes wall-clock, repair-pass, and branch-fact gates.
2. Missing key stages are uncovered/failed (fail-closed behavior).

- [ ] **Step 2: Implement and run H.5 smoke harness**

Create `scripts/smoke/rebuild-hot-path-phase-h5.cjs` with H.4 baseline constants and gates:
- wall clock <= `300,000ms`
- `repair_pass` <= `36,400.351ms` (non-regression)
- `branch_fact_rebuild_pass` <= `28,946.879ms` (target bottleneck)

Run:
`node scripts/smoke/rebuild-hot-path-phase-h5.cjs`
Expected: artifacts generated; exit reflects honest gate status.

- [ ] **Step 3: Run parity/rebuild suite**

Run:
`node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
Expected: PASS.

- [ ] **Step 4: Commit Task 2**

`git add test/sync-rebuild-profile.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js scripts/smoke/rebuild-hot-path-phase-h5.cjs docs/superpowers/plans/phase-h5-smoke-artifacts`
`git commit -m "smoke: add phase-h5 branch-fact benchmark pack"`

## Task 3: H.5 evidence + project update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h5-smoke-evidence.md`
- Modify: `PROJECT.md`

- [ ] **Step 1: Record measured H.5 outcomes from artifacts**

Include explicit pass/fail for:
- wall-clock gate
- repair-pass gate
- branch-fact gate
- overall summary result

- [ ] **Step 2: Update `PROJECT.md` with Phase H.5 block**

Document:
- bottleneck addressed
- measured deltas vs H.4 baseline
- remaining bottleneck if any.

- [ ] **Step 3: Commit Task 3**

`git add -f docs/superpowers/plans/2026-05-20-phase-h5-smoke-evidence.md docs/superpowers/plans/phase-h5-smoke-artifacts PROJECT.md`
`git commit -m "docs: add phase-h5 smoke evidence and project update"`

## Exit Criteria

- Head-history lookup path in branch-fact rebuild no longer opens/queries via per-event fallback path when shared DB/cache are available.
- Rebuild/parity tests pass.
- H.5 smoke artifact reports honest real-local performance and gate status.
