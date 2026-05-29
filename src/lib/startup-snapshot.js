"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SNAPSHOT_FILENAME = "startup-snapshot.json";

function startupSnapshotPath(trackerDir) {
  if (typeof trackerDir !== "string" || !trackerDir.trim()) {
    throw new TypeError("trackerDir must be a non-empty string");
  }
  return path.join(trackerDir, SNAPSHOT_FILENAME);
}

function isoFromDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toFiniteNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function roundUsd(value) {
  return Math.round(toFiniteNumber(value) * 1_000_000) / 1_000_000;
}

function normalizeIsoTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return Number.isNaN(Date.parse(trimmed)) ? null : trimmed;
}

function emptyFreshness() {
  return {
    mode: "snapshot",
    recent_ready: false,
    historical_ready: false,
    active_rebuild: false,
  };
}

function emptyStartupSnapshot({ now = new Date(), reason = "missing" } = {}) {
  return {
    ok: true,
    source: "snapshot",
    fresh: false,
    generated_at: isoFromDate(now),
    reason,
    totals: {
      today_cost_usd: 0,
      week_cost_usd: 0,
      today_tokens: 0,
      week_tokens: 0,
    },
    active_sessions: [],
    recent_sessions: [],
    top_providers: [],
    recent_projects: [],
    freshness: emptyFreshness(),
  };
}

function normalizeSnapshotPayload(payload, { now = new Date(), reason = "invalid" } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return emptyStartupSnapshot({ now, reason });
  }
  const empty = emptyStartupSnapshot({ now, reason: payload.reason || reason });
  const totals = payload.totals && typeof payload.totals === "object" ? payload.totals : {};
  const freshness =
    payload.freshness && typeof payload.freshness === "object" && !Array.isArray(payload.freshness)
      ? payload.freshness
      : {};

  return {
    ok: true,
    source: "snapshot",
    fresh: false,
    generated_at: normalizeIsoTimestamp(payload.generated_at) || empty.generated_at,
    ...(payload.reason ? { reason: String(payload.reason) } : {}),
    totals: {
      today_cost_usd: roundUsd(totals.today_cost_usd),
      week_cost_usd: roundUsd(totals.week_cost_usd),
      today_tokens: Math.max(0, Math.floor(toFiniteNumber(totals.today_tokens))),
      week_tokens: Math.max(0, Math.floor(toFiniteNumber(totals.week_tokens))),
    },
    active_sessions: Array.isArray(payload.active_sessions) ? payload.active_sessions : [],
    recent_sessions: Array.isArray(payload.recent_sessions) ? payload.recent_sessions : [],
    top_providers: Array.isArray(payload.top_providers) ? payload.top_providers : [],
    recent_projects: Array.isArray(payload.recent_projects) ? payload.recent_projects : [],
    freshness: {
      mode: "snapshot",
      recent_ready: freshness.recent_ready === true,
      historical_ready: freshness.historical_ready === true,
      active_rebuild: freshness.active_rebuild === true,
    },
  };
}

function rowActivityAt(row) {
  return (
    normalizeIsoTimestamp(row?.last_observed_at) ||
    normalizeIsoTimestamp(row?.ended_at) ||
    normalizeIsoTimestamp(row?.started_at) ||
    normalizeIsoTimestamp(row?.updated_at) ||
    normalizeIsoTimestamp(row?.created_at)
  );
}

function sessionPayload(row) {
  const activityAt = rowActivityAt(row);
  return {
    provider: row.provider,
    session_id: row.session_id,
    started_at: normalizeIsoTimestamp(row.started_at),
    ended_at: normalizeIsoTimestamp(row.ended_at),
    activity_at: activityAt,
    cwd: row.cwd || null,
    repo_root: row.repo_root || null,
    branch: row.branch || null,
    branch_resolution_tier: row.branch_resolution_tier || null,
    confidence: row.confidence || null,
    model: row.model || null,
    total_tokens: Math.max(0, Math.floor(toFiniteNumber(row.total_tokens))),
    total_cost_usd: roundUsd(row.total_cost_usd),
  };
}

function projectKeyForRow(row) {
  if (row.repo_root) return `repo:${row.repo_root}`;
  if (row.cwd) return `cwd:${row.cwd}`;
  return "";
}

function projectPayload(row) {
  return {
    repo_root: row.repo_root || null,
    cwd: row.cwd || null,
    branch: row.branch || null,
    provider: row.provider,
    model: row.model || null,
    activity_at: rowActivityAt(row),
    total_tokens: Math.max(0, Math.floor(toFiniteNumber(row.total_tokens))),
    total_cost_usd: roundUsd(row.total_cost_usd),
  };
}

