const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const fssync = require("node:fs");
const cp = require("node:child_process");

const { resolveTrackerPaths } = require("../lib/tracker-paths");
const { ensureSchema } = require("../lib/db");
const { ensureToken: ensureAuthToken } = require("../lib/local-auth");
const { createLocalApiHandler, resolveQueuePath } = require("../lib/local-api");
const { ensurePricingLoaded } = require("../lib/pricing");
const { serveStaticFile } = require("../lib/static-server");
const { openInBrowser } = require("../lib/browser-auth");
const { startHeadWatcher, stopHeadWatcher } = require("../lib/sessions/head-watcher");
const { reapOrphanedSessions } = require("../lib/sessions/reaper");

const DEFAULT_PORT = 7690;
const NPM_PACKAGE_NAME = "vibedeck-cli";
const LOCAL_BIND_HOST = "127.0.0.1";

function buildPortInUseHint(port) {
  return `Port ${port} is still in use after cleanup. Try: npx ${NPM_PACKAGE_NAME} serve --port ${port + 1}\n`;
}

function getLocalServerUrl(port) {
  return `http://${LOCAL_BIND_HOST}:${port}`;
}

function createServeLifecycleReporter({ stdout = process.stdout, enabled = true } = {}) {
  let activeProgress = false;
  let lastInlineProgressAt = 0;

  function write(line = "") {
    if (!enabled) return;
    clearProgressLine();
    stdout.write(`${line}\n`);
  }

  function supportsInlineProgress() {
    return Boolean(enabled && stdout && stdout.isTTY);
  }

  function clearProgressLine() {
    if (!activeProgress || !supportsInlineProgress()) return;
    stdout.write("\r\u001b[K");
    activeProgress = false;
  }

  function writeProgress(line, { force = false } = {}) {
    if (!enabled) return;
    if (supportsInlineProgress()) {
      const now = Date.now();
      if (!force && activeProgress && now - lastInlineProgressAt < 120) return;
      lastInlineProgressAt = now;
      stdout.write(`\r\u001b[K${line}`);
      activeProgress = true;
      return;
    }
    stdout.write(`${line}\n`);
  }

  return {
    phase(message) {
      write(message);
    },
    provider(name, message) {
      write(`  ${name}: ${message}`);
    },
    providerProgress(name, payload = {}) {
      writeProgress(`  ${name}: ${formatProviderProgress(payload)}`, {
        force: Number(payload.index) === Number(payload.total),
      });
    },
    providerDone(name, message) {
      write(`  ${name}: ${message}`);
    },
    ready(url) {
      write(`Dashboard ready: ${url}`);
    },
  };
}

function formatLifecycleNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return Math.trunc(n).toLocaleString("en-US");
}

function formatLifecyclePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().split(path.sep).filter(Boolean);
  if (normalized.length === 0) return path.basename(value.trim());
  const tail = normalized.slice(-4).join(path.sep);
  return normalized.length > 4 ? `.../${tail}` : tail;
}

function formatProviderProgress(payload = {}) {
  const unit = payload.unit || "items";
  const index = formatLifecycleNumber(payload.index || payload.recordsProcessed || payload.filesProcessed || 0);
  const total = formatLifecycleNumber(payload.total || 0);
  const parts = [`${index}/${total} ${unit}`];
  const current =
    formatLifecyclePath(payload.filePath)
    || formatLifecyclePath(payload.current)
    || formatLifecyclePath(payload.session_id)
    || payload.current
    || payload.session_id
    || null;
  if (current) parts.push(current);
  const events = Number(payload.eventsAggregated);
  if (Number.isFinite(events)) parts.push(`${formatLifecycleNumber(events)} events`);
  const buckets = Number(payload.bucketsQueued);
  if (Number.isFinite(buckets)) parts.push(`${formatLifecycleNumber(buckets)} buckets`);
  return parts.join(" · ");
}

