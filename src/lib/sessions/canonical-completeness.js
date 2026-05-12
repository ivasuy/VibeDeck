'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

function readCanonicalCompleteness(dbPath) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || !fs.existsSync(dbPath)) {
    return { complete: false, reason: 'db_missing' };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sessionCount = Number(db.prepare('SELECT COUNT(*) AS c FROM vibedeck_sessions').get()?.c || 0);
    const eventCount = Number(db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_events').get()?.c || 0);
    const bucketCount = Number(db.prepare('SELECT COUNT(*) AS c FROM vibedeck_session_buckets').get()?.c || 0);
    const missingBucketFacts = Number(
      db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM vibedeck_sessions s
          WHERE COALESCE(s.total_tokens, 0) > 0
            AND NOT EXISTS (
              SELECT 1 FROM vibedeck_session_buckets b
              WHERE b.provider = s.provider AND b.session_id = s.session_id
            )
        `)
        .get()?.c || 0,
    );
    const missingStoredCost = Number(
      db
        .prepare(`
          SELECT COUNT(*) AS c
          FROM vibedeck_sessions
          WHERE COALESCE(total_tokens, 0) > 0
            AND total_cost_usd IS NULL
        `)
        .get()?.c || 0,
    );

    return {
      complete: sessionCount === 0 || (bucketCount > 0 && missingBucketFacts === 0),
      session_count: sessionCount,
      event_count: eventCount,
      bucket_fact_count: bucketCount,
      sessions_missing_bucket_facts: missingBucketFacts,
      sessions_missing_stored_cost: missingStoredCost,
    };
  } catch (cause) {
    return { complete: false, reason: cause?.message || String(cause) };
  } finally {
    db.close();
  }
}

module.exports = { readCanonicalCompleteness };
