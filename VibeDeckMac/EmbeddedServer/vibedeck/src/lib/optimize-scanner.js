'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('./db');

const COST_PER_TOKEN = 0.000003;
const CLAUDE_MD_LIMIT_BYTES = 80 * 1024;

const PASTE_FIXES = {
  file_reread: 'Cache repeated file reads or summarize the file once before asking follow-up questions.',
  low_read_edit_ratio: 'Batch reads into a short plan, then edit only the files that need changes.',
  bloated_claude_md: 'Split CLAUDE.md into focused docs and keep the root file under 80 KB.',
};

function parseCounterJson(value) {
  if (!value || typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (_err) {
    return {};
  }
}

function counterValue(counter, names) {
  let total = 0;
  const wanted = new Set(names.map((name) => String(name).toLowerCase()));
  for (const [key, value] of Object.entries(counter || {})) {
    if (wanted.has(String(key).toLowerCase())) {
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) total += n;
    }
  }
  return total;
}

function roundCost(tokens) {
  return Number((Math.max(0, Number(tokens) || 0) * COST_PER_TOKEN).toFixed(6));
}

function buildFindingFingerprint(finding) {
  const parts = [
    finding.finding_kind,
    finding.scope,
    finding.scope_ref || '',
    finding.provider || '',
    finding.session_id || '',
  ];
  return crypto.createHash('sha256').update(parts.join('\u001f')).digest('hex');
}

function computeHealthGrade(counts = {}) {
  const high = Number(counts.high || 0);
  const medium = Number(counts.medium || 0);
  const low = Number(counts.low || 0);
  const score = Math.max(0, 100 - high * 20 - medium * 8 - low * 3);
  let health_grade = 'F';
  if (score >= 90) health_grade = 'A';
  else if (score >= 80) health_grade = 'B';
  else if (score >= 70) health_grade = 'C';
  else if (score >= 60) health_grade = 'D';
  else if (score >= 50) health_grade = 'E';
  return { score, health_grade };
}

function emptyCounts() {
  return { high: 0, medium: 0, low: 0 };
}

function countBy(rows, field) {
  const counts = {};
  for (const row of rows) {
    counts[row[field]] = (counts[row[field]] || 0) + 1;
  }
  return counts;
}

function readSessionRows(db) {
  return db
    .prepare(
      `
      SELECT provider, session_id, cwd, repo_root, model, tools_json, activity_json,
             input_tokens, output_tokens, cached_input_tokens, last_observed_at, started_at
      FROM vibedeck_sessions
      ORDER BY provider, session_id
      `,
    )
    .all();
}

function readEventRows(db) {
  return db
    .prepare(
      `
      SELECT provider, session_id, tools_json, activity_json, input_tokens, output_tokens,
             cached_input_tokens, observed_at
      FROM vibedeck_session_events
      ORDER BY provider, session_id, observed_at, event_key
      `,
    )
    .all();
}

function aggregateEventsBySession(rows) {
  const bySession = new Map();
  for (const row of rows) {
    const key = `${row.provider}\u001f${row.session_id}`;
    let aggregate = bySession.get(key);
    if (!aggregate) {
      aggregate = { tools: {}, activity: {}, event_count: 0 };
      bySession.set(key, aggregate);
    }
    aggregate.event_count += 1;
    mergeCounter(aggregate.tools, parseCounterJson(row.tools_json));
    mergeCounter(aggregate.activity, parseCounterJson(row.activity_json));
  }
  return bySession;
}

function mergeCounter(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    const n = Number(value);
    if (Number.isFinite(n)) target[key] = (Number(target[key]) || 0) + n;
  }
}

