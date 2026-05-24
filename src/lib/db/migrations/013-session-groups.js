'use strict';

module.exports = {
  component: 'vibedeck-session-groups',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_session_group_edges (
        provider TEXT NOT NULL,
        session_group_id TEXT NOT NULL,
        root_session_id TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        root_thread_id TEXT,
        child_thread_id TEXT,
        relation_proof TEXT NOT NULL,
        depth INTEGER NOT NULL DEFAULT 1,
        agent_id TEXT,
        agent_label TEXT,
        agent_role TEXT,
        source_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, child_session_id),
        CHECK (root_session_id <> child_session_id)
      );

      CREATE INDEX idx_session_group_edges_group
        ON vibedeck_session_group_edges(provider, session_group_id);

      CREATE INDEX idx_session_group_edges_root
        ON vibedeck_session_group_edges(provider, root_session_id);

      CREATE TABLE vibedeck_session_group_skips (
        provider TEXT NOT NULL,
        child_session_id TEXT NOT NULL,
        child_thread_id TEXT,
        skip_reason TEXT NOT NULL,
        source_path TEXT,
        observed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, child_session_id, skip_reason)
      );

      CREATE INDEX idx_session_group_skips_reason
        ON vibedeck_session_group_skips(provider, skip_reason);
    `);
  },
};
