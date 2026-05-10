const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const fsSync = require("node:fs");
const os = require("node:os");
const pathMod = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { readJsonStrict } = require("./fs");
const { detectEntire } = require("./entire-bridge");
const hookSignature = require("./hook-merger/signature");

async function buildDoctorReport({
  runtime = {},
  diagnostics = null,
  fetch = globalThis.fetch,
  now = () => new Date(),
  paths = {},
  home = os.homedir(),
  dbPath = null,
} = {}) {
  const checks = await runDoctorChecks({ runtime, diagnostics, fetch, paths, home, dbPath });

  const summary = summarizeChecks(checks);

  return {
    version: 1,
    generated_at: now().toISOString(),
    ok: summary.critical === 0,
    summary,
    checks,
    diagnostics,
  };
}

async function runDoctorChecks({
  runtime = {},
  diagnostics = null,
  fetch = globalThis.fetch,
  paths = {},
  home = os.homedir(),
  dbPath = null,
} = {}) {
  const checks = [];

  checks.push(...buildRuntimeChecks(runtime));

  checks.push(await checkEntireCli());

  if (paths.trackerDir) {
    checks.push(await checkTrackerDir(paths.trackerDir));
  }
  if (paths.configPath) {
    checks.push(await checkConfigJson(paths.configPath));
  }
  if (paths.cliPath) {
    checks.push(await checkCliEntrypoint(paths.cliPath));
  }

  checks.push(await checkNetwork({ baseUrl: runtime?.baseUrl || null, fetch }));

  if (diagnostics) {
    checks.push(...buildDiagnosticsChecks(diagnostics));
  }

  checks.push(...(await buildHookIntegrityChecks({ home })));
  checks.push(...(await buildDbHealthChecks({ home, paths, dbPath })));

  return checks;
}

const HOOK_FILES = [
  {
    id: "hook:claude",
    relFile: pathMod.join(".claude", "settings.json"),
    extractor: (j) => j?.hooks?.SessionEnd || [],
  },
  {
    id: "hook:codebuddy",
    relFile: pathMod.join(".codebuddy", "settings.json"),
    extractor: (j) => j?.hooks?.SessionEnd || [],
  },
  {
    id: "hook:cursor",
    relFile: pathMod.join(".cursor", "hooks.json"),
    extractor: (j) => j?.hooks?.sessionEnd || [],
  },
  {
    id: "hook:gemini",
    relFile: pathMod.join(".gemini", "settings.json"),
    extractor: (j) => j?.hooks?.SessionEnd || [],
  },
  {
    id: "hook:factory",
    relFile: pathMod.join(".factory", "settings.json"),
    extractor: (j) => j?.hooks?.SessionEnd || [],
  },
];

function _entryCommandStrings(entry) {
  const out = [];
  if (!entry || typeof entry !== "object") return out;
  if (typeof entry.command === "string") out.push(entry.command);
  if (Array.isArray(entry.hooks)) {
    for (const h of entry.hooks) {
      if (h && typeof h.command === "string") out.push(h.command);
    }
  }
  return out;
}

async function buildHookIntegrityChecks({ home }) {
  const checks = [];
  const expectedCanonical = hookSignature.canonicalCommandPath();

  for (const def of HOOK_FILES) {
    const filePath = pathMod.join(home, def.relFile);
    if (!fsSync.existsSync(filePath)) {
      checks.push({
        id: def.id,
        status: "info",
        detail: `not installed (${filePath} missing)`,
        critical: false,
        meta: { path: filePath },
      });
      continue;
    }

    try {
      const json = JSON.parse(fsSync.readFileSync(filePath, "utf8"));
      const entries = def.extractor(json);
      const cls = hookSignature.classifyEntries(entries, "json");

      if (cls.ours.length === 0) {
        checks.push({
          id: def.id,
          status: "info",
          detail: "VibeDeck hook not installed",
          critical: false,
          meta: { path: filePath },
        });
      } else if (cls.ours.length > 1) {
        checks.push({
          id: def.id,
          status: "warn",
          detail: `Found ${cls.ours.length} VibeDeck entries (expected 1)`,
          critical: false,
          meta: { path: filePath, count: cls.ours.length },
        });
      } else {
        const ourEntry = cls.ours[0];
        const cmds = _entryCommandStrings(ourEntry);
        if (!cmds.some((c) => c.includes(expectedCanonical))) {
          checks.push({
            id: def.id,
            status: "warn",
            detail: `Stale notify path; expected ${expectedCanonical}`,
            critical: false,
            meta: { path: filePath, expected: expectedCanonical },
          });
        } else {
          checks.push({
            id: def.id,
            status: "ok",
            detail: "signature OK",
            critical: false,
            meta: { path: filePath },
          });
        }
      }
    } catch (err) {
      checks.push({
        id: def.id,
        status: "fail",
        detail: `Could not parse ${filePath}: ${err?.message || String(err)}`,
        critical: false,
        meta: { path: filePath },
      });
    }
  }

  return checks;
}

