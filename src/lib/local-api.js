const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { getLiveBus } = require("./sessions/live-bus");
const { reapOrphanedSessions } = require("./sessions/reaper");
const { requireWriteAuth, issueConfirmToken, consumeConfirmToken } = require("./local-auth");
const {
  filterRowsByUsageScope,
  getSourceScope,
  listExcludedSources,
  normalizeUsageScope,
} = require("./source-metadata");

const SYNC_TIMEOUT_MS = 120_000;
const TRACKER_BIN = path.resolve(__dirname, "../../bin/vibedeck.js");

// ---------------------------------------------------------------------------
// Live sessions SSE: /functions/vibedeck-sessions-live
// ---------------------------------------------------------------------------

function readMsEnv(key, fallback) {
  const raw = Number(process.env[key]);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.trunc(raw);
}

const SSE_MAX_CLIENTS = 10;
const SSE_RING_CAP = 1000;
const SSE_RETRY_AFTER_SECONDS = 30;
const SSE_HEARTBEAT_MS = readMsEnv("VIBEDECK_SSE_HEARTBEAT_MS", 30_000);
const SSE_IDLE_MS = readMsEnv("VIBEDECK_SSE_IDLE_MS", 60 * 60 * 1000);
const SSE_IDLE_SCAN_MS = readMsEnv("VIBEDECK_SSE_IDLE_SCAN_MS", 60 * 60 * 1000);

let liveSseClientCount = 0;
let liveSseClients = new Set();
let liveSseIdleInterval = null;

function ensureSseIdleScanner() {
  if (liveSseIdleInterval) return;
  liveSseIdleInterval = setInterval(() => {
    const now = Date.now();
    for (const client of liveSseClients) {
      if (now - client.lastWriteAt > SSE_IDLE_MS) {
        client.close("idle");
      }
    }
  }, SSE_IDLE_SCAN_MS);
  if (typeof liveSseIdleInterval.unref === "function") liveSseIdleInterval.unref();
}

function maybeStopSseIdleScanner() {
  if (liveSseClientCount > 0) return;
  if (!liveSseIdleInterval) return;
  clearInterval(liveSseIdleInterval);
  liveSseIdleInterval = null;
}

function resetLiveSseStateForTests() {
  for (const client of liveSseClients) {
    try {
      client.close("test_reset");
    } catch {}
  }
  liveSseClients = new Set();
  liveSseClientCount = 0;
  maybeStopSseIdleScanner();
}

function stringifySsePayload(payload) {
  return JSON.stringify(payload, (_key, value) => {
    if (typeof value === "bigint") return Number(value);
    return value;
  });
}

function toLiveCostNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function enrichLiveSessionCost(row) {
  const costResult = resolveUsageCost({
    stored_cost_usd: row?.total_cost_usd,
    source: row?.provider,
    model: row?.model,
    total_tokens: row?.total_tokens,
  });

  return {
    ...row,
    estimated_total_cost_usd: toLiveCostNumber(costResult.total_cost_usd),
    cost_estimated: costResult.cost_estimated,
    cost_quality: costResult.cost_quality,
  };
}

// ---------------------------------------------------------------------------
// Per-model pricing — delegated to src/lib/pricing/
//   - CURATED overrides (kiro-*, hy3-*, composer-*, kimi-for-coding, etc.)
//   - LiteLLM live data (mainstream claude / gpt-5 / gemini), 24h disk-cached
//   - Bundled seed snapshot for first-install / offline fallback
// ---------------------------------------------------------------------------

const {
  MODEL_PRICING,
  getModelPricing,
  computeRowCost,
  ensurePricingLoaded,
} = require("./pricing");
const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require("./cost-estimation");

// ---------------------------------------------------------------------------
// Queue data helpers
// ---------------------------------------------------------------------------

function resolveQueuePath() {
  const home = os.homedir();
  return path.join(home, ".vibedeck", "tracker", "queue.jsonl");
}

function readProjectQueueData(projectQueuePath) {
  let raw;
  try {
    raw = fs.readFileSync(projectQueuePath, "utf8");
  } catch (e) {
    if (e?.code !== "ENOENT") {
      console.error("[LocalAPI] readProjectQueueData: failed to read:", e?.message || e);
    }
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  const seen = new Map();
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      const key = `${row.project_key || ""}|${row.source || ""}|${row.hour_start || ""}`;
      seen.set(key, row);
    } catch {
      // skip malformed
    }
  }
  return Array.from(seen.values());
}

