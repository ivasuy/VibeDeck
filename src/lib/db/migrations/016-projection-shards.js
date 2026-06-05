'use strict';

module.exports = {
  component: 'vibedeck-projection-shards',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS vibedeck_projection_shards (
        shard_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        source_group TEXT NOT NULL,
        scope TEXT NOT NULL,
        status TEXT NOT NULL,
        watermark_json TEXT,
        file_count INTEGER NOT NULL DEFAULT 0,
        event_count INTEGER NOT NULL DEFAULT 0,
        session_count INTEGER NOT NULL DEFAULT 0,
        fact_count INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (scope IN ('active', 'recent', 'historical')),
        CHECK (status IN ('pending', 'building', 'ready', 'stale', 'failed')),
        CHECK (file_count >= 0),
        CHECK (event_count >= 0),
        CHECK (session_count >= 0),
        CHECK (fact_count >= 0)
      );

      CREATE INDEX IF NOT EXISTS idx_projection_shards_scope_status
        ON vibedeck_projection_shards(scope, status);
      CREATE INDEX IF NOT EXISTS idx_projection_shards_provider_group
        ON vibedeck_projection_shards(provider, source_group);
      CREATE INDEX IF NOT EXISTS idx_projection_shards_updated
        ON vibedeck_projection_shards(updated_at);
    `);
  },
};