function resolveDoctorDbPath({ home, paths, dbPath }) {
  if (typeof dbPath === "string" && dbPath.trim()) return dbPath;
  if (paths && typeof paths.trackerDir === "string" && paths.trackerDir.trim()) {
    return pathMod.join(paths.trackerDir, "vibedeck.sqlite3");
  }
  return pathMod.join(home, ".vibedeck", "tracker", "vibedeck.sqlite3");
}

async function buildDbHealthChecks({ home, paths, dbPath }) {
  const resolved = resolveDoctorDbPath({ home, paths, dbPath });
  if (!fsSync.existsSync(resolved)) {
    return [
      {
        id: "db.attribution_distribution",
        status: "info",
        detail: `DB not found (${resolved})`,
        critical: false,
        meta: { path: resolved },
      },
      {
        id: "db.integrity",
        status: "info",
        detail: `DB not found (${resolved})`,
        critical: false,
        meta: { path: resolved },
      },
      {
        id: "db.live_sessions_anomaly",
        status: "info",
        detail: `DB not found (${resolved})`,
        critical: false,
        meta: { path: resolved },
      },
    ];
  }

  /** @type {Array<any>} */
  const checks = [];
  const db = new DatabaseSync(resolved, { readOnly: true });
  try {
    // attribution_distribution
    try {
      const rows = db
        .prepare("SELECT confidence, COUNT(*) as c FROM vibedeck_sessions GROUP BY confidence")
        .all();
      const counts = { high: 0, medium: 0, low: 0, unattributed: 0, total: 0 };
      for (const r of rows) {
        const confidence = String(r.confidence || "");
        const c = Number(r.c || 0);
        if (confidence === "high") counts.high += c;
        else if (confidence === "medium") counts.medium += c;
        else if (confidence === "low") counts.low += c;
        else if (confidence === "unattributed") counts.unattributed += c;
        counts.total += c;
      }
      const unattributedPct = counts.total > 0 ? counts.unattributed / counts.total : 0;
      const pct = Math.round(unattributedPct * 1000) / 10;
      checks.push({
        id: "db.attribution_distribution",
        status: unattributedPct >= 0.25 ? "warn" : "ok",
        detail: `unattributed ${pct}% (total ${counts.total})`,
        critical: false,
        meta: { ...counts, unattributed_pct: unattributedPct },
      });
    } catch (err) {
      checks.push({
        id: "db.attribution_distribution",
        status: "fail",
        detail: `failed to read vibedeck_sessions: ${err?.message || String(err)}`,
        critical: false,
        meta: { path: resolved },
      });
    }

    // db_integrity
    try {
      const row = db.prepare("PRAGMA integrity_check").get();
      const value = row ? String(Object.values(row)[0] || "") : "";
      checks.push({
        id: "db.integrity",
        status: value === "ok" ? "ok" : "fail",
        detail: value === "ok" ? "integrity_check ok" : `integrity_check: ${value || "unknown"}`,
        critical: value !== "ok",
        meta: { value },
      });
    } catch (err) {
      checks.push({
        id: "db.integrity",
        status: "fail",
        detail: `integrity_check failed: ${err?.message || String(err)}`,
        critical: true,
        meta: { path: resolved },
      });
    }

    // live_sessions_anomaly
    try {
      const row = db
        .prepare(
          "SELECT COUNT(*) as c FROM vibedeck_sessions WHERE ended_at IS NULL AND started_at < datetime('now', '-24 hours')",
        )
        .get();
      const count = Number(row?.c || 0);
      checks.push({
        id: "db.live_sessions_anomaly",
        status: count > 0 ? "warn" : "ok",
        detail: count > 0 ? `found ${count} stale live sessions (>24h)` : "no stale live sessions",
        critical: false,
        meta: { count },
      });
    } catch (err) {
      checks.push({
        id: "db.live_sessions_anomaly",
        status: "fail",
        detail: `live session query failed: ${err?.message || String(err)}`,
        critical: false,
        meta: { path: resolved },
      });
    }

    return checks;
  } finally {
    db.close();
  }
}