function normalizeProjectUsageSourceFilter(rawValue) {
  const values = String(rawValue || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

function matchesProjectUsageSourceFilter(sourceFilter, source) {
  if (!sourceFilter || sourceFilter.size === 0) return true;
  return sourceFilter.has(String(source || "").trim().toLowerCase());
}

function readSessionProjectUsage(dbPath, filters = {}) {
  if (!fs.existsSync(dbPath)) return [];
  const clauses = ["repo_root IS NOT NULL", "repo_root <> ''"];
  const params = [];

  if (filters.sourceFilter && filters.sourceFilter.size > 0) {
    const placeholders = Array.from(filters.sourceFilter, () => "?").join(", ");
    clauses.push(`LOWER(COALESCE(provider, '')) IN (${placeholders})`);
    params.push(...filters.sourceFilter);
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`
      SELECT
        repo_root,
        provider,
        branch,
        model,
        COALESCE(total_tokens, 0) AS total_tokens,
        total_cost_usd,
        COALESCE(ended_at, updated_at, started_at) AS activity_at
      FROM vibedeck_sessions
      WHERE ${clauses.join(" AND ")}
    `).all(...params);
  } finally {
    db.close();
  }
}

function safeReadJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeStatMtimeIso(filePath) {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function readSessionCounts(dbPath) {
  try {
    if (!fs.existsSync(dbPath)) {
      return { session_count: 0, open_session_count: 0 };
    }
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(`
          SELECT
            COUNT(*) AS session_count,
            SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open_session_count
          FROM vibedeck_sessions
        `)
        .get();
      return {
        session_count: Number(row?.session_count || 0),
        open_session_count: Number(row?.open_session_count || 0),
      };
    } finally {
      db.close();
    }
  } catch {
    return { session_count: 0, open_session_count: 0 };
  }
}

function readSyncStatus({ queuePath, syncEnabled = true }) {
  const trackerDir = path.dirname(queuePath);
  const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
  const cursorsPath = path.join(trackerDir, "cursors.json");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  const cursors = safeReadJsonFile(cursorsPath);
  const sessionCounts = readSessionCounts(dbPath);

  return {
    last_parse_at: normalizeIsoTimestamp(cursors?.updatedAt),
    queue_updated_at: safeStatMtimeIso(queuePath),
    project_queue_updated_at: safeStatMtimeIso(projectQueuePath),
    session_count: sessionCounts.session_count,
    open_session_count: sessionCounts.open_session_count,
    sync_enabled: syncEnabled !== false,
  };
}

function normalizeIsoTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function projectRowLastSeenAt(row) {
  return (
    normalizeIsoTimestamp(row?.timestamp) ||
    normalizeIsoTimestamp(row?.last_seen_at) ||
    normalizeIsoTimestamp(row?.updated_at) ||
    normalizeIsoTimestamp(row?.hour_start)
  );
}

function splitRepoRootSegments(repoRoot) {
  return String(repoRoot || "")
    .trim()
    .split(/[\\/]+/)
    .filter(Boolean);
}

function localProjectKeyForDepth(repoRoot, depth) {
  const parts = splitRepoRootSegments(repoRoot);
  if (parts.length === 0) return String(repoRoot || "").trim() || "unknown";
  return parts.slice(Math.max(0, parts.length - depth)).join("/");
}

function buildLocalProjectKeyMap(sessionProjectRows) {
  const repoRoots = Array.from(
    new Set(
      sessionProjectRows
        .map((row) => String(row?.repo_root || "").trim())
        .filter(Boolean),
    ),
  );
  const labels = new Map();
  let pending = repoRoots;
  let depth = 1;

  while (pending.length > 0) {
    const groups = new Map();
    for (const repoRoot of pending) {
      const label = localProjectKeyForDepth(repoRoot, depth);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(repoRoot);
    }

    const nextPending = [];
    for (const [label, repoRootsForLabel] of groups) {
      if (repoRootsForLabel.length === 1) {
        labels.set(repoRootsForLabel[0], label);
        continue;
      }

      for (const repoRoot of repoRootsForLabel) {
        if (depth >= splitRepoRootSegments(repoRoot).length) {
          labels.set(repoRoot, label);
        } else {
          nextPending.push(repoRoot);
        }
      }
    }

    pending = nextPending;
    depth += 1;
  }

  return labels;
}

function projectUsageIdentity(entry) {
  const projectRef = typeof entry?.project_ref === "string" ? entry.project_ref.trim() : "";
  if (projectRef) return `ref:${projectRef}`;
  const projectKey = typeof entry?.project_key === "string" ? entry.project_key.trim() : "";
  return `key:${projectKey || "unknown"}`;
}

function mergeProjectUsageEntry(map, entry) {
  const projectKey =
    typeof entry?.project_key === "string" && entry.project_key.trim()
      ? entry.project_key.trim()
      : "unknown";
  const projectRef =
    typeof entry?.project_ref === "string" && entry.project_ref.trim()
      ? entry.project_ref.trim()
      : projectKey;
  const totalTokens = Number(entry?.total_tokens || 0);
  const billableTotalTokens = Number((entry?.billable_total_tokens ?? entry?.total_tokens) || 0);
  const lastSeenAt = normalizeIsoTimestamp(entry?.last_seen_at);
  const identity = projectUsageIdentity({ project_key: projectKey, project_ref: projectRef });
  const existing = map.get(identity);

  if (!existing) {
    map.set(identity, {
      project_key: projectKey,
      project_ref: projectRef,
      total_tokens: totalTokens,
      billable_total_tokens: billableTotalTokens,
      last_seen_at: lastSeenAt,
    });
    return;
  }

  existing.total_tokens += totalTokens;
  existing.billable_total_tokens += billableTotalTokens;
  if (!existing.project_ref && projectRef) existing.project_ref = projectRef;
  if (
    projectRef &&
    existing.project_ref === projectRef &&
    (!existing.project_key || existing.project_key === existing.project_ref)
  ) {
    existing.project_key = projectKey;
  }
  if (lastSeenAt && (!existing.last_seen_at || lastSeenAt > existing.last_seen_at)) {
    existing.last_seen_at = lastSeenAt;
  }
}

function parsePositiveLimit(rawValue) {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.max(1, Math.trunc(value));
}

function compareProjectUsageEntries(a, b, sortMode) {
  if (sortMode === "recent") {
    const byRecent = String(b?.last_seen_at || "").localeCompare(String(a?.last_seen_at || ""));
    if (byRecent !== 0) return byRecent;
  }
  const byTokens =
    Number(b?.billable_total_tokens || 0) - Number(a?.billable_total_tokens || 0);
  if (byTokens !== 0) return byTokens;
  if (sortMode !== "recent") {
    const byRecent = String(b?.last_seen_at || "").localeCompare(String(a?.last_seen_at || ""));
    if (byRecent !== 0) return byRecent;
  }
  return String(a?.project_key || "").localeCompare(String(b?.project_key || ""));
}

function projectUsageDayKey(value, timeZoneContext) {
  const iso = normalizeIsoTimestamp(value);
  if (!iso) return "";
  return formatPartsDayKey(getZonedParts(new Date(iso), timeZoneContext)) || iso.slice(0, 10);
}

function projectUsageRowDayKey(row, timeZoneContext) {
  return projectUsageDayKey(row?.hour_start || projectRowLastSeenAt(row), timeZoneContext);
}

function formatProjectUsageCost(value) {
  return Number.isFinite(value) ? Number(value).toFixed(6) : null;
}

function createProjectUsageEntry({ project_key, project_ref, repo_root }) {
  const cleanProjectKey =
    typeof project_key === "string" && project_key.trim() ? project_key.trim() : "unknown";
  const cleanProjectRef =
    typeof project_ref === "string" && project_ref.trim() ? project_ref.trim() : cleanProjectKey;
  const cleanRepoRoot =
    typeof repo_root === "string" && repo_root.trim() ? repo_root.trim() : null;

  return {
    project_key: cleanProjectKey,
    project_ref: cleanProjectRef,
    repo_root: cleanRepoRoot,
    total_tokens: 0,
    billable_total_tokens: 0,
    last_seen_at: null,
    _cost: createCostAccumulator(),
    _providers: new Map(),
    _branches: new Set(),
  };
}

function ensureProjectUsageEntry(map, descriptor) {
  const identity = projectUsageIdentity(descriptor);
  if (!map.has(identity)) {
    map.set(identity, createProjectUsageEntry(descriptor));
  }
  const entry = map.get(identity);
  if (!entry.repo_root && descriptor.repo_root) entry.repo_root = descriptor.repo_root;
  if (!entry.project_ref && descriptor.project_ref) entry.project_ref = descriptor.project_ref;
  if (
    descriptor.project_key &&
    (!entry.project_key || entry.project_key === entry.project_ref)
  ) {
    entry.project_key = descriptor.project_key;
  }
  return entry;
}

function ensureProviderUsageEntry(projectEntry, providerName) {
  const providerKey = typeof providerName === "string" && providerName.trim()
    ? providerName.trim()
    : "unknown";
  if (!projectEntry._providers.has(providerKey)) {
    projectEntry._providers.set(providerKey, {
      provider: providerKey,
      total_tokens: 0,
      billable_total_tokens: 0,
      session_count: 0,
      _cost: createCostAccumulator(),
      _models: new Map(),
    });
  }
  return projectEntry._providers.get(providerKey);
}

function ensureModelUsageEntry(providerEntry, modelName) {
  const modelKey = typeof modelName === "string" && modelName.trim() ? modelName.trim() : "unknown";
  if (!providerEntry._models.has(modelKey)) {
    providerEntry._models.set(modelKey, {
      model: modelKey,
      total_tokens: 0,
      billable_total_tokens: 0,
      session_count: 0,
      _cost: createCostAccumulator(),
    });
  }
  return providerEntry._models.get(modelKey);
}

function updateProjectUsageLastSeen(entry, lastSeenAt) {
  if (lastSeenAt && (!entry.last_seen_at || lastSeenAt > entry.last_seen_at)) {
    entry.last_seen_at = lastSeenAt;
  }
}

function addProjectUsageGroup(entry, group) {
  const totalTokens = Number(group?.total_tokens || 0);
  const billableTotalTokens = Number((group?.billable_total_tokens ?? group?.total_tokens) || 0);
  const sessionCount = Number(group?.session_count || 0);
  const lastSeenAt = normalizeIsoTimestamp(group?.last_seen_at);
  const providerEntry = ensureProviderUsageEntry(entry, group?.provider);
  const modelEntry = ensureModelUsageEntry(providerEntry, group?.model);
  const costResult = group?.costResult || {
    total_cost_usd: null,
    cost_estimated: true,
    cost_quality: "pricing_missing",
  };

  entry.total_tokens += totalTokens;
  entry.billable_total_tokens += billableTotalTokens;
  updateProjectUsageLastSeen(entry, lastSeenAt);
  addCostToAccumulator(entry._cost, costResult);
  if (Array.isArray(group?.branches)) {
    for (const branchName of group.branches) {
      if (typeof branchName === "string" && branchName.trim()) {
        entry._branches.add(branchName.trim());
      }
    }
  }

  providerEntry.total_tokens += totalTokens;
  providerEntry.billable_total_tokens += billableTotalTokens;
  providerEntry.session_count += sessionCount;
  addCostToAccumulator(providerEntry._cost, costResult);

  modelEntry.total_tokens += totalTokens;
  modelEntry.billable_total_tokens += billableTotalTokens;
  modelEntry.session_count += sessionCount;
  addCostToAccumulator(modelEntry._cost, costResult);
}

function aggregateSessionProjectUsageRows(rows, { from = "", to = "", timeZoneContext = null } = {}) {
  const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
    const day = projectUsageDayKey(row?.activity_at, timeZoneContext);
    if (!day) return false;
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });

  const grouped = new Map();
  for (const row of filteredRows) {
    const repoRoot = typeof row?.repo_root === "string" ? row.repo_root.trim() : "";
    if (!repoRoot) continue;
    const provider = typeof row?.provider === "string" && row.provider.trim() ? row.provider.trim() : "unknown";
    const model = typeof row?.model === "string" && row.model.trim() ? row.model.trim() : "unknown";
    const branch = typeof row?.branch === "string" && row.branch.trim() ? row.branch.trim() : "";
    const key = `${repoRoot}\u0000${provider}\u0000${model}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        repo_root: repoRoot,
        provider,
        model,
        total_tokens: 0,
        stored_total_cost_usd: 0,
        stored_total_tokens: 0,
        unknown_total_tokens: 0,
        non_null_cost_count: 0,
        session_count: 0,
        last_seen_at: null,
        branches: new Set(),
      });
    }
    const group = grouped.get(key);
    const totalTokens = Number(row?.total_tokens || 0);
    const storedCost = row?.total_cost_usd == null ? null : Number(row.total_cost_usd);
    const activityAt = normalizeIsoTimestamp(row?.activity_at);

    group.total_tokens += totalTokens;
    group.session_count += 1;
    if (storedCost != null && Number.isFinite(storedCost)) {
      group.stored_total_cost_usd += storedCost;
      group.stored_total_tokens += totalTokens;
      group.non_null_cost_count += 1;
    } else {
      group.unknown_total_tokens += totalTokens;
    }
    if (activityAt && (!group.last_seen_at || activityAt > group.last_seen_at)) {
      group.last_seen_at = activityAt;
    }
    if (branch) group.branches.add(branch);
  }

  return Array.from(grouped.values()).map((group) => ({
    ...group,
    branches: Array.from(group.branches).sort(),
  }));
}

function finalizeProjectUsageEntries(byProject, sortMode, requestedLimit) {
  return Array.from(byProject.values())
    .sort((a, b) => compareProjectUsageEntries(a, b, sortMode))
    .slice(0, requestedLimit ?? undefined)
    .map((entry) => {
      const providers = Array.from(entry._providers.values())
        .sort((a, b) => {
          const byTokens = b.total_tokens - a.total_tokens;
          return byTokens !== 0 ? byTokens : a.provider.localeCompare(b.provider);
        })
        .map((providerEntry) => {
          const providerCost = finalizeCostAccumulator(providerEntry._cost);
          const models = Array.from(providerEntry._models.values())
            .sort((a, b) => {
              const byTokens = b.total_tokens - a.total_tokens;
              return byTokens !== 0 ? byTokens : a.model.localeCompare(b.model);
            })
            .map((modelEntry) => {
              const modelCost = finalizeCostAccumulator(modelEntry._cost);
              return {
                model: modelEntry.model,
                total_tokens: String(modelEntry.total_tokens),
                billable_total_tokens: String(modelEntry.billable_total_tokens),
                estimated_total_cost_usd: formatProjectUsageCost(modelCost.total_cost_usd),
                cost_estimated: modelCost.cost_estimated,
                cost_quality: modelCost.cost_quality,
                session_count: modelEntry.session_count,
              };
            });

          return {
            provider: providerEntry.provider,
            total_tokens: String(providerEntry.total_tokens),
            billable_total_tokens: String(providerEntry.billable_total_tokens),
            estimated_total_cost_usd: formatProjectUsageCost(providerCost.total_cost_usd),
            cost_estimated: providerCost.cost_estimated,
            cost_quality: providerCost.cost_quality,
            session_count: providerEntry.session_count,
            models,
          };
        });

      const topModels = providers
        .flatMap((providerEntry) =>
          providerEntry.models.map((modelEntry) => ({
            provider: providerEntry.provider,
            model: modelEntry.model,
            total_tokens: modelEntry.total_tokens,
            billable_total_tokens: modelEntry.billable_total_tokens,
            estimated_total_cost_usd: modelEntry.estimated_total_cost_usd,
            cost_estimated: modelEntry.cost_estimated,
            cost_quality: modelEntry.cost_quality,
            session_count: modelEntry.session_count,
          })),
        )
        .sort((a, b) => {
          const byTokens = Number(b.total_tokens) - Number(a.total_tokens);
          if (byTokens !== 0) return byTokens;
          const byProvider = a.provider.localeCompare(b.provider);
          return byProvider !== 0 ? byProvider : a.model.localeCompare(b.model);
        });

      const totalCost = finalizeCostAccumulator(entry._cost);
      const branches = Array.from(entry._branches).sort();
      return {
        project_key: entry.project_key,
        project_ref: entry.project_ref,
        repo_root: entry.repo_root,
        total_tokens: String(entry.total_tokens),
        billable_total_tokens: String(entry.billable_total_tokens),
        estimated_total_cost_usd: formatProjectUsageCost(totalCost.total_cost_usd),
        cost_estimated: totalCost.cost_estimated,
        cost_quality: totalCost.cost_quality,
        last_seen_at: entry.last_seen_at,
        branch_count: branches.length,
        branches,
        providers,
        top_models: topModels,
      };
    });
}

function isLegacyInclusiveCodexRow(row) {
  if (!row || (row.source !== "codex" && row.source !== "every-code")) return false;
  const inputTokens = Number(row.input_tokens || 0);
  const cachedInputTokens = Number(row.cached_input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const totalTokens = Number(row.total_tokens || 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedInputTokens)) return false;
  if (cachedInputTokens <= 0 || inputTokens < cachedInputTokens) return false;
  // Legacy Codex queue rows stored input inclusive of cache reads, while
  // total_tokens remained input + output. Canonical rows keep input as pure
  // non-cached input, so cache-heavy legacy rows can be identified by this
  // exact invariant.
  return totalTokens === inputTokens + outputTokens;
}

function normalizeQueueRow(row) {
  if (!isLegacyInclusiveCodexRow(row)) return row;
  return {
    ...row,
    input_tokens: Number(row.input_tokens || 0) - Number(row.cached_input_tokens || 0),
  };
}

function readQueueData(queuePath) {
  let raw;
  try {
    raw = fs.readFileSync(queuePath, "utf8");
  } catch (e) {
    // ENOENT is legitimate (never synced yet); anything else is a signal we
    // don't want to hide behind an empty array forever — the dashboard would
    // otherwise render "0 tokens" with no clue the queue was unreadable.
    if (e?.code !== "ENOENT") {
      console.error("[LocalAPI] readQueueData: failed to read queue:", e?.message || e);
    }
    return [];
  }
  const lines = raw.split("\n").filter((l) => l.trim());
  // Parse row-by-row so a single corrupted line (partial write, disk-full
  // truncation, …) does not wipe out every other row with it.
  const parsed = [];
  let malformed = 0;
  for (const line of lines) {
    try {
      parsed.push(JSON.parse(line));
    } catch {
      malformed += 1;
    }
  }
  if (malformed > 0) {
    console.error(
      `[LocalAPI] readQueueData: skipped ${malformed}/${lines.length} malformed line(s) in ${queuePath}`,
    );
  }
  // Deduplicate: each sync appends cumulative totals per bucket, so for
  // each (source, model, hour_start) keep only the latest (last) entry.
  const seen = new Map();
  for (const row of parsed) {
    const key = `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
    seen.set(key, normalizeQueueRow(row));
  }
  return Array.from(seen.values());
}