function createServeShutdownHandler({
  server,
  syncInterval = null,
  reaperInterval = null,
  headWatcher = null,
  sockets = new Set(),
  clearIntervalFn = clearInterval,
  stopHeadWatcherFn = stopHeadWatcher,
  setTimeoutFn = setTimeout,
  exitFn = process.exit,
  stdout = process.stdout,
} = {}) {
  let shuttingDown = false;
  let repeatInterrupts = 0;
  let finished = false;

  function write(line = "") {
    stdout.write(`${line}\n`);
  }

  function forceExit() {
    for (const socket of sockets || []) {
      try {
        socket.destroy?.();
      } catch (_e) {}
    }
    try {
      server?.closeAllConnections?.();
    } catch (_e) {}
    finished = true;
    exitFn(0);
  }

  return function shutdown() {
    if (shuttingDown) {
      repeatInterrupts += 1;
      if (repeatInterrupts === 1) {
        write("Shutdown already in progress. Press Ctrl+C again to force exit.");
        return;
      }
      forceExit();
      return;
    }
    shuttingDown = true;

    write("");
    write("Shutting down VibeDeck...");
    write("Stopping background sync...");
    try {
      if (syncInterval) {
        clearIntervalFn(syncInterval);
        write("  background sync timer cleared");
      } else {
        write("  no background sync timer");
      }
    } catch (_e) {}
    try {
      if (reaperInterval) {
        clearIntervalFn(reaperInterval);
        write("  session reaper timer cleared");
      } else {
        write("  no session reaper timer");
      }
    } catch (_e) {}
    try {
      write("Stopping branch watcher...");
    } catch (_e) {}
    const watcherStopped = Promise.resolve()
      .then(() => stopHeadWatcherFn(headWatcher))
      .then(
        () => write("  branch watcher stopped"),
        (err) => write(`  branch watcher stop warning: ${err?.message || err}`),
      );

    write(`Closing ${(sockets && sockets.size) || 0} open connection(s)...`);
    let socketIndex = 0;
    for (const socket of sockets || []) {
      socketIndex += 1;
      const label = describeSocket(socket);
      const prefix = `  connection ${socketIndex}: ${label}`;
      try {
        if (typeof socket.once === "function") {
          socket.once("close", () => write(`${prefix} closed`));
        }
        write(`${prefix} ending`);
        socket.end?.();
      } catch (_e) {}
    }
    try {
      server?.closeAllConnections?.();
    } catch (_e) {}

    write("Closing dashboard server...");
    async function completeShutdown() {
      if (finished) return;
      finished = true;
      await watcherStopped;
      write("  dashboard server closed");
      write("Shutdown complete.");
      exitFn(0);
    }

    try {
      if (typeof server?.close === "function") {
        server.close(() => {
          completeShutdown().catch(() => {
            write("Shutdown complete.");
            exitFn(0);
          });
        });
      } else {
        completeShutdown().catch(() => {
          write("Shutdown complete.");
          exitFn(0);
        });
      }
    } catch (_e) {
      completeShutdown().catch(() => {
        write("Shutdown complete.");
        exitFn(0);
      });
      return;
    }

    const timer = setTimeoutFn(() => {
      if (finished) return;
      for (const socket of sockets || []) {
        try {
          socket.destroy?.();
        } catch (_e) {}
      }
      finished = true;
      write("Shutdown complete.");
      exitFn(0);
    }, 3000);
    if (timer && typeof timer.unref === "function") timer.unref();
  };
}

function describeSocket(socket) {
  const address = socket?.remoteAddress || "local";
  const port = socket?.remotePort;
  return port ? `${address}:${port}` : String(address);
}