async function checkEntireCli() {
  const ent = await detectEntire({ timeoutMs: 2000 });
  if (ent.present) {
    return {
      id: "entire.cli",
      status: "ok",
      detail: `Entire CLI ${ent.version || "unknown"} on PATH`,
      critical: false,
      meta: { present: true, version: ent.version || null },
    };
  }

  return {
    id: "entire.cli",
    status: "info",
    detail:
      "Entire CLI not found on PATH. Install: brew install --cask entireio/tap/entire (or curl -fsSL https://entire.io/install.sh | bash). Without Entire, session→branch attribution falls back to lower-confidence tiers.",
    critical: false,
    meta: { present: false, version: null },
  };
}

function buildRuntimeChecks(runtime = {}) {
  const checks = [];
  const baseUrl =
    typeof runtime.baseUrl === "string" && runtime.baseUrl.trim() ? runtime.baseUrl.trim() : null;
  const deviceToken =
    typeof runtime.deviceToken === "string" && runtime.deviceToken.trim() ? "set" : "unset";
  const dashboardUrl =
    typeof runtime.dashboardUrl === "string" && runtime.dashboardUrl.trim()
      ? runtime.dashboardUrl.trim()
      : null;
  const httpTimeoutMs = Number.isFinite(Number(runtime.httpTimeoutMs))
    ? Number(runtime.httpTimeoutMs)
    : null;
  const debug = Boolean(runtime.debug);
  const autoRetryNoSpawn = Boolean(runtime.autoRetryNoSpawn);

  checks.push({
    id: "runtime.base_url",
    status: baseUrl ? "ok" : "fail",
    detail: baseUrl ? "base_url set" : "base_url missing",
    critical: false,
    meta: {
      base_url: baseUrl,
      source: runtime?.sources?.baseUrl || null,
    },
  });

  checks.push({
    id: "runtime.device_token",
    status: deviceToken === "set" ? "ok" : "warn",
    detail: deviceToken === "set" ? "device token set" : "device token missing",
    critical: false,
    meta: {
      device_token: deviceToken,
      source: runtime?.sources?.deviceToken || null,
    },
  });

  checks.push({
    id: "runtime.dashboard_url",
    status: "ok",
    detail: dashboardUrl ? "dashboard_url set" : "dashboard_url unset",
    critical: false,
    meta: {
      dashboard_url: dashboardUrl,
      source: runtime?.sources?.dashboardUrl || null,
    },
  });

  checks.push({
    id: "runtime.http_timeout_ms",
    status: "ok",
    detail: "http timeout resolved",
    critical: false,
    meta: {
      http_timeout_ms: httpTimeoutMs,
      source: runtime?.sources?.httpTimeoutMs || null,
    },
  });

  checks.push({
    id: "runtime.debug",
    status: "ok",
    detail: debug ? "debug enabled" : "debug disabled",
    critical: false,
    meta: {
      debug,
      source: runtime?.sources?.debug || null,
    },
  });

  checks.push({
    id: "runtime.auto_retry_no_spawn",
    status: "ok",
    detail: autoRetryNoSpawn ? "auto retry spawn disabled" : "auto retry spawn enabled",
    critical: false,
    meta: {
      auto_retry_no_spawn: autoRetryNoSpawn,
      source: runtime?.sources?.autoRetryNoSpawn || null,
    },
  });

  return checks;
}

async function checkTrackerDir(trackerDir) {
  try {
    const st = await fs.stat(trackerDir);
    if (!st.isDirectory()) {
      return {
        id: "fs.tracker_dir",
        status: "fail",
        detail: "tracker dir is not a directory",
        critical: true,
        meta: { path: trackerDir },
      };
    }
    await fs.access(trackerDir, constants.R_OK);
    return {
      id: "fs.tracker_dir",
      status: "ok",
      detail: "tracker dir readable",
      critical: false,
      meta: { path: trackerDir },
    };
  } catch (err) {
    if (err && (err.code === "ENOENT" || err.code === "ENOTDIR")) {
      return {
        id: "fs.tracker_dir",
        status: "warn",
        detail: "tracker dir missing",
        critical: false,
        meta: { path: trackerDir },
      };
    }
    if (err && (err.code === "EACCES" || err.code === "EPERM")) {
      return {
        id: "fs.tracker_dir",
        status: "fail",
        detail: "tracker dir permission denied",
        critical: true,
        meta: { path: trackerDir, code: err.code },
      };
    }
    return {
      id: "fs.tracker_dir",
      status: "fail",
      detail: "tracker dir error",
      critical: true,
      meta: { path: trackerDir, code: err?.code || "error" },
    };
  }
}

