'use strict';

module.exports = {
  component: 'vibedeck-branch-usage-facts',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_branch_usage_facts (
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        project_state TEXT NOT NULL,
        project_key TEXT NOT NULL,
        project_ref TEXT,
        cwd TEXT,
        repo_root TEXT,
        repo_common_dir TEXT,
        parent_repo TEXT,
        branch TEXT NOT NULL,
        attribution_branch TEXT,
        branch_kind TEXT NOT NULL,
        branch_resolution_tier TEXT,
        confidence TEXT NOT NULL,
        model TEXT NOT NULL,
        first_observed_at TEXT NOT NULL,
        last_observed_at TEXT NOT NULL,
        event_count INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        conversation_count INTEGER NOT NULL DEFAULT 0,
        total_cost_usd REAL,
        cost_estimated INTEGER NOT NULL DEFAULT 1,
        cost_quality TEXT NOT NULL,
        token_reconciled INTEGER NOT NULL DEFAULT 0,
        cost_reconciled INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, session_id, scope_key, branch, branch_kind, model)
      );

      CREATE INDEX idx_branch_usage_facts_session
        ON vibedeck_branch_usage_facts(provider, session_id);

      CREATE INDEX idx_branch_usage_facts_project
        ON vibedeck_branch_usage_facts(project_state, project_ref, last_observed_at);

      CREATE INDEX idx_branch_usage_facts_activity
        ON vibedeck_branch_usage_facts(scope_key, branch, last_observed_at);
    `);
  },
};