async function cmdServe(argv) {
  const opts = parseArgs(argv);
  const lifecycle = createServeLifecycleReporter();

  // 0. First-time setup: if tracker dir doesn't exist, run init first
  const { trackerDir } = await resolveTrackerPaths();
  if (!fssync.existsSync(path.join(trackerDir, "cursors.json"))) {
    process.stdout.write("First time? Setting up VibeDeck...\n\n");
    try {
      const { cmdInit } = require("./init");
      await cmdInit(["--yes"]);
    } catch (e) {
      process.stdout.write(`Init warning: ${e?.message || e}\n`);
    }
  }

  // 0.1 Ensure Plan 2 DB schema exists before serving local API.
  lifecycle.phase("Preparing local database...");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  ensureSchema(dbPath);

  // 0.2 Ensure local-auth token exists so write endpoints don't 500 on first hit
  // when the user runs `vibedeck serve` before `vibedeck init`.
  ensureAuthToken(path.join(path.dirname(trackerDir), "auth.token"));
  lifecycle.phase("Starting branch watcher...");
  const headWatcher = startHeadWatcher({ dbPath, repos: "active" });
  await headWatcher.ready;

  let reaperInterval = setInterval(() => {
    try {
      reapOrphanedSessions(dbPath);
    } catch (_e) {}
  }, 5 * 60 * 1000);
  if (typeof reaperInterval.unref === "function") reaperInterval.unref();

  try {
    lifecycle.phase("Refreshing local runtime...");
    const { installLocalTrackerApp } = require("./init");
    await installLocalTrackerApp({ appDir: path.join(trackerDir, "app") });
  } catch (e) {
    process.stdout.write(`Runtime refresh warning: ${e?.message || e}\n`);
  }

  // 1. Optional sync
  if (opts.sync) {
    lifecycle.phase("Syncing provider logs...");
    try {
      const { cmdSync } = require("./sync");
      await cmdSync(["--auto"], { lifecycle });
    } catch (e) {
      process.stdout.write(`Sync warning: ${e?.message || e}\n`);
    }
  }

  const { warmSkillMetadataIndex } = require("../lib/skills-warmup");
  await warmSkillMetadataIndex({ lifecycle });

  let syncInterval = null;
  let syncing = false;
  const syncEveryMs = Number(process.env.VIBEDECK_SERVE_SYNC_MS || "1000");
  if (opts.sync && Number.isFinite(syncEveryMs) && syncEveryMs > 0) {
    const { cmdSync } = require("./sync");
    syncInterval = setInterval(async () => {
      if (syncing) return;
      syncing = true;
      try {
        await cmdSync(["--auto"]);
      } catch (_e) {
        // ignore background sync errors; surfaced via doctor/diagnostics
      } finally {
        syncing = false;
      }
    }, Math.trunc(syncEveryMs));
    if (typeof syncInterval.unref === "function") syncInterval.unref();
  }

  // 2. Resolve paths
  const queuePath = resolveQueuePath();
  const dashboardDir = resolveDashboardDir();

  // 2.1 Refresh LiteLLM pricing data in the background. The seed snapshot is
  //     already loaded synchronously at require-time, so cost calculation is
  //     functional right now; ensurePricingLoaded() only upgrades to fresh
  //     disk cache or upstream data. Awaiting it here would block startup
  //     for the full 10s fetch timeout when offline / behind a firewall.
  const { cacheDir } = await resolveTrackerPaths();
  ensurePricingLoaded({ cachePath: path.join(cacheDir, "pricing.json") }).catch(
    (e) => process.stdout.write(`Pricing refresh warning: ${e?.message || e}\n`),
  );

  if (!dashboardDir) {
    process.stderr.write(
      [
        "Dashboard not found.",
        "",
        "If you cloned the repo, run:",
        "  cd dashboard && npm run build",
        "",
        "If you installed via npm, the package may be missing dashboard/dist/.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  // 3. Create handler
  lifecycle.phase("Starting dashboard server...");
  const handleApi = createLocalApiHandler({ queuePath, syncEnabled: opts.sync });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

      // CORS preflight
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        });
        res.end();
        return;
      }

      // API routes
      if (url.pathname.startsWith("/functions/") || url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (handled) return;
      }

      // Static files
      const served = await serveStaticFile(dashboardDir, url.pathname, res);
      if (served) return;

      // SPA fallback
      await serveStaticFile(dashboardDir, "/index.html", res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Internal Server Error");
      }
    }
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  // 4. Listen (kill stale process on same port if needed)
  const port = opts.port;
  await ensurePortFree(port);
  server.listen(port, LOCAL_BIND_HOST, () => {
    const url = getLocalServerUrl(port);
    lifecycle.ready(url);
    process.stdout.write(
      [
        "",
        `  VibeDeck dashboard running at:`,
        "",
        `    ${url}`,
        "",
        `  Data: ${queuePath}`,
        opts.sync ? null : `  Sync: disabled (--no-sync); run without --no-sync for live data refresh.`,
        `  Press Ctrl+C to stop.`,
        "",
      ].filter(Boolean).join("\n"),
    );

    if (opts.open) {
      openInBrowser(url);
    }
  });

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      process.stderr.write(buildPortInUseHint(port));
    } else {
      process.stderr.write(`Server error: ${e.message}\n`);
    }
    process.exitCode = 1;
  });

  // 5. Graceful shutdown
  const shutdown = createServeShutdownHandler({
    server,
    syncInterval,
    reaperInterval,
    headWatcher,
    sockets,
  });
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  // Keep process alive
  await new Promise(() => {});
}

function findPidOnPort(port) {
  try {
    const out = cp.execFileSync("lsof", ["-ti", `tcp:${port}`], { encoding: "utf8", timeout: 5000 });
    const pids = out.trim().split(/\s+/).map(Number).filter((n) => Number.isFinite(n) && n > 0);
    return pids;
  } catch (_e) {
    return [];
  }
}

async function ensurePortFree(port) {
  const pids = findPidOnPort(port);
  if (pids.length === 0) return;

  // Don't kill ourselves
  const self = process.pid;
  const targets = pids.filter((p) => p !== self);
  if (targets.length === 0) return;

  process.stdout.write(`Stopping previous server on port ${port} (pid ${targets.join(", ")})...\n`);
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (_e) {}
  }

  // Wait briefly for port to free up
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 300));
    if (findPidOnPort(port).length === 0) return;
  }

  // Force kill if still alive
  for (const pid of targets) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_e) {}
  }
  await new Promise((r) => setTimeout(r, 500));
}

function resolveDashboardDir() {
  const candidates = [
    path.resolve(__dirname, "../../dashboard/dist"),
    path.resolve(__dirname, "../dashboard/dist"),
  ];
  for (const dir of candidates) {
    if (fssync.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function parseArgs(argv) {
  const opts = { port: DEFAULT_PORT, open: true, sync: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isFinite(n) && n > 0 && n < 65536) opts.port = n;
    } else if (arg === "--no-open") {
      opts.open = false;
    } else if (arg === "--no-sync") {
      opts.sync = false;
    }
  }
  return opts;
}

module.exports = {
  cmdServe,
  createServeShutdownHandler,
  createServeLifecycleReporter,
  buildPortInUseHint,
  NPM_PACKAGE_NAME,
  LOCAL_BIND_HOST,
  getLocalServerUrl,
};