async function checkConfigJson(configPath) {
  const res = await readJsonStrict(configPath);
  if (res.status === "ok") {
    return {
      id: "fs.config_json",
      status: "ok",
      detail: "config.json readable",
      critical: false,
      meta: { path: configPath },
    };
  }
  if (res.status === "missing") {
    return {
      id: "fs.config_json",
      status: "warn",
      detail: "config.json missing",
      critical: false,
      meta: { path: configPath },
    };
  }
  if (res.status === "invalid") {
    return {
      id: "fs.config_json",
      status: "fail",
      detail: "config.json invalid",
      critical: true,
      meta: { path: configPath },
    };
  }
  return {
    id: "fs.config_json",
    status: "fail",
    detail: "config.json read error",
    critical: true,
    meta: { path: configPath },
  };
}

async function checkCliEntrypoint(cliPath) {
  try {
    const st = await fs.stat(cliPath);
    if (!st.isFile()) {
      return {
        id: "cli.entrypoint",
        status: "fail",
        detail: "cli entrypoint is not a file",
        critical: false,
        meta: { path: cliPath },
      };
    }
    await fs.access(cliPath, constants.R_OK);
    if (process.platform !== "win32") {
      await fs.access(cliPath, constants.X_OK);
    }
    return {
      id: "cli.entrypoint",
      status: "ok",
      detail: "cli entrypoint readable",
      critical: false,
      meta: { path: cliPath },
    };
  } catch (err) {
    return {
      id: "cli.entrypoint",
      status: "fail",
      detail: "cli entrypoint not accessible",
      critical: false,
      meta: { path: cliPath, code: err?.code || "error" },
    };
  }
}

async function checkNetwork({ baseUrl, fetch }) {
  if (!baseUrl) {
    return {
      id: "network.base_url",
      status: "warn",
      detail: "base_url missing (skipped)",
      critical: false,
      meta: { base_url: null },
    };
  }

  const start = Date.now();
  try {
    if (typeof fetch !== "function") throw new Error("Missing fetch");
    const res = await fetch(baseUrl, { method: "GET" });
    const latency = Date.now() - start;
    return {
      id: "network.base_url",
      status: "ok",
      detail: `HTTP ${res.status} (reachable)`,
      critical: false,
      meta: {
        status_code: res.status,
        latency_ms: latency,
        base_url: baseUrl,
      },
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      id: "network.base_url",
      status: "fail",
      detail: "Network error",
      critical: false,
      meta: {
        error: err?.message || String(err),
        latency_ms: latency,
        base_url: baseUrl,
      },
    };
  }
}

function buildDiagnosticsChecks(diagnostics) {
  const checks = [];
  const notify = diagnostics?.notify || {};
  const notifyConfigured = Boolean(
    notify.codex_notify_configured ||
    notify.every_code_notify_configured ||
    notify.claude_hook_configured ||
    notify.gemini_hook_configured ||
    notify.opencode_plugin_configured ||
    notify.openclaw_hook_configured,
  );

  checks.push({
    id: "notify.configured",
    status: notifyConfigured ? "ok" : "warn",
    detail: notifyConfigured ? "notify configured" : "notify not configured",
    critical: false,
    meta: { configured: notifyConfigured },
  });

  const uploadError = diagnostics?.upload?.last_error || null;
  checks.push({
    id: "upload.last_error",
    status: uploadError ? "warn" : "ok",
    detail: uploadError ? "last upload error present" : "no upload errors",
    critical: false,
    meta: { last_error: uploadError ? uploadError.message || null : null },
  });

  return checks;
}

function summarizeChecks(checks = []) {
  const summary = { ok: 0, warn: 0, fail: 0, critical: 0 };
  for (const check of checks) {
    if (!check || typeof check.status !== "string") continue;
    if (check.status === "ok") summary.ok += 1;
    else if (check.status === "warn") summary.warn += 1;
    else if (check.status === "fail") summary.fail += 1;
    if (check.status === "fail" && check.critical) summary.critical += 1;
  }
  return summary;
}

module.exports = { buildDoctorReport, runDoctorChecks };
