'use strict';

module.exports = {
  component: 'vibedeck-sessions',
  version: 4,
  up(db) {
    db.exec(`
      ALTER TABLE vibedeck_session_events ADD COLUMN cache_creation_5m_input_tokens INTEGER;
      ALTER TABLE vibedeck_session_events ADD COLUMN cache_creation_1h_input_tokens INTEGER;
      ALTER TABLE vibedeck_session_events ADD COLUMN web_search_requests INTEGER;
      ALTER TABLE vibedeck_session_events ADD COLUMN tool_call_count INTEGER;
      ALTER TABLE vibedeck_session_events ADD COLUMN tools_json TEXT;
      ALTER TABLE vibedeck_session_events ADD COLUMN activity_json TEXT;

      ALTER TABLE vibedeck_sessions ADD COLUMN cache_creation_5m_input_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN cache_creation_1h_input_tokens INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN web_search_requests INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN tool_call_count INTEGER;
      ALTER TABLE vibedeck_sessions ADD COLUMN tools_json TEXT;
      ALTER TABLE vibedeck_sessions ADD COLUMN activity_json TEXT;

      ALTER TABLE vibedeck_session_buckets ADD COLUMN cache_creation_5m_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN cache_creation_1h_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN tools_json TEXT;
      ALTER TABLE vibedeck_session_buckets ADD COLUMN activity_json TEXT;

      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN cache_creation_5m_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN cache_creation_1h_input_tokens INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN web_search_requests INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN tool_call_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN tools_json TEXT;
      ALTER TABLE vibedeck_branch_usage_facts ADD COLUMN activity_json TEXT;
    `);
  },
};
