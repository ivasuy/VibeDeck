# Phase 2 Logical Projection Shards Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Add a durable shard registry so rebuild/startup can track provider/time-window readiness without splitting physical SQLite files.

**Architecture:** Add `vibedeck_projection_shards` as metadata only. It records source groups, provider, scope, status, watermarks, counts, and errors. It must not replace canonical projection tables.

## Task P2-T1 Shard Registry Schema And Helpers

**Files:**
- Create: `src/lib/db/migrations/016-projection-shards.js`
- Modify: `src/lib/db/index.js`
- Create: `src/lib/projection-shards.js`
- Test: `test/projection-shards.test.js`

**Instructions:**

Add helpers:

```js
function upsertProjectionShard({ dbPath, shard } = {}) {}
function markProjectionShardReady({ dbPath, shardKey, counts = {}, now = new Date() } = {}) {}
function markProjectionShardFailed({ dbPath, shardKey, error, now = new Date() } = {}) {}
function readProjectionFreshness({ dbPath, now = new Date() } = {}) {}
```

Shard fields:

- `shard_key`
- `provider`
- `source_group`
- `scope`: `active`, `recent`, or `historical`
- `status`: `pending`, `building`, `ready`, `stale`, or `failed`
- `watermark_json`
- `file_count`, `event_count`, `session_count`, `fact_count`
- `started_at`, `finished_at`, `last_error`, `created_at`, `updated_at`

**Acceptance:**

- Migration is additive and idempotent under the migration framework.
- Freshness reports `recent_ready` and `historical_ready` from shard status.
- Existing DB schema and canonical tables are untouched.

**Checks:**

- `node --test test/projection-shards.test.js`
- `node -c src/lib/projection-shards.js src/lib/db/index.js`