function rowDayKey(row, timeZoneContext) {
  const hs = row.hour_start;
  if (!hs) return "";
  if (
    timeZoneContext &&
    (timeZoneContext.timeZone || Number.isFinite(timeZoneContext.offsetMinutes))
  ) {
    const parts = getZonedParts(new Date(hs), timeZoneContext);
    const key = formatPartsDayKey(parts);
    if (key) return key;
  }
  return hs.slice(0, 10);
}

function aggregateByDay(rows, timeZoneContext = null) {
  const byDay = new Map();
  for (const row of rows) {
    if (!row.hour_start) continue;
    const day = rowDayKey(row, timeZoneContext);
    if (!day) continue;
    if (!byDay.has(day)) {
      byDay.set(day, {
        day,
        total_tokens: 0,
        billable_total_tokens: 0,
        total_cost_usd: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const a = byDay.get(day);
    a.total_tokens += row.total_tokens || 0;
    a.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
    a.total_cost_usd += computeRowCost(row);
    a.input_tokens += row.input_tokens || 0;
    a.output_tokens += row.output_tokens || 0;
    a.cached_input_tokens += row.cached_input_tokens || 0;
    a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    a.conversation_count += row.conversation_count || 0;
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function getRequestedUsageScope(url) {
  if (url.searchParams.get("include_account_level") === "1") return "all";
  return normalizeUsageScope(url.searchParams.get("scope"));
}

function scopedQueueRows(queuePath, url) {
  const scope = getRequestedUsageScope(url);
  const allRows = readQueueData(queuePath);
  return {
    scope,
    allRows,
    rows: filterRowsByUsageScope(allRows, scope),
    excludedSources: listExcludedSources(allRows, scope),
  };
}

function getTimeZoneContext(url) {
  const tz = String(url.searchParams.get("tz") || "").trim();
  const rawOffset = Number(url.searchParams.get("tz_offset_minutes"));
  return {
    timeZone: tz || null,
    offsetMinutes: Number.isFinite(rawOffset) ? Math.trunc(rawOffset) : null,
  };
}

function getZonedParts(date, { timeZone, offsetMinutes } = {}) {
  const dt = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(dt.getTime())) return null;

  if (timeZone && typeof Intl !== "undefined" && Intl.DateTimeFormat) {
    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      });
      const parts = formatter.formatToParts(dt);
      const values = parts.reduce((acc, part) => {
        if (part.type && part.value) acc[part.type] = part.value;
        return acc;
      }, {});
      const year = Number(values.year);
      const month = Number(values.month);
      const day = Number(values.day);
      const hour = Number(values.hour);
      const minute = Number(values.minute);
      const second = Number(values.second);
      if ([year, month, day, hour, minute, second].every(Number.isFinite)) {
        return { year, month, day, hour, minute, second };
      }
    } catch (_e) {
      // fall through
    }
  }

  if (Number.isFinite(offsetMinutes)) {
    const shifted = new Date(dt.getTime() + offsetMinutes * 60 * 1000);
    return {
      year: shifted.getUTCFullYear(),
      month: shifted.getUTCMonth() + 1,
      day: shifted.getUTCDate(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds(),
    };
  }

  return {
    year: dt.getFullYear(),
    month: dt.getMonth() + 1,
    day: dt.getDate(),
    hour: dt.getHours(),
    minute: dt.getMinutes(),
    second: dt.getSeconds(),
  };
}

function formatPartsDayKey(parts) {
  if (!parts) return "";
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function aggregateHourlyByDay(rows, dayKey, timeZoneContext) {
  const byHour = new Map();
  for (const row of rows) {
    if (!row.hour_start) continue;
    const parts = getZonedParts(new Date(row.hour_start), timeZoneContext);
    if (!parts) continue;
    if (formatPartsDayKey(parts) !== dayKey) continue;
    const hourKey = `${dayKey}T${String(parts.hour).padStart(2, "0")}:00:00`;
    if (!byHour.has(hourKey)) {
      byHour.set(hourKey, {
        hour: hourKey,
        total_tokens: 0,
        billable_total_tokens: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: 0,
        conversation_count: 0,
      });
    }
    const bucket = byHour.get(hourKey);
    bucket.total_tokens += row.total_tokens || 0;
    bucket.billable_total_tokens += row.total_tokens || 0;
    bucket.input_tokens += row.input_tokens || 0;
    bucket.output_tokens += row.output_tokens || 0;
    bucket.cached_input_tokens += row.cached_input_tokens || 0;
    bucket.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
    bucket.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    bucket.conversation_count += row.conversation_count || 0;
  }
  return Array.from(byHour.values()).sort((a, b) => a.hour.localeCompare(b.hour));
}

// ---------------------------------------------------------------------------
// Sync helper
// ---------------------------------------------------------------------------

function trimOutput(value, max = 4000) {
  const t = String(value || "");
  return t.length <= max ? t : t.slice(t.length - max);
}



function parseCookieHeader(value) {
  const out = new Map();
  if (typeof value !== "string" || !value.trim()) return out;
  for (const part of value.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const rawValue = part.slice(idx + 1).trim();
    if (key) out.set(key, rawValue);
  }
  return out;
}

function isLoopbackHostname(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function hasAllowedLoopbackOrigin(headers = {}, { requirePresence = false } = {}) {
  const candidates = [headers.origin, headers.referer];
  let sawCandidate = false;
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    sawCandidate = true;
    try {
      const url = new URL(String(raw));
      if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) return false;
    } catch (_e) {
      return false;
    }
  }
  return requirePresence ? sawCandidate : true;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        if (!raw.trim()) return resolve({});
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function runSyncCommand(extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [TRACKER_BIN, "sync"], {
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(tid);
      fn(v);
    };
    const tid = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        reject,
        Object.assign(new Error("Sync timed out"), {
          code: "SYNC_TIMEOUT",
          stdout: trimOutput(stdout),
          stderr: trimOutput(stderr),
        }),
      );
    }, SYNC_TIMEOUT_MS);
    child.stdout?.on("data", (c) => {
      stdout += c;
    });
    child.stderr?.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (e) => {
      finish(reject, Object.assign(e, { stdout: trimOutput(stdout), stderr: trimOutput(stderr) }));
    });
    child.on("close", (code) => {
      const r = { code: code ?? 1, stdout: trimOutput(stdout), stderr: trimOutput(stderr) };
      code === 0
        ? finish(resolve, r)
        : finish(reject, Object.assign(new Error(r.stderr || r.stdout || `exit ${r.code}`), r));
    });
  });
}

