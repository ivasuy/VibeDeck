# Phase 7 Hardening And Default Rollout Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Make the fast startup/rebuild pipeline default-safe with smoke coverage, docs, and rollback controls.

## Task P7-T1 Defaults, Observability, And Release Notes

**Files:**
- Modify: `src/commands/sync.js`
- Modify: `src/commands/serve.js`
- Modify: `src/lib/local-api.js`
- Modify: `PROJECT.md`
- Add smoke scripts if needed under `scripts/smoke/`.

**Instructions:**

- Choose conservative defaults for snapshot, recent-first rebuild, and freshness reporting.
- Keep env flags for rollback.
- Add profile/diagnostic output that shows first-paint readiness time and historical completion.
- Update PROJECT.md with real smoke results.

**Acceptance:**

- Fresh install opens from snapshot/empty shell without waiting for full history.
- Full rebuild final data matches baseline.
- Rollback env flags are documented.

**Checks:**

- `node --test test/startup-snapshot.test.js test/projection-shards.test.js test/projection-freshness.test.js`
- `node --test test/sync-rebuild-vibedeck-db.test.js test/rebuild-parity-harness.test.js`
- `npm --prefix dashboard run build`
- macOS build smoke if native files changed.