function buildSessionFindings(db) {
  const eventAggregates = aggregateEventsBySession(readEventRows(db));
  const findings = [];
  for (const row of readSessionRows(db)) {
    const aggregate = eventAggregates.get(`${row.provider}\u001f${row.session_id}`);
    const tools = parseCounterJson(row.tools_json);
    const activity = parseCounterJson(row.activity_json);
    if (aggregate && Object.keys(tools).length === 0) {
      mergeCounter(tools, aggregate.tools);
    }
    if (aggregate && Object.keys(activity).length === 0) {
      mergeCounter(activity, aggregate.activity);
    }

    const readCount = counterValue(tools, ['Read']);
    const editCount = counterValue(tools, ['Edit', 'MultiEdit', 'Write']);
    const readingCount = counterValue(activity, ['reading']);
    const scopeRef = row.repo_root || row.cwd || null;

    if (readCount >= 10 && editCount <= 1) {
      const estimated_token_waste = Math.max(0, readCount - editCount - 4) * 700;
      findings.push({
        scope: 'session',
        scope_ref: scopeRef,
        provider: row.provider,
        session_id: row.session_id,
        finding_kind: 'low_read_edit_ratio',
        severity: 'medium',
        title: 'High read volume with few edits',
        detail: `Session ${row.session_id} used Read ${readCount} times and edit/write tools ${editCount} times.`,
        estimated_token_waste,
        estimated_cost_waste_usd: roundCost(estimated_token_waste),
        paste_fix: PASTE_FIXES.low_read_edit_ratio,
      });
    } else if (readCount > 4 && readingCount > 0) {
      const estimated_token_waste = Math.max(0, readCount - 1) * 1000;
      findings.push({
        scope: 'session',
        scope_ref: scopeRef,
        provider: row.provider,
        session_id: row.session_id,
        finding_kind: 'file_reread',
        severity: 'medium',
        title: 'Repeated file reads in one session',
        detail: `Session ${row.session_id} used Read ${readCount} times with reading activity.`,
        estimated_token_waste,
        estimated_cost_waste_usd: roundCost(estimated_token_waste),
        paste_fix: PASTE_FIXES.file_reread,
      });
    }
  }
  return findings;
}

function buildConfigFindings(cwd) {
  const findings = [];
  const claudePath = path.join(cwd || process.cwd(), 'CLAUDE.md');
  let stat = null;
  try {
    stat = fs.statSync(claudePath);
  } catch (_err) {
    return findings;
  }
  if (!stat.isFile() || stat.size <= CLAUDE_MD_LIMIT_BYTES) return findings;
  const estimated_token_waste = Math.ceil(stat.size / 4);
  findings.push({
    scope: 'config',
    scope_ref: claudePath,
    provider: null,
    session_id: null,
    finding_kind: 'bloated_claude_md',
    severity: 'low',
    title: 'Large CLAUDE.md may inflate prompts',
    detail: `CLAUDE.md is ${stat.size} bytes, above the 80 KB optimizer threshold.`,
    estimated_token_waste,
    estimated_cost_waste_usd: roundCost(estimated_token_waste),
    paste_fix: PASTE_FIXES.bloated_claude_md,
  });
  return findings;
}

function normalizeFindings(findings) {
  return findings.map((finding) => ({
    ...finding,
    fingerprint: buildFindingFingerprint(finding),
  }));
}