function utcDayStartMs(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function buildStartupSnapshotFromDb({ dbPath, now = new Date() } = {}) {
  if (typeof dbPath !== "string" || !dbPath.trim() || !fs.existsSync(dbPath)) {
    return emptyStartupSnapshot({ now, reason: "db_missing" });
  }

  const generatedAt = isoFromDate(now);
  const nowDate = new Date(generatedAt);
  const todayStartMs = utcDayStartMs(nowDate);
  const weekStartMs = nowDate.getTime() - 7 * 24 * 60 * 60 * 1000;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db
      .prepare(`
        SELECT
          provider,
          session_id,
          started_at,
          ended_at,
          end_reason,
          cwd,
          repo_root,
          repo_common_dir,
          parent_repo,
          branch,
          branch_resolution_tier,
          confidence,
          model,
          total_tokens,
          total_cost_usd,
          input_tokens,
          cached_input_tokens,
          cache_creation_input_tokens,
          output_tokens,
          reasoning_output_tokens,
          last_observed_at,
          created_at,
          updated_at
        FROM vibedeck_sessions
      `)
      .all();

    const totals = {
      today_cost_usd: 0,
      week_cost_usd: 0,
      today_tokens: 0,
      week_tokens: 0,
    };
    const providers = new Map();
    const latestProjects = new Map();

    const sessions = rows
      .map((row) => ({ row, activityAt: rowActivityAt(row) }))
      .sort((a, b) => String(b.activityAt || "").localeCompare(String(a.activityAt || "")));

    for (const entry of sessions) {
      const activityMs = entry.activityAt ? Date.parse(entry.activityAt) : NaN;
      const tokens = Math.max(0, Math.floor(toFiniteNumber(entry.row.total_tokens)));
      const cost = roundUsd(entry.row.total_cost_usd);
      if (Number.isFinite(activityMs) && activityMs >= todayStartMs) {
        totals.today_tokens += tokens;
        totals.today_cost_usd += cost;
      }
      if (Number.isFinite(activityMs) && activityMs >= weekStartMs) {
        totals.week_tokens += tokens;
        totals.week_cost_usd += cost;
      }

      const provider = entry.row.provider || "unknown";
      if (!providers.has(provider)) {
        providers.set(provider, {
          provider,
          total_tokens: 0,
          total_cost_usd: 0,
          session_count: 0,
        });
      }
      const providerEntry = providers.get(provider);
      providerEntry.total_tokens += tokens;
      providerEntry.total_cost_usd += cost;
      providerEntry.session_count += 1;

      const projectKey = projectKeyForRow(entry.row);
      if (projectKey && !latestProjects.has(projectKey)) {
        latestProjects.set(projectKey, projectPayload(entry.row));
      }
    }

    totals.today_cost_usd = roundUsd(totals.today_cost_usd);
    totals.week_cost_usd = roundUsd(totals.week_cost_usd);

    return {
      ok: true,
      source: "snapshot",
      fresh: false,
      generated_at: generatedAt,
      totals,
      active_sessions: sessions
        .filter((entry) => !entry.row.ended_at)
        .slice(0, 8)
        .map((entry) => sessionPayload(entry.row)),
      recent_sessions: sessions.slice(0, 8).map((entry) => sessionPayload(entry.row)),
      top_providers: Array.from(providers.values())
        .map((entry) => ({ ...entry, total_cost_usd: roundUsd(entry.total_cost_usd) }))
        .sort((a, b) => {
          const byTokens = b.total_tokens - a.total_tokens;
          return byTokens !== 0 ? byTokens : String(a.provider).localeCompare(String(b.provider));
        })
        .slice(0, 5),
      recent_projects: Array.from(latestProjects.values()).slice(0, 8),
      freshness: emptyFreshness(),
    };
  } finally {
    db.close();
  }
}

function writeStartupSnapshot({ trackerDir, dbPath, now = new Date() } = {}) {
  const snapshot = buildStartupSnapshotFromDb({ dbPath, now });
  const targetPath = startupSnapshotPath(trackerDir);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return snapshot;
}

function readStartupSnapshot({ trackerDir, now = new Date() } = {}) {
  let targetPath;
  try {
    targetPath = startupSnapshotPath(trackerDir);
  } catch {
    return emptyStartupSnapshot({ now, reason: "missing" });
  }
  try {
    const payload = JSON.parse(fs.readFileSync(targetPath, "utf8"));
    return normalizeSnapshotPayload(payload, { now });
  } catch (err) {
    if (err?.code === "ENOENT") return emptyStartupSnapshot({ now, reason: "missing" });
    return emptyStartupSnapshot({ now, reason: "invalid" });
  }
}

module.exports = {
  buildStartupSnapshotFromDb,
  writeStartupSnapshot,
  readStartupSnapshot,
  emptyStartupSnapshot,
};
