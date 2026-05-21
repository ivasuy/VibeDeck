# Phase H.2 Mixed-Lane Flush Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover rebuild speed after H.1 by preventing huge deferred mixed-lane session groups from accumulating until final drain.

**Architecture:** Keep grouped semantics and parity, but split mixed session groups by lane inside the grouped processor so historical chunks can flush incrementally while recent chunks remain deferred. Add per-session chunk limits to avoid very large batch writes at final drain.

**Tech Stack:** Node.js 22, SQLite (`node:sqlite`), `src/commands/sync.js`, rebuild profile artifacts, parity tests, local smoke scripts.

---

## Baseline For Phase H.2

From H.1 artifact (`docs/superpowers/plans/phase-h1-smoke-artifacts/phase-h1-rebuild-summary.json`):
- Wall clock: `368,366ms` (`6m 08.37s`)
- `recent_lane_session_event_flush`: `309,554.01ms`
- `flush_count`: `10`

H.2 success target:
- Wall clock <= `300,000ms` (`5m 00s`)
- `recent_lane_session_event_flush` <= `180,000ms`
- Preserve `flush_count` <= `120`

## Task 1: Split Mixed-Lane Group Flush Semantics

**Files:**
- Modify: `src/commands/sync.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`

- [ ] **Step 1: Add failing regression tests for mixed-lane sessions**

Add tests proving:
- for one session containing both recent and historical events, historical subset can flush at historical boundary,
- recent subset remains pending until recent/final boundary,
- no event duplication/loss.

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js`
Expected before implementation: FAIL.

- [ ] **Step 2: Implement lane-split buffering in grouped processor**

Inside grouped rebuild processor:
- store per-group `recentEvents[]` and `historicalEvents[]` rather than one shared list,
- `flush({lane:"historical"})` processes only historical subset (even when recent exists for same session),
- retain recent subset for later drain,
- keep existing profile counters accurate.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js test/sync-rebuild-vibedeck-db.test.js`
`git commit -m "rebuild: split mixed-lane grouped flush by lane"`

## Task 2: Cap Per-Session Batch Size At Flush Time

**Files:**
- Modify: `src/commands/sync.js`
- Test: `test/sync-rebuild-vibedeck-db.test.js`
- Test: `test/sync-rebuild-profile.test.js`

- [ ] **Step 1: Add failing tests for chunked processor writes**

Add tests asserting very large session groups are processed in chunks (e.g. `VIBEDECK_REBUILD_SESSION_BATCH_EVENTS=500`) with parity preserved.

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
Expected before implementation: FAIL.

- [ ] **Step 2: Implement chunked calls to processor(events)**

- Add rebuild-only batch chunk env flag:
  - `VIBEDECK_REBUILD_SESSION_BATCH_EVENTS` (default `1000`)
- Apply chunking when invoking processor for a lane subset, not after merge.

- [ ] **Step 3: Re-run tests**

Run:
`node --test test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

`git add src/commands/sync.js test/sync-rebuild-vibedeck-db.test.js test/sync-rebuild-profile.test.js`
`git commit -m "rebuild: chunk grouped session-event batches at flush"`

## Task 3: Parity Safety And H.2 Benchmark Smoke

**Files:**
- Modify: `test/rebuild-parity-harness.test.js`
- Modify: `test/parallel-parse-parity.test.js`
- Create: `scripts/smoke/rebuild-hot-path-phase-h2.cjs`
- Create/Modify: `docs/superpowers/plans/phase-h2-smoke-artifacts/*`

- [ ] **Step 1: Add parity assertions for lane split + chunking**

Run:
`node --test test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`

- [ ] **Step 2: Add H.2 smoke script and run full suite + benchmark**

Run:
`node --test test/sync-rebuild-profile.test.js test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js`

Run:
`node scripts/smoke/rebuild-hot-path-phase-h2.cjs`

- [ ] **Step 3: Commit**

`git add test/rebuild-parity-harness.test.js test/parallel-parse-parity.test.js scripts/smoke/rebuild-hot-path-phase-h2.cjs docs/superpowers/plans/phase-h2-smoke-artifacts`
`git commit -m "smoke: add phase-h2 mixed-lane flush benchmark pack"`

## Task 4: H.2 Evidence And PROJECT Update

**Files:**
- Create: `docs/superpowers/plans/2026-05-20-phase-h2-smoke-evidence.md`
- Modify: `PROJECT.md`

- [ ] **Step 1: Record outcomes with explicit pass/fail and uncovered gates**
- [ ] **Step 2: Update PROJECT.md with H.2 measured outcomes**
- [ ] **Step 3: Commit**

`git add -f docs/superpowers/plans/2026-05-20-phase-h2-smoke-evidence.md docs/superpowers/plans/phase-h2-smoke-artifacts PROJECT.md`
`git commit -m "docs: add phase-h2 smoke evidence and project update"`

## Exit Criteria

- Mixed-lane groups no longer defer all historical data when recent exists in same session.
- Large per-session flush calls are chunked.
- Parity suites pass.
- H.2 smoke artifact clearly shows whether speed improved or still blocked.