function runOptimizeScan({ dbPath, now = new Date(), cwd = process.cwd() } = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new TypeError('runOptimizeScan: dbPath must be a non-empty string');
  }
  ensureSchema(dbPath);
  const observed_at = now.toISOString();
  const run_id = `opt-${observed_at}`;
  const db = new DatabaseSync(dbPath);
  try {
    const findings = normalizeFindings([...buildSessionFindings(db), ...buildConfigFindings(cwd)]);
    const severityCounts = { ...emptyCounts(), ...countBy(findings, 'severity') };
    const { score, health_grade } = computeHealthGrade(severityCounts);
    const kindCounts = countBy(findings, 'finding_kind');
    const currentFingerprints = new Set(findings.map((finding) => finding.fingerprint));
    const previousOpen = db
      .prepare(
        `
        SELECT *
        FROM vibedeck_optimize_findings
        WHERE status = 'open'
        ORDER BY observed_at DESC, id DESC
        `,
      )
      .all();
    const previousByFingerprint = new Map();
    for (const row of previousOpen) {
      if (!previousByFingerprint.has(row.fingerprint)) previousByFingerprint.set(row.fingerprint, row);
    }
    const resolvedPrevious = [...previousByFingerprint.values()].filter(
      (row) => !currentFingerprints.has(row.fingerprint),
    );

    db.exec('BEGIN');
    try {
      db.prepare(
        `
        INSERT INTO vibedeck_optimize_runs (
          run_id, observed_at, health_grade, score, finding_count,
          high_count, medium_count, low_count, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      ).run(
        run_id,
        observed_at,
        health_grade,
        score,
        findings.length,
        severityCounts.high || 0,
        severityCounts.medium || 0,
        severityCounts.low || 0,
        observed_at,
      );

      const insertFinding = db.prepare(
        `
        INSERT INTO vibedeck_optimize_findings (
          run_id, fingerprint, scope, scope_ref, provider, session_id,
          finding_kind, severity, title, detail, estimated_token_waste,
          estimated_cost_waste_usd, paste_fix, status, trend, observed_at,
          resolved_at, previous_finding_id, created_at, updated_at
        ) VALUES (
          @run_id, @fingerprint, @scope, @scope_ref, @provider, @session_id,
          @finding_kind, @severity, @title, @detail, @estimated_token_waste,
          @estimated_cost_waste_usd, @paste_fix, @status, @trend, @observed_at,
          @resolved_at, @previous_finding_id, @created_at, @updated_at
        )
        `,
      );

      for (const finding of findings) {
        const previous = previousByFingerprint.get(finding.fingerprint);
        insertFinding.run({
          ...finding,
          run_id,
          status: 'open',
          trend: previous ? 'unchanged' : 'new',
          observed_at,
          resolved_at: null,
          previous_finding_id: previous ? previous.id : null,
          created_at: observed_at,
          updated_at: observed_at,
        });
      }

      for (const previous of resolvedPrevious) {
        db.prepare(
          'UPDATE vibedeck_optimize_findings SET status = ?, resolved_at = ?, updated_at = ? WHERE status = ? AND fingerprint = ?',
        ).run(
          'resolved',
          observed_at,
          observed_at,
          'open',
          previous.fingerprint,
        );
        insertFinding.run({
          run_id,
          fingerprint: previous.fingerprint,
          scope: previous.scope,
          scope_ref: previous.scope_ref,
          provider: previous.provider,
          session_id: previous.session_id,
          finding_kind: previous.finding_kind,
          severity: previous.severity,
          title: previous.title,
          detail: previous.detail,
          estimated_token_waste: 0,
          estimated_cost_waste_usd: 0,
          paste_fix: previous.paste_fix,
          status: 'resolved',
          trend: 'resolved',
          observed_at,
          resolved_at: observed_at,
          previous_finding_id: previous.id,
          created_at: observed_at,
          updated_at: observed_at,
        });
      }

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_rollbackErr) {}
      throw err;
    }

    return {
      ok: true,
      run_id,
      observed_at,
      inserted: findings.length,
      resolved: resolvedPrevious.length,
      health_grade,
      score,
      counts_by_severity: severityCounts,
      counts_by_kind: kindCounts,
    };
  } finally {
    db.close();
  }
}

function readOptimizeFindings({ dbPath, status = 'open', limit = 100 } = {}) {
  if (typeof dbPath !== 'string' || dbPath.trim() === '') {
    throw new TypeError('readOptimizeFindings: dbPath must be a non-empty string');
  }
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const latest_run = db
      .prepare('SELECT * FROM vibedeck_optimize_runs ORDER BY observed_at DESC, run_id DESC LIMIT 1')
      .get() || null;
    const health = latest_run
      ? {
          health_grade: latest_run.health_grade,
          score: latest_run.score,
          observed_at: latest_run.observed_at,
          counts_by_severity: {
            high: latest_run.high_count,
            medium: latest_run.medium_count,
            low: latest_run.low_count,
          },
        }
      : null;
    const n = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 100)));
    const findings = db
      .prepare(
        `
        SELECT *
        FROM vibedeck_optimize_findings
        WHERE id IN (
          SELECT MAX(id)
          FROM vibedeck_optimize_findings
          WHERE status = ?
          GROUP BY fingerprint
        )
        ORDER BY observed_at DESC, severity ASC, id DESC
        LIMIT ${n}
        `,
      )
      .all(status);
    return { ok: true, findings, latest_run, health };
  } finally {
    db.close();
  }
}

module.exports = {
  runOptimizeScan,
  readOptimizeFindings,
  computeHealthGrade,
  buildFindingFingerprint,
};
