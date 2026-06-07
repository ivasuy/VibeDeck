# Next Release Gap Audit

**Date:** 2026-06-06
**Branch:** `agent/next-release-gap-audit`
**Scope:** stale app surfaces and release-readiness gaps after removing the public Entire command/dashboard/API surface.

## Findings

### Fixed in this branch

- Removed the dormant dashboard Entire page, components, inactive copy catalog, and excluded test suites.
- Removed disabled local API handlers for Entire checkpoints, Entire commands, destructive confirmation, and known repo selection.
- Removed unused dashboard API wrappers for removed local API endpoints.
- Removed unused bootstrap code that attempted to detect or log in to Entire.
- Removed unused bridge, checkpoint, Tier-A branch-resolution, and checkpoint-backfill modules.
- Removed tests that asserted removed routes or removed modules.
- Updated branch-resolution tests and docs to match the current runtime path.
- Generalized hook-merger preservation tests away from old product-specific hook names while still proving external/user hooks are preserved.
- Renamed ordinary test fixture branches away from old product-specific branch names.
- Synchronized the macOS embedded backend source copy with the cleaned root backend so packaged app builds do not retain removed Entire handlers or modules.
- Fixed the project test runner isolation so `npm test` uses a temporary home, serialized Node tests, and deterministic Git fixture identity.
- Removed eager runtime dependency loading from copied local runtime paths so `init` can rerun from the installed app copy.

### Verification

- `npm test` passed: 1,190 tests, 31 suites, 0 failures.
- `git diff --check` passed.

### Intentionally retained

- DB migrations and tables with historical `entire` names remain because existing local SQLite databases may already have those migration components applied.
- Sync rebuild still clears historical Entire-link tables so old rows do not leak into rebuilt canonical data.
- Hook-merger code preserves non-VibeDeck hook entries generically so VibeDeck install/remove operations do not delete user-owned or third-party hooks.

### Still worth deciding before the next release

- Whether to add a forward migration that renames or deprecates historical `entire`-named tables. That needs an explicit compatibility plan because migration component names are part of local DB history.
