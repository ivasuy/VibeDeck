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

function normalizeIdentity(identity) {
  const provider = typeof identity?.provider === 'string' ? identity.provider.trim() : '';
  const sessionId = typeof identity?.session_id === 'string' ? identity.session_id.trim() : '';
  if (!provider || !sessionId) return null;
  return { provider, session_id: sessionId };
}

function summarizeCanonicalCompletenessForSessions(dbPath, identities) {
  if (typeof dbPath !== 'string' || !dbPath.trim() || !fs.existsSync(dbPath)) {
    return { complete: false, reason: 'db_missing' };
  }

  const scoped = Array.from(new Map(
    (Array.isArray(identities) ? identities : [])
      .map((identity) => normalizeIdentity(identity))
      .filter(Boolean)
      .map((identity) => [`${identity.provider}:${identity.session_id}`, identity]),
  ).values());

  if (scoped.length === 0) {
    return {
      complete: true,
      session_count: 0,
      event_count: 0,
      bucket_fact_count: 0,
      sessions_missing_bucket_facts: 0,
      sessions_missing_stored_cost: 0,
    };
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const valuesSql = scoped.map(() => '(?, ?)').join(', ');
    const identityParams = scoped.flatMap((identity) => [identity.provider, identity.session_id]);
    const scopedSql = `WITH scoped(provider, session_id) AS (VALUES ${valuesSql})`;
    const row = db.prepare(
      `${scopedSql}
       SELECT
         COUNT(*) AS session_count,
         (
           SELECT COUNT(*)
           FROM vibedeck_session_events e
           JOIN scoped sc
             ON sc.provider = e.provider AND sc.session_id = e.session_id
         ) AS event_count,
         (
           SELECT COUNT(*)
           FROM vibedeck_session_buckets b
           JOIN scoped sc
             ON sc.provider = b.provider AND sc.session_id = b.session_id
         ) AS bucket_fact_count,
         SUM(CASE WHEN COALESCE(s.total_tokens, 0) > 0
           AND NOT EXISTS (
             SELECT 1 FROM vibedeck_session_buckets b
             WHERE b.provider = s.provider AND b.session_id = s.session_id
           )
           THEN 1 ELSE 0 END) AS sessions_missing_bucket_facts,
         SUM(CASE WHEN COALESCE(s.total_tokens, 0) > 0 AND s.total_cost_usd IS NULL
           THEN 1 ELSE 0 END) AS sessions_missing_stored_cost
       FROM vibedeck_sessions s
       JOIN scoped sc
         ON sc.provider = s.provider AND sc.session_id = s.session_id`,
    ).get(...identityParams);

    const sessionCount = Number(row?.session_count || 0);
    const eventCount = Number(row?.event_count || 0);
    const bucketCount = Number(row?.bucket_fact_count || 0);
    const missingBucketFacts = Number(row?.sessions_missing_bucket_facts || 0);
    const missingStoredCost = Number(row?.sessions_missing_stored_cost || 0);
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

module.exports = { readCanonicalCompleteness, summarizeCanonicalCompletenessForSessions };