// ---------------------------------------------------------------------------
// Project detection helpers
// ---------------------------------------------------------------------------

function parseGitUrl(url) {
  if (!url) return null;
  const ssh = url.match(/git@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };
  const http = url.match(/https?:\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (http) return { owner: http[1], repo: http[2] };
  return null;
}

function extractProjectFromCwd(cwd) {
  const home = os.homedir();
  if (!cwd || cwd === home) return null;
  const rel = cwd.replace(home + "/", "");
  const parts = rel.split("/").filter((p) => p && !p.startsWith(".") && p !== "ext-global");
  return parts.length > 0 ? parts[0] : null;
}

function scanCodexProjects(projectMap) {
  const dir = path.join(os.homedir(), ".codex", "sessions");
  try {
    for (const year of fs.readdirSync(dir)) {
      const yp = path.join(dir, year);
      if (!fs.statSync(yp).isDirectory()) continue;
      for (const month of fs.readdirSync(yp)) {
        const mp = path.join(yp, month);
        if (!fs.statSync(mp).isDirectory()) continue;
        for (const day of fs.readdirSync(mp)) {
          const dp = path.join(mp, day);
          if (!fs.statSync(dp).isDirectory()) continue;
          const files = fs.readdirSync(dp).filter((f) => f.endsWith(".jsonl"));
          for (const file of files.slice(0, 200)) {
            try {
              const first = fs.readFileSync(path.join(dp, file), "utf8").split("\n")[0];
              const d = JSON.parse(first);
              if (d.git?.repository_url) {
                const p = parseGitUrl(d.git.repository_url);
                if (p) {
                  const key = `${p.owner}/${p.repo}`;
                  if (!projectMap.has(key))
                    projectMap.set(key, {
                      project_key: key,
                      project_ref: d.git.repository_url,
                      count: 0,
                    });
                  projectMap.get(key).count++;
                }
              }
            } catch (_e) {}
          }
        }
      }
    }
  } catch (_e) {}
}

function findSubagentsDirs(dir, depth) {
  const out = [];
  if (depth > 3) return out;
  try {
    for (const item of fs.readdirSync(dir)) {
      const fp = path.join(dir, item);
      if (!fs.statSync(fp).isDirectory()) continue;
      if (item === "subagents") out.push(fp);
      else out.push(...findSubagentsDirs(fp, depth + 1));
    }
  } catch (_e) {}
  return out;
}

function scanClaudeProjects(projectMap) {
  const dir = path.join(os.homedir(), ".claude", "projects");
  try {
    for (const subDir of findSubagentsDirs(dir, 0)) {
      const files = fs.readdirSync(subDir).filter((f) => f.endsWith(".jsonl"));
      for (const file of files.slice(0, 100)) {
        try {
          const first = fs.readFileSync(path.join(subDir, file), "utf8").split("\n")[0];
          if (!first) continue;
          const d = JSON.parse(first);
          const name = extractProjectFromCwd(d.cwd);
          if (name) {
            if (!projectMap.has(name))
              projectMap.set(name, {
                project_key: name,
                project_ref: `file://${d.cwd}`,
                count: 0,
              });
            projectMap.get(name).count++;
          }
        } catch (_e) {}
      }
    }
  } catch (_e) {}
}

// ---------------------------------------------------------------------------
// JSON response helper
// ---------------------------------------------------------------------------

function json(res, data, status) {
  res.writeHead(status || 200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function resolveRepoFromQuery(url) {
  const raw = String(url.searchParams.get("repo") || "").trim();
  if (!raw) return null;
  try {
    const resolved = fs.realpathSync(raw);
    const st = fs.statSync(resolved);
    if (!st.isDirectory()) return null;
    return resolved;
  } catch {
    return null;
  }
}

function isValidCheckpointPath(filePath) {
  return (
    typeof filePath === "string" &&
    filePath.length > 0 &&
    !filePath.includes("\0") &&
    !filePath.startsWith("/") &&
    !filePath.split("/").includes("..")
  );
}

// ---------------------------------------------------------------------------
// Main handler factory
// ---------------------------------------------------------------------------

function createLocalApiHandler({ queuePath, syncEnabled = true }) {
  const qp = queuePath || resolveQueuePath();

  const localAuthToken = crypto.randomBytes(24).toString("hex");

  function isAuthorizedLocalMutation(req) {
    const headerToken = req?.headers?.["x-tokentracker-local-auth"];
    const cookieToken = parseCookieHeader(req?.headers?.cookie).get("tokentracker_local_auth");
    const token = typeof headerToken === "string" && headerToken.trim()
      ? headerToken.trim()
      : cookieToken || "";
    if (!token || token !== localAuthToken) return false;
    return hasAllowedLoopbackOrigin(req?.headers || {}, { requirePresence: true });
  }

  function requireVibeDeckMutationAuth(req, res, tokenPath) {
    if (isAuthorizedLocalMutation(req)) return true;
    return requireWriteAuth(req, res, { tokenPath });
  }

  function requireLocalBrowserContext(req, res) {
    if (hasAllowedLoopbackOrigin(req?.headers || {}, { requirePresence: true })) return true;
    json(res, {
      error: "missing_auth",
      message: "Loopback Origin or Referer required",
    }, 401);
    return false;
  }

  return async function handleLocalApi(req, res, url) {
    const p = url.pathname;

    if (p === "/api/local-auth") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!requireLocalBrowserContext(req, res)) return true;
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ token: localAuthToken }));
      return true;
    }

    // --- vibedeck-sessions-live (GET, SSE) ---
    if (p === "/functions/vibedeck-sessions-live") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }

      if (liveSseClientCount >= SSE_MAX_CLIENTS) {
        res.writeHead(503, {
          "Content-Type": "application/json",
          "Retry-After": String(SSE_RETRY_AFTER_SECONDS),
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify({ error: "too_many_clients" }));
        return true;
      }

      const trackerDir = path.dirname(qp);
      const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
      const generatedAt = new Date().toISOString();
      let lastSyncAt = null;
      try {
        lastSyncAt = fs.statSync(qp).mtime.toISOString();
      } catch {}

      let sessions = [];
      try {
        reapOrphanedSessions(dbPath);
        const db = new DatabaseSync(dbPath);
        try {
          sessions = db.prepare("SELECT * FROM vibedeck_sessions WHERE ended_at IS NULL").all()
            .map(enrichLiveSessionCost);
        } finally {
          db.close();
        }
      } catch (e) {
        json(res, { error: "db_unavailable", message: e?.message || String(e) }, 500);
        return true;
      }

      liveSseClientCount += 1;
      ensureSseIdleScanner();

      const client = {
        res,
        queue: [],
        dropped: 0,
        lastWriteAt: Date.now(),
        heartbeatInterval: null,
        onStart: null,
        onUpdate: null,
        onEnd: null,
        closed: false,
        flushScheduled: false,
        close(reason) {
          if (this.closed) return;
          this.closed = true;
          try {
            if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
          } catch {}
          try {
            const bus = getLiveBus();
            if (this.onStart) bus.off("session:start", this.onStart);
            if (this.onUpdate) bus.off("session:update", this.onUpdate);
            if (this.onEnd) bus.off("session:end", this.onEnd);
          } catch {}
          try {
            res.end();
          } catch {}
          try {
            if (typeof req.destroy === "function") req.destroy();
          } catch {}
          liveSseClients.delete(this);
          liveSseClientCount = Math.max(0, liveSseClientCount - 1);
          maybeStopSseIdleScanner();
        },
      };

      liveSseClients.add(client);

      function enqueue(payload) {
        client.queue.push(payload);
        if (client.queue.length > SSE_RING_CAP) {
          client.queue.shift();
          client.dropped += 1;
        }
        scheduleFlush();
      }

      function writeChunk(str) {
        client.lastWriteAt = Date.now();
        return res.write(str);
      }

      function flushQueue() {
        client.flushScheduled = false;
        if (client.closed) return;
        while (client.queue.length > 0) {
          const payload = client.queue[0];
          const ok = writeChunk(`data: ${stringifySsePayload(payload)}\n\n`);
          if (!ok) {
            res.once("drain", flushQueue);
            return;
          }
          client.queue.shift();
        }
      }

      function scheduleFlush() {
        if (client.flushScheduled) return;
        client.flushScheduled = true;
        setImmediate(flushQueue);
      }

      const bus = getLiveBus();
      client.onStart = (event) => {
        enqueue({ type: "session:start", dropped: client.dropped, ...enrichLiveSessionCost(event) });
      };
      client.onUpdate = (event) => {
        const extra =
          event && event.cwd == null && typeof event.observed_at === "string"
            ? { last_observed_at: event.observed_at }
            : {};
        enqueue({
          type: "session:update",
          dropped: client.dropped,
          ...enrichLiveSessionCost(event),
          ...extra,
        });
      };
      client.onEnd = (event) => {
        enqueue({ type: "session:end", dropped: client.dropped, ...enrichLiveSessionCost(event) });
      };

      bus.on("session:start", client.onStart);
      bus.on("session:update", client.onUpdate);
      bus.on("session:end", client.onEnd);

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });

      res.write(": ok\n\n");

      // Snapshot first, after listeners exist but before heartbeats.
      enqueue({ type: "snapshot", sessions, generated_at: generatedAt, last_sync_at: lastSyncAt });

      client.heartbeatInterval = setInterval(() => {
        if (client.closed) return;
        writeChunk(": heartbeat\n\n");
      }, SSE_HEARTBEAT_MS);
      if (typeof client.heartbeatInterval.unref === "function") client.heartbeatInterval.unref();

      const onClose = () => client.close("disconnect");
      res.on("close", onClose);
      res.on("error", onClose);

      return true;
    }

    // --- local-sync (POST) ---
    if (p === "/functions/tokentracker-local-sync") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { ok: false, error: "Method Not Allowed" }, 405);
        return true;
      }
      if (!isAuthorizedLocalMutation(req)) {
        json(res, { ok: false, error: "Unauthorized" }, 401);
        return true;
      }
      try {
        const result = await runSyncCommand({});
        try {
          const { resetUsageLimitsCache } = require("./usage-limits");
          resetUsageLimitsCache();
        } catch (_e) {
          // ignore if module load fails
        }
        json(res, { ok: true, ...result });
      } catch (e) {
        json(res, { ok: false, error: e?.message, code: e?.code ?? null, stdout: e?.stdout || "", stderr: e?.stderr || "" }, 500);
      }
      return true;
    }

    if (p === "/functions/vibedeck-sync-status") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      json(res, readSyncStatus({ queuePath: qp, syncEnabled }));
      return true;
    }

    // --- usage-summary ---
    if (p === "/functions/tokentracker-usage-summary") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const daily = aggregateByDay(rows, timeZoneContext).filter((d) => d.day >= from && d.day <= to);
      const totals = daily.reduce(
        (acc, r) => {
          acc.total_tokens += r.total_tokens;
          acc.billable_total_tokens += r.billable_total_tokens;
          acc.total_cost_usd += r.total_cost_usd || 0;
          acc.input_tokens += r.input_tokens;
          acc.output_tokens += r.output_tokens;
          acc.cached_input_tokens += r.cached_input_tokens;
          acc.cache_creation_input_tokens += r.cache_creation_input_tokens;
          acc.reasoning_output_tokens += r.reasoning_output_tokens;
          acc.conversation_count += r.conversation_count;
          return acc;
        },
        { total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 },
      );
      const totalCost = totals.total_cost_usd;

      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);
      const allDaily = aggregateByDay(rows, timeZoneContext);

      const shiftDay = (dayStr, delta) => {
        const d = new Date(`${dayStr}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + delta);
        return d.toISOString().slice(0, 10);
      };
      const collectDays = (n) => {
        const out = [];
        for (let i = n - 1; i >= 0; i--) {
          const ds = shiftDay(todayStr, -i);
          const dd = allDaily.find((x) => x.day === ds);
          if (dd) out.push(dd);
        }
        return out;
      };
      const sumDays = (days) =>
        days.reduce((a, r) => {
          a.billable_total_tokens += r.billable_total_tokens;
          a.conversation_count += r.conversation_count;
          return a;
        }, { billable_total_tokens: 0, conversation_count: 0 });

      const l7 = collectDays(7);
      const l30 = collectDays(30);
      const l7t = sumDays(l7);
      const l30t = sumDays(l30);
      const l7fromStr = shiftDay(todayStr, -6);
      const l30fromStr = shiftDay(todayStr, -29);

      json(res, {
        from, to, days: daily.length, scope, excluded_sources: excludedSources,
        totals: { ...totals, total_cost_usd: totalCost.toFixed(6) },
        rolling: {
          last_7d: { from: l7fromStr, to: todayStr, active_days: l7.length, totals: l7t },
          last_30d: { from: l30fromStr, to: todayStr, active_days: l30.length, totals: l30t, avg_per_active_day: l30.length > 0 ? Math.round(l30t.billable_total_tokens / l30.length) : 0 },
        },
      });
      return true;
    }

    // --- usage-daily ---
    if (p === "/functions/tokentracker-usage-daily") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const daily = aggregateByDay(rows, timeZoneContext).filter((d) => d.day >= from && d.day <= to);
      json(res, { from, to, scope, excluded_sources: excludedSources, data: daily });
      return true;
    }

    // --- usage-heatmap ---
    if (p === "/functions/tokentracker-usage-heatmap") {
      const weeks = parseInt(url.searchParams.get("weeks") || "52", 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const daily = aggregateByDay(rows, timeZoneContext);
      const todayParts = getZonedParts(new Date(), timeZoneContext);
      const todayStr = formatPartsDayKey(todayParts) || new Date().toISOString().slice(0, 10);
      const end = new Date(`${todayStr}T00:00:00Z`);
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
      const from = start.toISOString().slice(0, 10);
      const to = end.toISOString().slice(0, 10);
      const byDay = new Map(daily.map((d) => [d.day, d]));

      const allValues = daily.map((d) => d.billable_total_tokens).filter((v) => v > 0);
      const maxValue = allValues.length > 0 ? Math.max(...allValues) : 0;
      const calcLevel = (v) => {
        if (v <= 0) return 0;
        if (maxValue === 0) return 1;
        const r = v / maxValue;
        if (r <= 0.25) return 1;
        if (r <= 0.5) return 2;
        if (r <= 0.75) return 3;
        return 4;
      };

      // Build cells and group into weeks (array of 7-cell arrays) for the dashboard
      const cells = [];
      const cursor = new Date(start);
      while (cursor <= end) {
        const day = cursor.toISOString().slice(0, 10);
        const data = byDay.get(day);
        const billable = data?.billable_total_tokens || 0;
        cells.push({ day, total_tokens: data?.total_tokens || 0, billable_total_tokens: billable, level: calcLevel(billable) });
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      const weeksArr = [];
      for (let i = 0; i < cells.length; i += 7) {
        weeksArr.push(cells.slice(i, i + 7));
      }
      json(res, { from, to, scope, excluded_sources: excludedSources, week_starts_on: "sun", active_days: cells.filter((c) => c.billable_total_tokens > 0).length, streak_days: 0, weeks: weeksArr });
      return true;
    }

    // --- usage-model-breakdown ---
    if (p === "/functions/tokentracker-usage-model-breakdown") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows: scopedRows, scope, excludedSources } = scopedQueueRows(qp, url);
      const rows = scopedRows.filter((r) => {
        if (!r.hour_start) return false;
        const d = rowDayKey(r, timeZoneContext);
        return d >= from && d <= to;
      });

      const bySource = new Map();
      for (const row of rows) {
        const src = row.source || "unknown";
        const mdl = row.model || "unknown";
        if (!bySource.has(src))
          bySource.set(src, { source: src, source_scope: getSourceScope(src), totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" }, models: new Map() });
        const sa = bySource.get(src);
        sa.totals.total_tokens += row.total_tokens || 0;
        sa.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        sa.totals.input_tokens += row.input_tokens || 0;
        sa.totals.output_tokens += row.output_tokens || 0;
        sa.totals.cached_input_tokens += row.cached_input_tokens || 0;
        sa.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        sa.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        if (!sa.models.has(mdl))
          sa.models.set(mdl, { model: mdl, model_id: mdl, totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" } });
        const ma = sa.models.get(mdl);
        ma.totals.total_tokens += row.total_tokens || 0;
        ma.totals.billable_total_tokens += row.billable_total_tokens ?? row.total_tokens ?? 0;
        ma.totals.input_tokens += row.input_tokens || 0;
        ma.totals.output_tokens += row.output_tokens || 0;
        ma.totals.cached_input_tokens += row.cached_input_tokens || 0;
        ma.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        ma.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
      }

      const sources = Array.from(bySource.values()).map((s) => {
        s.models = Array.from(s.models.values())
          .map((m) => {
            const cost = computeRowCost({
              ...m.totals,
              model: m.model,
              source: s.source,
            });
            return { ...m, totals: { ...m.totals, total_cost_usd: cost.toFixed(6) } };
          })
          .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
        const sourceCost = s.models.reduce((sum, m) => sum + Number(m.totals.total_cost_usd), 0);
        s.totals.total_cost_usd = sourceCost.toFixed(6);
        return s;
      });

      json(res, {
        from, to, days: 0, scope, excluded_sources: excludedSources, sources,
        pricing: { model: "per-model", pricing_mode: "per_token_type", source: "litellm", effective_from: new Date().toISOString().slice(0, 10) },
      });
      return true;
    }

    // --- vibedeck-checkpoints (GET) ---
    if (p === "/functions/vibedeck-checkpoints") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const repoRoot = resolveRepoFromQuery(url);
      if (!repoRoot) {
        json(res, { error: "invalid_repo" }, 400);
        return true;
      }
      const { listCheckpointsCached } = require("./entire-bridge");
      const result = await listCheckpointsCached(repoRoot);
      json(res, result);
      return true;
    }

    // --- vibedeck-checkpoint (GET) ---
    if (p === "/functions/vibedeck-checkpoint") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const repoRoot = resolveRepoFromQuery(url);
      if (!repoRoot) {
        json(res, { error: "invalid_repo" }, 400);
        return true;
      }
      const checkpointPath = String(url.searchParams.get("path") || "");
      if (!isValidCheckpointPath(checkpointPath)) {
        json(res, { error: "invalid_path" }, 400);
        return true;
      }
      const { readCheckpoint } = require("./entire-bridge");
      try {
        const data = await readCheckpoint(repoRoot, checkpointPath);
        json(res, data);
      } catch (e) {
        json(res, { error: "checkpoint_unavailable", message: e?.message || String(e) }, 500);
      }
      return true;
    }

    if (p === "/functions/vibedeck-confirm-destructive") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }
      const op = body && typeof body.op === "string" ? body.op : null;
      if (!op) {
        json(res, { error: "missing_op" }, 400);
        return true;
      }
      const confirmToken = issueConfirmToken({ op });
      json(res, { token: confirmToken, op, expiresInMs: 30000 });
      return true;
    }

    if (p === "/functions/vibedeck-entire/rewind") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }
      const repo = body && typeof body.repo === "string" ? body.repo : null;
      const checkpointId = body && typeof body.checkpointId === "string" ? body.checkpointId : null;
      const confirmToken = body && typeof body.confirm_token === "string" ? body.confirm_token : null;
      if (!repo || !checkpointId) {
        json(res, { error: "missing_params" }, 400);
        return true;
      }
      if (!confirmToken) {
        json(res, { error: "missing_confirm_token" }, 400);
        return true;
      }
      if (!consumeConfirmToken({ token: confirmToken, op: "rewindCheckpoint" })) {
        json(res, { error: "invalid_confirm_token" }, 400);
        return true;
      }
      let repoRoot = null;
      try {
        repoRoot = fs.realpathSync(repo);
      } catch {
        json(res, { error: "missing_repo" }, 400);
        return true;
      }
      try {
        const result = await require("./entire-bridge").rewindCheckpoint(
          repoRoot,
          checkpointId,
          confirmToken,
        );
        json(res, { ok: result.exitCode === 0, ...result });
      } catch (e) {
        json(res, { error: "rewind_failed", message: e?.message || String(e) }, 500);
      }
      return true;
    }

    if (p === "/functions/vibedeck-entire/clean") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }
      const repo = body && typeof body.repo === "string" ? body.repo : null;
      const confirmToken = body && typeof body.confirm_token === "string" ? body.confirm_token : null;
      if (!repo) {
        json(res, { error: "missing_params" }, 400);
        return true;
      }
      if (!confirmToken) {
        json(res, { error: "missing_confirm_token" }, 400);
        return true;
      }
      if (!consumeConfirmToken({ token: confirmToken, op: "cleanEntire" })) {
        json(res, { error: "invalid_confirm_token" }, 400);
        return true;
      }
      let repoRoot = null;
      try {
        repoRoot = fs.realpathSync(repo);
      } catch {
        json(res, { error: "missing_repo" }, 400);
        return true;
      }
      try {
        const result = await require("./entire-bridge").cleanEntire(
          repoRoot,
          confirmToken,
          { all: body.all === true },
        );
        json(res, { ok: result.exitCode === 0, ...result });
      } catch (e) {
        json(res, { error: "clean_failed", message: e?.message || String(e) }, 500);
      }
      return true;
    }

    // --- vibedeck-entire write stub (POST) ---
    if (p.startsWith("/functions/vibedeck-entire/")) {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const cmd = p.slice("/functions/vibedeck-entire/".length);

      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;

      const allowed = new Set([
        "enable",
        "disable",
        "agent-add",
        "agent-remove",
        "configure",
        "doctor",
        "status",
      ]);
      if (!allowed.has(cmd)) {
        json(res, { error: "unknown_command", cmd }, 400);
        return true;
      }

      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }

      const repoRaw = body?.repo;
      if (typeof repoRaw !== "string" || !repoRaw.trim()) {
        json(res, { error: "missing_repo" }, 400);
        return true;
      }

      let repoRoot = null;
      try {
        repoRoot = fs.realpathSync(repoRaw);
      } catch {
        json(res, { error: "missing_repo" }, 400);
        return true;
      }

      const {
        enableEntire,
        disableEntire,
        entireAgentAdd,
        entireAgentRemove,
        entireConfigure,
        entireDoctor,
        entireStatus,
      } = require("./entire-bridge");

      if (cmd === "enable") {
        const agents = Array.isArray(body?.agents) ? body.agents : [];
        json(res, await enableEntire(repoRoot, agents));
        return true;
      }
      if (cmd === "disable") {
        json(res, await disableEntire(repoRoot));
        return true;
      }
      if (cmd === "agent-add") {
        json(res, await entireAgentAdd(repoRoot, body?.agent));
        return true;
      }
      if (cmd === "agent-remove") {
        json(res, await entireAgentRemove(repoRoot, body?.agent));
        return true;
      }
      if (cmd === "configure") {
        const args = Array.isArray(body?.args) ? body.args : [];
        json(res, await entireConfigure(repoRoot, args));
        return true;
      }
      if (cmd === "doctor") {
        json(res, await entireDoctor(repoRoot));
        return true;
      }
      if (cmd === "status") {
        json(res, await entireStatus(repoRoot));
        return true;
      }
      return true;
    }

    // --- vibedeck-entire-status (GET) ---
    if (p === "/functions/vibedeck-entire-status") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const repoRoot = resolveRepoFromQuery(url);
      if (!repoRoot) {
        json(res, { error: "invalid_repo" }, 400);
        return true;
      }
      const includeCached = url.searchParams.get("cached") === "1";
      let cached = null;
      if (includeCached) {
        try {
          const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
          const { getRepoState } = require("./db/repos");
          const row = getRepoState(dbPath, repoRoot);
          cached = {
            cached_state: row?.entire_state ?? null,
            cached_version: row?.entire_version ?? null,
            cached_checked_at: row?.entire_checked_at ?? null,
          };
        } catch {
          cached = { cached_state: null, cached_version: null, cached_checked_at: null };
        }
      }
      const { getEntireRepoStatus } = require("./entire-bridge");
      const status = await getEntireRepoStatus(repoRoot, { persist: false });
      json(res, cached ? { ...status, ...cached } : status);
      return true;
    }

    // --- vibedeck-branch-usage (GET) ---
    if (p === "/functions/vibedeck-branch-usage") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }

      const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
      const { queryBranchUsage } = require("./branch-usage");
      json(
        res,
        queryBranchUsage(dbPath, {
          from: url.searchParams.get("from"),
          to: url.searchParams.get("to"),
          repo: url.searchParams.get("repo"),
          branch: url.searchParams.get("branch"),
          limit: url.searchParams.get("limit"),
          includeSessions: url.searchParams.get("include_sessions") === "1",
        }),
      );
      return true;
    }

    // --- vibedeck-attribution-stats (GET) ---
    if (p === "/functions/vibedeck-attribution-stats") {
      if (String(req.method || "GET").toUpperCase() !== "GET") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }

      const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
      if (!fs.existsSync(dbPath)) {
        json(res, { high: 0, medium: 0, low: 0, unattributed: 0, total: 0 });
        return true;
      }

      const out = { high: 0, medium: 0, low: 0, unattributed: 0, total: 0 };
      try {
        const db = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const rows = db
            .prepare("SELECT confidence, COUNT(*) as c FROM vibedeck_sessions GROUP BY confidence")
            .all();
          for (const row of rows) {
            const confidence = String(row.confidence || "");
            const c = Number(row.c || 0);
            if (confidence === "high") out.high += c;
            else if (confidence === "medium") out.medium += c;
            else if (confidence === "low") out.low += c;
            else if (confidence === "unattributed") out.unattributed += c;
            out.total += c;
          }
        } finally {
          db.close();
        }
      } catch {
        // Graceful fallback for DB/schema mismatch.
      }

      json(res, out);
      return true;
    }

    // --- project-usage-summary ---
    if (
      p === "/functions/tokentracker-project-usage-summary" ||
      p === "/functions/vibedeck-project-usage-summary"
    ) {
      // Use the per-project bucket log that rollout.js emits — it already
      // carries the actual tokens attributed to each (project_key, source,
      // hour_start). Falling back to "session-file count × total tokens"
      // (the old behavior) produced pure fiction: every short-and-hot
      // project got the same weight as every long-and-cold one.
      const projectQueuePath = path.join(
        path.dirname(qp),
        "project.queue.jsonl",
      );
      const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const sourceFilter = normalizeProjectUsageSourceFilter(url.searchParams.get("source"));
      const projectRows = readProjectQueueData(projectQueuePath).filter((row) => {
        if (!matchesProjectUsageSourceFilter(sourceFilter, row?.source)) return false;
        const day = projectUsageRowDayKey(row, timeZoneContext);
        if (from && (!day || day < from)) return false;
        if (to && (!day || day > to)) return false;
        return true;
      });
      let sessionProjectRows = [];
      try {
        sessionProjectRows = aggregateSessionProjectUsageRows(
          readSessionProjectUsage(dbPath, { sourceFilter }),
          { from, to, timeZoneContext },
        );
      } catch {
        sessionProjectRows = [];
      }
      const localProjectKeys = buildLocalProjectKeyMap(sessionProjectRows);

      const byProject = new Map();
      for (const row of sessionProjectRows) {
        const repoRoot = typeof row?.repo_root === "string" ? row.repo_root.trim() : "";
        if (!repoRoot) continue;
        const entry = ensureProjectUsageEntry(byProject, {
          project_key: localProjectKeys.get(repoRoot) || repoRoot,
          project_ref: repoRoot,
          repo_root: repoRoot,
        });
        const groupCost = createCostAccumulator();
        if (Number(row?.non_null_cost_count || 0) > 0) {
          addCostToAccumulator(groupCost, {
            total_cost_usd: Number(row?.stored_total_cost_usd || 0),
            cost_estimated: false,
            cost_quality: "stored",
          });
        }
        if (Number(row?.unknown_total_tokens || 0) > 0) {
          addCostToAccumulator(groupCost, resolveUsageCost({
            source: row?.provider,
            model: row?.model,
            total_tokens: Number(row?.unknown_total_tokens || 0),
            stored_cost_usd: 0,
            stored_cost_is_authoritative: false,
          }));
        }
        addProjectUsageGroup(entry, {
          provider: row?.provider,
          model: row?.model,
          total_tokens: Number(row?.total_tokens || 0),
          billable_total_tokens: Number(row?.total_tokens || 0),
          session_count: Number(row?.session_count || 0),
          last_seen_at: normalizeIsoTimestamp(row?.last_seen_at),
          branches: row?.branches,
          costResult: finalizeCostAccumulator(groupCost),
        });
      }
      for (const row of projectRows) {
        const projectRef = row.project_ref || row.project_key || "unknown";
        const projectKey = row.project_key || "unknown";
        const entry = ensureProjectUsageEntry(byProject, {
          project_key: projectKey,
          project_ref: projectRef,
          repo_root: path.isAbsolute(String(projectRef || "")) ? String(projectRef).trim() : null,
        });
        const costResult = resolveUsageCost({
          source: row?.source,
          model: row?.model || "unknown",
          project_key: row.project_key || "unknown",
          total_tokens: Number(row.total_tokens || 0),
          stored_cost_usd: row?.total_cost_usd,
          stored_cost_is_authoritative: row?.total_cost_usd != null,
        });
        addProjectUsageGroup(entry, {
          provider: row?.source || "unknown",
          model: row?.model || "unknown",
          total_tokens: Number(row.total_tokens || 0),
          billable_total_tokens: Number((row.billable_total_tokens ?? row.total_tokens) || 0),
          session_count: 0,
          last_seen_at: projectRowLastSeenAt(row),
          costResult,
        });
      }

      const sortMode =
        String(url.searchParams.get("sort") || "tokens").trim().toLowerCase() === "recent"
          ? "recent"
          : "tokens";
      const requestedLimit = parsePositiveLimit(url.searchParams.get("limit"));

      // If no project-attributed rows exist yet (user hasn't synced project
      // attribution, or never used a project-capable CLI), fall back to
      // per-source aggregation over the main queue so the panel isn't
      // totally empty. This path used to also exist for the non-empty case
      // and produce wrong numbers; keep it only as the empty fallback.
      let entries;
      if (byProject.size === 0) {
        const { rows: scopedRows } = scopedQueueRows(qp, url);
        const timeZoneContext = getTimeZoneContext(url);
        const rows = scopedRows.filter((row) => {
          if (!matchesProjectUsageSourceFilter(sourceFilter, row?.source)) return false;
          if (!row.hour_start) return !from && !to;
          const day = rowDayKey(row, timeZoneContext);
          if (from && day < from) return false;
          if (to && day > to) return false;
          return true;
        });
        const bySrc = new Map();
        for (const row of rows) {
          const src = row.source || "unknown";
          if (!bySrc.has(src)) {
            bySrc.set(src, {
              project_key: src,
              project_ref: `https://${src}.ai`,
              total_tokens: 0,
              billable_total_tokens: 0,
              last_seen_at: null,
            });
          }
          const entry = bySrc.get(src);
          entry.total_tokens += row.total_tokens || 0;
          entry.billable_total_tokens += (row.billable_total_tokens ?? row.total_tokens) ?? 0;
          const lastSeenAt = projectRowLastSeenAt(row);
          if (lastSeenAt && (!entry.last_seen_at || lastSeenAt > entry.last_seen_at)) {
            entry.last_seen_at = lastSeenAt;
          }
        }
        entries = Array.from(bySrc.values())
          .sort((a, b) => compareProjectUsageEntries(a, b, sortMode))
          .slice(0, requestedLimit ?? undefined)
          .map((e) => ({
            ...e,
            repo_root: null,
            total_tokens: String(e.total_tokens),
            billable_total_tokens: String(e.billable_total_tokens),
            estimated_total_cost_usd: null,
            cost_estimated: true,
            cost_quality: "pricing_missing",
            providers: [],
            top_models: [],
          }));
      } else {
        entries = finalizeProjectUsageEntries(byProject, sortMode, requestedLimit);
      }

      json(res, { generated_at: new Date().toISOString(), entries });
      return true;
    }

    // --- user-status (stub) ---
    if (p === "/functions/tokentracker-user-status") {
      json(res, {
        user_id: "local-user", email: "local@localhost", name: "Local User", is_public: false,
        created_at: new Date().toISOString(),
        pro: { active: true, sources: ["local"], expires_at: null, partial: false, as_of: new Date().toISOString() },
      });
      return true;
    }

    // --- usage-hourly (stub for day-view) ---
    if (p === "/functions/tokentracker-usage-hourly") {
      const day = url.searchParams.get("day") || new Date().toISOString().slice(0, 10);
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const data = aggregateHourlyByDay(rows, day, timeZoneContext);
      json(res, { day, scope, excluded_sources: excludedSources, data });
      return true;
    }

    // --- usage-monthly (stub for trend view) ---
    if (p === "/functions/tokentracker-usage-monthly") {
      const from = url.searchParams.get("from") || "";
      const to = url.searchParams.get("to") || "";
      const timeZoneContext = getTimeZoneContext(url);
      const { rows, scope, excludedSources } = scopedQueueRows(qp, url);
      const byMonth = new Map();
      for (const row of rows) {
        if (!row.hour_start) continue;
        const day = rowDayKey(row, timeZoneContext);
        if (!day || day < from || day > to) continue;
        const month = day.slice(0, 7);
        if (!byMonth.has(month))
          byMonth.set(month, { month, total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0 });
        const a = byMonth.get(month);
        a.total_tokens += row.total_tokens || 0;
        a.billable_total_tokens += row.total_tokens || 0;
        a.input_tokens += row.input_tokens || 0;
        a.output_tokens += row.output_tokens || 0;
        a.cached_input_tokens += row.cached_input_tokens || 0;
        a.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
        a.reasoning_output_tokens += row.reasoning_output_tokens || 0;
        a.conversation_count += row.conversation_count || 0;
      }
      json(res, { from, to, scope, excluded_sources: excludedSources, data: Array.from(byMonth.values()).sort((a, b) => a.month.localeCompare(b.month)) });
      return true;
    }

    // --- vibedeck skills (read + write auth-gated) ---
    if (p === "/functions/vibedeck-skills") {
      const method = String(req.method || "GET").toUpperCase();
      const skills = require("./skills-manager");
      try {
        if (method === "GET") {
          const mode = url.searchParams.get("mode") || "installed";
          if (mode === "installed") {
            json(res, { targets: skills.targetList(), skills: skills.listInstalledSkills() });
            return true;
          }
          if (mode === "repos") {
            json(res, { repos: skills.listRepos() });
            return true;
          }
          if (mode === "discover") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.discoverSkills({ force }));
            return true;
          }
          if (mode === "search") {
            const data = await skills.searchSkillsSh(
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("limit") || 20),
              Number(url.searchParams.get("offset") || 0),
            );
            json(res, data);
            return true;
          }
          json(res, { error: "Unknown skills mode" }, 400);
          return true;
        }
        json(res, { error: "Method Not Allowed" }, 405);
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unknown skills error" }, 500);
      }
      return true;
    }

    if (p.startsWith("/functions/vibedeck-skills/")) {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }
      const cmd = p.slice("/functions/vibedeck-skills/".length);
      const skills = require("./skills-manager");
      try {
        if (cmd === "install") {
          const targets = Array.isArray(body.targets) ? body.targets : ["claude", "codex"];
          json(res, { ok: true, skill: await skills.installSkill(body.skill, targets) });
          return true;
        }
        if (cmd === "uninstall") {
          json(res, { ok: true, ...(skills.uninstallSkill(body.id) || {}) });
          return true;
        }
        if (cmd === "restore") {
          json(res, { ok: true, skill: skills.restoreSkill(body.id) });
          return true;
        }
        if (cmd === "setTargets") {
          const targets = Array.isArray(body.targets) ? body.targets : [];
          json(res, { ok: true, skill: skills.setSkillTargets(body.id, targets) });
          return true;
        }
        if (cmd === "importLocal") {
          const targets = Array.isArray(body.targets) ? body.targets : [];
          json(res, { ok: true, skill: skills.importLocalSkill(body.directory, targets) });
          return true;
        }
        if (cmd === "deleteLocal") {
          const targets = Array.isArray(body.targets) ? body.targets : [];
          json(res, { ok: true, ...(skills.deleteLocalSkill(body.directory, targets) || {}) });
          return true;
        }
        if (cmd === "addRepo") {
          json(res, { ok: true, repo: skills.addRepo(body.repo) });
          return true;
        }
        if (cmd === "removeRepo") {
          json(res, { ok: true, ...(skills.removeRepo(body.owner, body.name) || {}) });
          return true;
        }
        json(res, { ok: false, error: "Unknown skills action" }, 400);
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unknown skills error" }, 500);
      }
      return true;
    }

    if (p === "/functions/vibedeck-attribute") {
      if (String(req.method || "GET").toUpperCase() !== "POST") {
        json(res, { error: "Method Not Allowed" }, 405);
        return true;
      }
      const tokenPath = path.join(path.dirname(qp), "..", "auth.token");
      if (!requireVibeDeckMutationAuth(req, res, tokenPath)) return true;
      let body = {};
      try {
        body = await readJsonBody(req);
      } catch {
        json(res, { error: "invalid_json" }, 400);
        return true;
      }
      const provider = body && typeof body.provider === "string" ? body.provider : null;
      const session_id = body && typeof body.session_id === "string" ? body.session_id : null;
      const branch = body && (typeof body.branch === "string" || body.branch === null) ? body.branch : undefined;
      if (!provider || !session_id || branch === undefined) {
        json(res, { error: "missing_params" }, 400);
        return true;
      }
      const dbPath = path.join(path.dirname(qp), "vibedeck.sqlite3");
      const overrides = require("./sessions/overrides");
      const writer = require("./sessions/writer");
      const exists = writer.sessionExists ? writer.sessionExists(dbPath, { provider, session_id }) : true;
      if (!exists) {
        json(res, { error: "session_not_found" }, 404);
        return true;
      }
      if (branch === null || branch === "") {
        overrides.clearOverride(dbPath, { provider, session_id });
        json(res, { ok: true, cleared: true });
      } else {
        overrides.upsertOverride(dbPath, { provider, session_id, branch, set_by: "api" });
        json(res, { ok: true, branch });
      }
      return true;
    }

    // --- skills manager ---
    if (p === "/functions/tokentracker-skills") {
      const method = String(req.method || "GET").toUpperCase();
      const skills = require("./skills-manager");
      try {
        if (method === "GET") {
          const mode = url.searchParams.get("mode") || "installed";
          if (mode === "installed") {
            json(res, { targets: skills.targetList(), skills: skills.listInstalledSkills() });
            return true;
          }
          if (mode === "repos") {
            json(res, { repos: skills.listRepos() });
            return true;
          }
          if (mode === "discover") {
            const force = url.searchParams.get("force") === "1";
            json(res, await skills.discoverSkills({ force }));
            return true;
          }
          if (mode === "search") {
            const data = await skills.searchSkillsSh(
              url.searchParams.get("q") || "",
              Number(url.searchParams.get("limit") || 20),
              Number(url.searchParams.get("offset") || 0),
            );
            json(res, data);
            return true;
          }
          json(res, { error: "Unknown skills mode" }, 400);
          return true;
        }

        if (method === "POST") {
          if (!isAuthorizedLocalMutation(req)) {
            json(res, { ok: false, error: "Unauthorized" }, 401);
            return true;
          }
          const body = await readJsonBody(req);
          const action = String(body?.action || "");
          if (action === "install") {
            json(res, { ok: true, skill: await skills.installSkill(body.skill, body.targets || ["claude", "codex"]) });
            return true;
          }
          if (action === "uninstall") {
            json(res, { ok: true, ...(skills.uninstallSkill(body.id) || {}) });
            return true;
          }
          if (action === "restore") {
            json(res, { ok: true, skill: skills.restoreSkill(body.id) });
            return true;
          }
          if (action === "set_targets") {
            json(res, { ok: true, skill: skills.setSkillTargets(body.id, body.targets || []) });
            return true;
          }
          if (action === "import_local") {
            json(res, { ok: true, skill: skills.importLocalSkill(body.directory, body.targets || []) });
            return true;
          }
          if (action === "delete_local") {
            json(res, { ok: true, ...(skills.deleteLocalSkill(body.directory, body.targets || []) || {}) });
            return true;
          }
          if (action === "add_repo") {
            json(res, { ok: true, repo: skills.addRepo(body.repo) });
            return true;
          }
          if (action === "remove_repo") {
            json(res, { ok: true, ...(skills.removeRepo(body.owner, body.name) || {}) });
            return true;
          }
          json(res, { ok: false, error: "Unknown skills action" }, 400);
          return true;
        }

        json(res, { ok: false, error: "Method Not Allowed" }, 405);
      } catch (e) {
        json(res, { ok: false, error: e?.message || "Unknown skills error" }, 500);
      }
      return true;
    }

    // --- usage-limits ---
    if (p === "/functions/tokentracker-usage-limits") {
      const { getUsageLimits, resetUsageLimitsCache } = require("./usage-limits");
      try {
        const forceRefresh = url.searchParams.get("refresh");
        if (forceRefresh === "1" || forceRefresh === "true") {
          resetUsageLimitsCache();
        }
        const data = await getUsageLimits({
          home: os.homedir(),
          env: process.env,
          platform: process.platform,
        });
        json(res, data);
      } catch (e) {
        json(res, { error: e?.message || "Unknown error" }, 500);
      }
      return true;
    }

    return false;
  };
}

module.exports = {
  createLocalApiHandler,
  resolveQueuePath,
  // Exported for cross-consumer tests (pricing + native contract lock).
  MODEL_PRICING,
  getModelPricing,
  computeRowCost,
  ensurePricingLoaded,
  // Test-only: avoid open SSE intervals across node:test runs.
  resetLiveSseStateForTests,
  _debugSse: {
    maxClients: SSE_MAX_CLIENTS,
    ringCap: SSE_RING_CAP,
    heartbeatMs: SSE_HEARTBEAT_MS,
    idleMs: SSE_IDLE_MS,
    idleScanMs: SSE_IDLE_SCAN_MS,
  },
};
