'use strict';

module.exports = {
  component: 'vibedeck-optimize',
  version: 1,
  up(db) {
    db.exec(`
      CREATE TABLE vibedeck_optimize_runs (
        run_id TEXT PRIMARY KEY,
        observed_at TEXT NOT NULL,
        health_grade TEXT NOT NULL,
        score INTEGER NOT NULL,
        finding_count INTEGER NOT NULL DEFAULT 0,
        high_count INTEGER NOT NULL DEFAULT 0,
        medium_count INTEGER NOT NULL DEFAULT 0,
        low_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE vibedeck_optimize_findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES vibedeck_optimize_runs(run_id),
        fingerprint TEXT NOT NULL,
        scope TEXT NOT NULL,
        scope_ref TEXT,
        provider TEXT,
        session_id TEXT,
        finding_kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL,
        estimated_token_waste INTEGER NOT NULL DEFAULT 0,
        estimated_cost_waste_usd REAL NOT NULL DEFAULT 0,
        paste_fix TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        trend TEXT NOT NULL DEFAULT 'new',
        observed_at TEXT NOT NULL,
        resolved_at TEXT,
        previous_finding_id INTEGER REFERENCES vibedeck_optimize_findings(id),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (scope IN ('session', 'project', 'config')),
        CHECK (finding_kind IN ('file_reread', 'low_read_edit_ratio', 'bloated_claude_md')),
        CHECK (severity IN ('high', 'medium', 'low')),
        CHECK (status IN ('open', 'resolved')),
        CHECK (trend IN ('new', 'improving', 'unchanged', 'resolved')),
        CHECK (estimated_token_waste >= 0),
        CHECK (estimated_cost_waste_usd >= 0)
      );

      CREATE INDEX idx_optimize_findings_run ON vibedeck_optimize_findings(run_id);
      CREATE INDEX idx_optimize_findings_status ON vibedeck_optimize_findings(status, observed_at);
      CREATE INDEX idx_optimize_findings_kind ON vibedeck_optimize_findings(finding_kind, severity);
      CREATE INDEX idx_optimize_findings_session ON vibedeck_optimize_findings(provider, session_id);
      CREATE INDEX idx_optimize_findings_fingerprint ON vibedeck_optimize_findings(fingerprint, observed_at);
    `);
  },
};
