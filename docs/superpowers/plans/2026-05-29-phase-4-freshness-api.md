# Phase 4 Freshness API Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Expose honest partial-readiness metadata through local API payloads so UI can distinguish no data from indexing.

## Task P4-T1 Freshness Read Model And Endpoint Metadata

**Files:**
- Create: `src/lib/projection-freshness.js`
- Modify: `src/lib/local-api.js`
- Test: `test/projection-freshness.test.js`
- Test: selected local API tests for usage, dashboard/live, heatmap.

**Instructions:**

Add a reusable freshness payload:

```json
{
  "mode": "complete|partial|snapshot|empty",
  "recent_ready": true,
  "historical_ready": false,
  "active_rebuild": false,
  "complete_through": "ISO|null",
  "indexing_providers": [],
  "failed_shards": []
}
```

Attach freshness to startup snapshot and high-level API responses without breaking existing keys.

**Acceptance:**

- Empty DB does not look like completed zero usage.
- Partial projection says `mode: "partial"`.
- Complete projection says `mode: "complete"`.

**Checks:**

- `node --test test/projection-freshness.test.js test/local-api-phase5.test.js`

