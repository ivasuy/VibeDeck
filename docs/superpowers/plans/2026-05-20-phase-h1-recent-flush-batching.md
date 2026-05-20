# Phase H.1 Recent Flush Batching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut rebuild wall-clock by reducing grouped session-event flush churn in rebuild mode while preserving canonical data richness and parity across `/dashboard`, `/usage`, `/branches`, side drawers, Unknown branch, and Historical unknown.

**Architecture:** Keep parse semantics unchanged, but replace per-file grouped flush behavior with bounded lane-slice flush behavior in rebuild mode. Flush only when group/event thresholds are reached or at lane boundaries. Add explicit counters proving lower flush count and unchanged canonical totals.

**Tech Stack:** Node.js 22, SQLite (`node:sqlite`), `src/commands/sync.js`, rebuild profile artifacts, parity tests, dashboard tests, local smoke scripts.

---

## Baseline For Phase H.1

From Phase H artifact (`docs/superpowers/plans/phase-h-smoke-artifacts/phase-h-rebuild-summary.json`):

- Wall clock: `348,982ms` (`5m 48.98s`)
- Top stage: `recent_lane_session_event_flush` = `127,905.923ms`
- Flush count: `409`

H.1 success target:
- Wall clock <= `240,000ms` (`4m 00s`) on same machine/corpus/flags.
- `recent_lane_session_event_flush` reduced by >= 40%.
- `flush_count` reduced from `409` to <= `120`.

## Scope And Safety

- Worktree: `.worktrees/phase-h1-recent-flush-batching`
- Branch: `agent/phase-h1-recent-flush-batching`
- Keep all existing canonical invariants and rebuild safety checks.
- Keep Phase H feature flags; add one new flag for slice batching control.

## Task 1: Add Slice-Batching Controls And Failing Tests

**Files:**
- Modify: `src/commands/sync.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/sync-rebuild-profile.test.js`

- [ ] **Step 1: Add failing tests for flush count reduction behavior**

Add tests asserting under new flag:
- grouped processor does not flush on every historical file completion,
- flush occurs when slice thresholds are reached or at explicit lane drain,
- profile exposes new counters for threshold-triggered flushes.

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
Expected before implementation: FAIL.

- [ ] **Step 2: Implement slice controls**

Add rebuild-only flag:
- `VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS` (default safe value, e.g. `2000`)

Implement in grouped rebuild flow:
- track pending events per lane,
- flush historical lane when pending historical events exceed slice threshold,
- keep recent lane deferred until recent-lane boundary/final drain,
- preserve existing lane-aware behavior from Phase H.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
`git commit -m "rebuild: add slice-batched grouped flush controls"`

## Task 2: Preserve Parity Under Reduced Flush Frequency

**Files:**
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Modify (if required): `src/commands/sync.js`

- [ ] **Step 1: Add fail-first parity assertions for slice batching**

Add coverage that compares fast-path with and without slice batching and asserts:
- identical session/event/token totals,
- identical branch facts/window counts,
- no increase in Unknown/Historical unknown buckets in fixture parity runs.

Run:
`node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
Expected before implementation: FAIL if counters/stage naming or flush semantics diverge.

- [ ] **Step 2: Fix parity gaps if any**

Adjust only minimal logic needed so slice batching stays semantically equivalent.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js src/commands/sync.js`
`git commit -m "test: enforce parity for slice-batched rebuild flush"`

## Task 3: Real-Corpus Benchmark Smoke Pack (H.1)

**Files:**
- Create: `scripts/smoke/rebuild-hot-path-phase-h1.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h1-smoke-artifacts/*`
- Modify: `test/sync-rebuild-profile.test.js` (artifact contract checks, if needed)

- [ ] **Step 1: Add H.1 smoke script**

Script should:
- run rebuild with H/H.1 flags,
- capture wall clock and profile,
- emit compact summary JSON with:
  - wall-clock pass/fail vs H baseline,
  - top stages,
  - `flush_count` before/after target check.

- [ ] **Step 2: Run full local smoke**

Run:
- `node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`
- `node scripts/smoke/rebuild-hot-path-phase-h1.cjs`

Expected:
- tests pass,
- artifact generated even on fail,
- explicit pass/fail for H.1 gate.

- [ ] **Step 3: Commit**

`git add scripts/smoke/rebuild-hot-path-phase-h1.cjs docs/superpowers/plans/phase-h1-smoke-artifacts test/sync-rebuild-profile.test.js`
`git commit -m "smoke: add phase-h1 rebuild flush-batching benchmark pack"`

## Task 4: Coverage Honesty And Product Update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h1-smoke-evidence.md`
- Modify: `PROJECT.md`
- Modify/Add: `docs/superpowers/plans/phase-h1-smoke-artifacts/*`

- [ ] **Step 1: Run required integrity checks**

Run and record exactly what is covered:
- `npm --prefix dashboard test -- UsageOverview.test.jsx BranchesPage.test.jsx`
- `node scripts/smoke/no-token-loss-proof.cjs --no-sync --output docs/superpowers/plans/phase-h1-smoke-artifacts/no-token-loss-proof.json`

If a command is uncovered due to branch/tooling mismatch, record as uncovered with reason (do not claim pass).

- [ ] **Step 2: Write evidence doc**

Include:
- baseline vs H.1 timing,
- top stage movement,
- flush count movement,
- parity status,
- no-token-loss status,
- UI coverage status (explicitly pass/partial/uncovered).

- [ ] **Step 3: Update PROJECT.md**

Append Phase H.1 block with:
- bottleneck addressed,
- measured outcomes,
- remaining bottleneck if target still missed.

- [ ] **Step 4: Commit**

`git add -f docs/superpowers/plans/phase-h1-smoke-artifacts docs/superpowers/plans/2026-05-20-phase-h1-smoke-evidence.md PROJECT.md`
`git commit -m "docs: add phase-h1 smoke evidence and project update"`

## Exit Criteria

- H.1 real-corpus smoke artifact exists with explicit pass/fail.
- `recent_lane_session_event_flush` materially reduced and `flush_count` significantly lower.
- Rebuild/parity suites pass without data-richness regression.
- UI and no-token-loss gates are either passed or honestly marked uncovered with reasons.
- `PROJECT.md` updated with measured outcome and next bottleneck.
