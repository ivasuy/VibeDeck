const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const fssync = require("node:fs");
const cp = require("node:child_process");
const readline = require("node:readline");
const { DatabaseSync } = require("node:sqlite");

const { ensureDir, readJson, writeJson, openLock } = require("../lib/fs");
const {
  listRolloutFiles,
  listClaudeProjectFiles,
  listGeminiSessionFiles,
  listOpencodeMessageFiles,
  readOpencodeDbMessages,
  resolveKiroDbPath,
  resolveKiroJsonlPath,
  resolveHermesDbPath,
  resolveCopilotOtelPaths,
  parseRolloutIncremental,
  parseClaudeIncremental,
  parseGeminiIncremental,
  parseOpencodeIncremental,
  parseOpencodeDbIncremental,
  parseOpenclawIncremental,
  parseCursorApiIncremental,
  parseKiroIncremental,
  parseHermesIncremental,
  parseCopilotIncremental,
  resolveKimiWireFiles,
  parseKimiIncremental,
  resolveOmpSessionFiles,
  parseOmpIncremental,
  resolvePiSessionFiles,
  parsePiIncremental,
  piAgentDirCollidesWithOmp,
  resolveCraftSessionFiles,
  parseCraftIncremental,
  resolveCodebuddyProjectFiles,
  parseCodebuddyIncremental,
  resolveKiroCliSessionFiles,
  resolveKiroCliDbPath,
  parseKiroCliIncremental,
} = require("../lib/rollout");
const { createProgress, renderBar, formatNumber, formatBytes } = require("../lib/progress");
const {
  isCursorInstalled,
  extractCursorSessionToken,
  fetchCursorUsageCsv,
  parseCursorCsv,
} = require("../lib/cursor-config");
const { purgeProjectUsage } = require("../lib/project-usage-purge");
const { resolveTrackerPaths } = require("../lib/tracker-paths");
const { ensureSchema } = require("../lib/db");
const { reapOrphanedSessions } = require("../lib/sessions/reaper");
const { getIdleTimeoutMin } = require("../lib/sessions/idle-timeout");
const { processSessionEvent, recoverActiveSessionMetadata } = require("../lib/sessions/pipeline");
const { repairMissingProjectAttribution, rebuildAllBranchUsageFacts } = require("../lib/sessions/branch-usage-facts");
const { reconcileCanonicalUsage } = require("../lib/sessions/reconciliation");
const { backfillEntireCheckpointLinks } = require("../lib/sessions/entire-checkpoint-backfill");
const { listCheckpointsCached, readCheckpoint } = require("../lib/entire-bridge");

const CURSOR_UNKNOWN_MIGRATION_KEY = "cursorUnknownPurge_2026_04";
const ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY = "rolloutCumulativeDeltaReparse_2026_05";
const CLAUDE_MEM_OBSERVER_REINCLUDE_KEY = "claudeMemObserverReinclude_2026_05_v3";
const CLAUDE_MEM_OBSERVER_PATH_SEGMENT = "--claude-mem-observer-sessions";
let autoBranchFactsRebuilt = false;

function shouldRunFullBranchFactRebuild({
  auto = false,
  rebuildVibedeckDb = false,
  autoBranchFactsRebuilt = false,
} = {}) {
  if (rebuildVibedeckDb) return true;
  if (!auto) return true;
  return !autoBranchFactsRebuilt;
}

function createSyncLifecycleProgressCallback({
  provider,
  unit = "items",
  lifecycle = null,
  progress = null,
  renderProgress = null,
} = {}) {
  return (payload = {}) => {
    if (progress?.enabled && typeof renderProgress === "function") {
      progress.update(renderProgress(payload));
    }
    lifecycle?.providerProgress?.(provider, { ...payload, unit });
  };
}

function providerDoneSummary({ action = "read", count = 0, unit = "items", events = 0, buckets = 0 } = {}) {
  return `${action} ${formatNumber(count)} ${unit} · ${formatNumber(events)} events · ${formatNumber(buckets)} buckets`;
}

async function cmdSync(argv, { lifecycle = null } = {}) {
  const opts = parseArgs(argv);
  const home = os.homedir();
  const { trackerDir } = await resolveTrackerPaths({ home });
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  ensureSchema(dbPath);

  const sessionEventProcessor = createSessionEventProcessor((e) => processSessionEvent(dbPath, e));
  const onSessionEvent = sessionEventProcessor.onSessionEvent;

  await ensureDir(trackerDir);
  if (opts.fromOpenclaw) {
    await writeOpenclawSignal(trackerDir);
  }

  const lockPath = path.join(trackerDir, "sync.lock");
  const lock = await openLock(lockPath, { quietIfLocked: opts.auto });
  if (!lock) {
    lifecycle?.providerDone?.("Sync", "another sync is already running; using current local data");
    return;
  }

  let progress = null;
  try {
    progress = !opts.auto ? createProgress({ stream: process.stdout }) : null;
    const configPath = path.join(trackerDir, "config.json");
    const cursorsPath = path.join(trackerDir, "cursors.json");
    const queuePath = path.join(trackerDir, "queue.jsonl");
    const queueStatePath = path.join(trackerDir, "queue.state.json");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    const projectQueueStatePath = path.join(trackerDir, "project.queue.state.json");

    const config = await readJson(configPath);
    const cursors = (await readJson(cursorsPath)) || { version: 1, files: {}, updatedAt: null };
    if (opts.rebuildVibedeckDb) {
      if (!opts.auto) process.stderr.write("Rebuild phase: clearing canonical tables\n");
      await resetVibedeckSyncState({
        dbPath,
        queuePath,
        queueStatePath,
        projectQueuePath,
        projectQueueStatePath,
        cursors,
      });
    }

    const codexHome = process.env.CODEX_HOME || path.join(home, ".codex");
    const codeHome = process.env.CODE_HOME || path.join(home, ".code");
    const claudeProjectsDir = path.join(home, ".claude", "projects");
    const geminiHome = process.env.GEMINI_HOME || path.join(home, ".gemini");
    const geminiTmpDir = path.join(geminiHome, "tmp");
    const xdgDataHome = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
    const opencodeHome = process.env.OPENCODE_HOME || path.join(xdgDataHome, "opencode");
    const opencodeStorageDir = path.join(opencodeHome, "storage");

    // OpenClaw hook integration: allow a hook to request incremental parsing for a single session jsonl.
    // We still parse all regular sources so model/source attribution stays complete (e.g. Kimi sessions).
    const openclawSignal = opts.fromOpenclaw
      ? resolveOpenclawSignal({ home, env: process.env })
      : null;

    const sources = [
      { source: "codex", sessionsDir: path.join(codexHome, "sessions") },
      { source: "every-code", sessionsDir: path.join(codeHome, "sessions") },
    ];

    lifecycle?.provider?.("Codex", `discovering ${formatNumber(sources.length)} session director${sources.length === 1 ? "y" : "ies"}`);
    const rolloutFiles = [];
    const seenSessions = new Set();
    for (const entry of sources) {
      if (seenSessions.has(entry.sessionsDir)) continue;
      seenSessions.add(entry.sessionsDir);
      const files = await listRolloutFiles(entry.sessionsDir);
      for (const filePath of files) {
        rolloutFiles.push({ path: filePath, source: entry.source });
      }
    }
    lifecycle?.provider?.("Codex", `found ${formatNumber(rolloutFiles.length)} session file${rolloutFiles.length === 1 ? "" : "s"}`);

    await migrateRolloutCumulativeDeltaBuckets({ cursors, queuePath, rolloutFiles });

    const openclawFiles = openclawSignal?.sessionFile
      ? [{ path: openclawSignal.sessionFile, source: "openclaw" }]
      : [];

    if (opts.rebuildVibedeckDb && !opts.auto) {
      process.stderr.write("Rebuild phase: parsing provider logs\n");
    }

    if (progress?.enabled) {
      progress.start(
        `Parsing ${renderBar(0)} 0/${formatNumber(rolloutFiles.length)} files | buckets 0`,
      );
    }

    const parseResult = await parseRolloutIncremental({
      rolloutFiles,
      cursors,
      queuePath,
      projectQueuePath,
      onSessionEvent,
      onProgress: createSyncLifecycleProgressCallback({
        provider: "Codex",
        unit: "files",
        lifecycle,
        progress,
        renderProgress: (p) => {
          const pct = p.total > 0 ? p.index / p.total : 1;
          return `Parsing ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(
            p.bucketsQueued,
          )}`;
        },
      }),
    });
    lifecycle?.providerDone?.(
      "Codex",
      providerDoneSummary({
        action: "scanned",
        count: parseResult.filesProcessed,
        unit: "files",
        events: parseResult.eventsAggregated,
        buckets: parseResult.bucketsQueued,
      }),
    );

    let openclawResult = { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    if (openclawFiles.length > 0) {
      // Only runs when explicitly triggered by OpenClaw hooks.
      openclawResult = await parseOpenclawIncremental({
        sessionFiles: openclawFiles,
        cursors,
        queuePath,
        projectQueuePath,
        source: "openclaw",
        onSessionEvent,
      });
    }

    const openclawFallback = await applyOpenclawTotalsFallback({
      trackerDir,
      signal: openclawSignal,
      cursors,
      queuePath,
      projectQueuePath,
    });
    openclawResult.filesProcessed += openclawFallback.filesProcessed;
    openclawResult.eventsAggregated += openclawFallback.eventsAggregated;
    openclawResult.bucketsQueued += openclawFallback.bucketsQueued;

    lifecycle?.provider?.("Claude", "discovering project transcripts");
    const claudeFiles = await listClaudeProjectFiles(claudeProjectsDir);
    lifecycle?.provider?.("Claude", `found ${formatNumber(claudeFiles.length)} project file${claudeFiles.length === 1 ? "" : "s"}`);
    await reincludeClaudeMemObserverFiles({ cursors, claudeFiles, queuePath });
    let claudeResult = { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    if (claudeFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(
          `Parsing Claude ${renderBar(0)} 0/${formatNumber(claudeFiles.length)} files | buckets 0`,
        );
      }
      claudeResult = await parseClaudeIncremental({
        projectFiles: claudeFiles,
        cursors,
        queuePath,
        projectQueuePath,
        onSessionEvent,
        onProgress: createSyncLifecycleProgressCallback({
          provider: "Claude",
          unit: "files",
          lifecycle,
          progress,
          renderProgress: (p) => {
            const pct = p.total > 0 ? p.index / p.total : 1;
            return `Parsing Claude ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(
              p.bucketsQueued,
            )}`;
          },
        }),
        source: "claude",
      });
    }
    lifecycle?.providerDone?.(
      "Claude",
      providerDoneSummary({
        action: "scanned",
        count: claudeResult.filesProcessed,
        unit: "files",
        events: claudeResult.eventsAggregated,
        buckets: claudeResult.bucketsQueued,
      }),
    );

    const geminiFiles = await listGeminiSessionFiles(geminiTmpDir);
    let geminiResult = { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    if (geminiFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(
          `Parsing Gemini ${renderBar(0)} 0/${formatNumber(geminiFiles.length)} files | buckets 0`,
        );
      }
      geminiResult = await parseGeminiIncremental({
        sessionFiles: geminiFiles,
        cursors,
        queuePath,
        projectQueuePath,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Gemini ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(
              p.bucketsQueued,
            )}`,
          );
        },
        source: "gemini",
      });
    }

    const opencodeFiles = await listOpencodeMessageFiles(opencodeStorageDir);
    let opencodeResult = { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    if (opencodeFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(
          `Parsing Opencode ${renderBar(0)} 0/${formatNumber(opencodeFiles.length)} files | buckets 0`,
        );
      }
      opencodeResult = await parseOpencodeIncremental({
        messageFiles: opencodeFiles,
        cursors,
        queuePath,
        projectQueuePath,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Opencode ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(
              p.total,
            )} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
        source: "opencode",
      });
    }

    // OpenCode v1.2+ stores messages in SQLite (opencode.db) instead of JSON files.
    const opencodeDbPath = path.join(opencodeHome, "opencode.db");
    let opencodeDbResult = { messagesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const dbMessages = readOpencodeDbMessages(opencodeDbPath);
    if (dbMessages.length > 0) {
      if (progress?.enabled) {
        progress.start(
          `Parsing Opencode DB ${renderBar(0)} 0/${formatNumber(dbMessages.length)} msgs | buckets 0`,
        );
      }
      opencodeDbResult = await parseOpencodeDbIncremental({
        dbMessages,
        cursors,
        queuePath,
        projectQueuePath,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Opencode DB ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(
              p.total,
            )} msgs | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
        source: "opencode",
      });
      opencodeResult.filesProcessed += opencodeDbResult.messagesProcessed;
      opencodeResult.eventsAggregated += opencodeDbResult.eventsAggregated;
      opencodeResult.bucketsQueued += opencodeDbResult.bucketsQueued;
    }

    // ── Cursor (API-based) ──
    // One-time migration: earlier CLI versions mis-parsed the Cursor CSV after
    // Cursor inserted new "Cloud Agent ID"/"Automation ID" columns, writing
    // cursor records under model="unknown". Purge those local buckets, emit
    // zero retractions so the cloud upserts overwrite them to zero, and reset
    // the incremental cursor so the fixed parser re-fetches all affected rows.
    await migrateCursorUnknownBuckets({ cursors, queuePath });

    let cursorResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    lifecycle?.provider?.("Cursor", "checking local usage");
    if (isCursorInstalled({ home })) {
      const cursorAuth = extractCursorSessionToken({ home });
      if (cursorAuth) {
        try {
          if (progress?.enabled) {
            progress.start(`Fetching Cursor usage...`);
          }
          const csvText = await fetchCursorUsageCsv({ cookie: cursorAuth.cookie });
          const records = parseCursorCsv(csvText);
          lifecycle?.provider?.("Cursor", `fetched ${formatNumber(records.length)} usage record${records.length === 1 ? "" : "s"}`);
          if (records.length > 0) {
            if (progress?.enabled) {
              progress.start(
                `Parsing Cursor ${renderBar(0)} 0/${formatNumber(records.length)} records | buckets 0`,
              );
            }
            cursorResult = await parseCursorApiIncremental({
              records,
              cursors,
              queuePath,
              onSessionEvent,
              onProgress: createSyncLifecycleProgressCallback({
                provider: "Cursor",
                unit: "records",
                lifecycle,
                progress,
                renderProgress: (p) => {
                  const pct = p.total > 0 ? p.index / p.total : 1;
                  return `Parsing Cursor ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(
                    p.total,
                  )} records | buckets ${formatNumber(p.bucketsQueued)}`;
                },
              }),
              source: "cursor",
            });
          }
        } catch (err) {
          if (!opts.auto) {
            process.stderr.write(`Cursor sync: ${err.message}\n`);
          }
          lifecycle?.providerDone?.("Cursor", `warning: ${err.message}`);
        }
      } else {
        lifecycle?.providerDone?.("Cursor", "installed but not signed in");
      }
    } else {
      lifecycle?.providerDone?.("Cursor", "not installed");
    }
    if (cursorResult.recordsProcessed > 0 || cursorResult.eventsAggregated > 0 || cursorResult.bucketsQueued > 0) {
      lifecycle?.providerDone?.(
        "Cursor",
        providerDoneSummary({
          action: "read",
          count: cursorResult.recordsProcessed,
          unit: "records",
          events: cursorResult.eventsAggregated,
          buckets: cursorResult.bucketsQueued,
        }),
      );
    }

    // ── Kiro (SQLite-based, with JSONL fallback) ──
    let kiroResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const kiroDbPath = resolveKiroDbPath();
    const kiroJsonlPath = resolveKiroJsonlPath();
    if (fssync.existsSync(kiroDbPath) || fssync.existsSync(kiroJsonlPath)) {
      if (progress?.enabled) {
        progress.start(`Parsing Kiro ${renderBar(0)} | buckets 0`);
      }
      kiroResult = await parseKiroIncremental({
        dbPath: kiroDbPath,
        jsonlPath: kiroJsonlPath,
        cursors,
        queuePath,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Kiro ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} records | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── Hermes Agent (SQLite-based) ──
    let hermesResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const hermesDbPath = resolveHermesDbPath();
    if (fssync.existsSync(hermesDbPath)) {
      if (progress?.enabled) {
        progress.start(`Parsing Hermes ${renderBar(0)} | buckets 0`);
      }
      hermesResult = await parseHermesIncremental({
        dbPath: hermesDbPath,
        cursors,
        queuePath,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Hermes ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} sessions | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── Kiro CLI (reads ~/Library/Application Support/kiro-cli/data.sqlite3
    //    AND live sessions under ~/.kiro/sessions/cli/{uuid}.json) ──
    // Runs IN PARALLEL with the Kiro IDE branch above — NOT instead of it.
    // Both emit source='kiro' so totals merge transparently; cursor state
    // is isolated in cursors.kiroCli. Kiro CLI does not persist explicit
    // token counts (billing is credit-based on Bedrock); we approximate at
    // 4 chars/token from user prompt chars and assistant response chars.
    let kiroCliResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const kiroCliDb = resolveKiroCliDbPath(process.env);
    const kiroCliSessionFiles = resolveKiroCliSessionFiles(process.env);
    if (fssync.existsSync(kiroCliDb) || kiroCliSessionFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing Kiro CLI ${renderBar(0)} | buckets 0`);
      }
      try {
        kiroCliResult = await parseKiroCliIncremental({
          cursors,
          queuePath,
          env: process.env,
          onSessionEvent,
          onProgress: (p) => {
            if (!progress?.enabled) return;
            const pct = p.total > 0 ? p.index / p.total : 1;
            progress.update(
              `Parsing Kiro CLI ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} sessions | buckets ${formatNumber(p.bucketsQueued)}`,
            );
          },
        });
      } catch (err) {
        if (!opts.auto) {
          process.stderr.write(`Kiro CLI sync: ${err.message}\n`);
        }
      }
    }

    // ── Kimi (passive wire.jsonl reader) ──
    let kimiResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const kimiWireFiles = resolveKimiWireFiles(process.env);
    if (kimiWireFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing Kimi Code ${renderBar(0)} | buckets 0`);
      }
      kimiResult = await parseKimiIncremental({
        wireFiles: kimiWireFiles,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Kimi Code ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── CodeBuddy CLI (passive ~/.codebuddy/projects/**/*.jsonl reader) ──
    // Tencent's CodeBuddy CLI is a Claude Code clone; no hook system, so we
    // tail the per-session JSONL conversation logs incrementally on each sync.
    let codebuddyResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const codebuddyFiles = resolveCodebuddyProjectFiles(process.env);
    if (codebuddyFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing CodeBuddy ${renderBar(0)} | buckets 0`);
      }
      codebuddyResult = await parseCodebuddyIncremental({
        projectFiles: codebuddyFiles,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing CodeBuddy ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── oh-my-pi (passive ~/.omp/agent/sessions/**/*.jsonl reader) ──
    let ompResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const ompFiles = resolveOmpSessionFiles(process.env);
    if (ompFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing oh-my-pi ${renderBar(0)} | buckets 0`);
      }
      ompResult = await parseOmpIncremental({
        sessionFiles: ompFiles,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing oh-my-pi ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── pi (@mariozechner/pi-coding-agent) — passive ~/.pi/agent/sessions/**/*.jsonl reader ──
    // Skip pi parse if its agent dir resolves to the same path as omp's. This
    // prevents double-counting when explicit overrides (TOKENTRACKER_OMP_AGENT_DIR /
    // TOKENTRACKER_PI_AGENT_DIR) bypass the install-signal disambiguator.
    let piResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const piFiles = piAgentDirCollidesWithOmp(process.env)
      ? []
      : resolvePiSessionFiles(process.env);
    if (piFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing pi ${renderBar(0)} | buckets 0`);
      }
      piResult = await parsePiIncremental({
        sessionFiles: piFiles,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing pi ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── Craft Agents (passive ~/.craft-agent + workspaces session.jsonl reader) ──
    let craftResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const craftFiles = resolveCraftSessionFiles(process.env);
    if (craftFiles.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing Craft ${renderBar(0)} | buckets 0`);
      }
      craftResult = await parseCraftIncremental({
        sessionFiles: craftFiles,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Craft ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    // ── GitHub Copilot CLI (OTEL JSONL files) ──
    let copilotResult = { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
    const copilotPaths = resolveCopilotOtelPaths(process.env);
    if (copilotPaths.length > 0) {
      if (progress?.enabled) {
        progress.start(`Parsing Copilot ${renderBar(0)} | buckets 0`);
      }
      copilotResult = await parseCopilotIncremental({
        otelPaths: copilotPaths,
        cursors,
        queuePath,
        env: process.env,
        onSessionEvent,
        onProgress: (p) => {
          if (!progress?.enabled) return;
          const pct = p.total > 0 ? p.index / p.total : 1;
          progress.update(
            `Parsing Copilot ${renderBar(pct)} ${formatNumber(p.index)}/${formatNumber(p.total)} files | buckets ${formatNumber(p.bucketsQueued)}`,
          );
        },
      });
    }

    if (cursors?.projectHourly?.projects && projectQueuePath && projectQueueStatePath) {
      for (const [projectKey, meta] of Object.entries(cursors.projectHourly.projects)) {
        if (!meta || typeof meta !== "object") continue;
        if (meta.status !== "blocked" || !meta.purge_pending) continue;
        await purgeProjectUsage({
          projectKey,
          projectQueuePath,
          projectQueueStatePath,
          projectState: cursors.projectHourly,
        });
        meta.purge_pending = false;
        meta.purged_at = new Date().toISOString();
      }
    }

    if (progress?.enabled && sessionEventProcessor.total > 0) {
      progress.start(
        `Attributing sessions ${renderBar(sessionEventProcessor.processed / sessionEventProcessor.total)} ${formatNumber(
          sessionEventProcessor.processed,
        )}/${formatNumber(sessionEventProcessor.total)} events`,
      );
    }
    if (opts.rebuildVibedeckDb && !opts.auto) {
      process.stderr.write("Rebuild phase: draining session events\n");
    }
    const sessionEventDrain = await sessionEventProcessor.drain({
      onProgress: progress?.enabled
        ? ({ processed, total }) => {
            const pct = total > 0 ? processed / total : 1;
            progress.update(
              `Attributing sessions ${renderBar(pct)} ${formatNumber(processed)}/${formatNumber(total)} events`,
            );
          }
        : null,
    });
    let failureDiagnosticsPath = null;
    if (sessionEventDrain.errors.length > 0) {
      failureDiagnosticsPath = await writeSessionFailureDiagnostics(trackerDir, sessionEventDrain.errors);
    }
    if (!opts.auto && sessionEventDrain.errors.length > 0) {
      const examples = sessionEventDrain.errors
        .slice(0, 5)
        .map(
          (row) =>
            `- ${row.provider || "unknown"} ${row.session_id || "unknown"} ${row.kind || "event"} ${
              row.observed_at || "unknown-time"
            }: ${row.message}`,
        )
        .join("\n");
      process.stderr.write(
        `Session live-state sync: ${sessionEventDrain.errors.length} event(s) failed\n${examples}\nDiagnostics: ${
          failureDiagnosticsPath || "not written"
        }\n`,
      );
    }
    if (opts.rebuildVibedeckDb && sessionEventDrain.errors.length > 0) {
      throw new Error(
        `rebuild completed with ${sessionEventDrain.errors.length} failed session event(s); diagnostics: ${
          failureDiagnosticsPath || "not written"
        }`,
      );
    }
    lifecycle?.phase?.("Rebuilding branch/project indexes...");
    lifecycle?.provider?.("Indexes", "recovering active session metadata");
    await recoverActiveSessionMetadata(dbPath);
    lifecycle?.providerDone?.("Indexes", "active session metadata recovered");
    lifecycle?.provider?.("Indexes", "repairing missing project attribution");
    const repairedAttribution = repairMissingProjectAttribution(dbPath, {
      onProgress: createSyncLifecycleProgressCallback({
        provider: "Indexes",
        unit: "sessions",
        lifecycle,
      }),
    });
    lifecycle?.providerDone?.(
      "Indexes",
      `missing project attribution repaired for ${formatNumber(repairedAttribution)} session${repairedAttribution === 1 ? "" : "s"}`,
    );
    const runFullBranchFactRebuild = shouldRunFullBranchFactRebuild({
      auto: opts.auto,
      rebuildVibedeckDb: opts.rebuildVibedeckDb,
      autoBranchFactsRebuilt,
    });
    if (runFullBranchFactRebuild) {
      lifecycle?.provider?.("Indexes", "rebuilding branch usage facts");
      const branchFactsRebuilt = rebuildAllBranchUsageFacts(dbPath, {
        onProgress: createSyncLifecycleProgressCallback({
          provider: "Indexes",
          unit: "sessions",
          lifecycle,
        }),
      });
      lifecycle?.providerDone?.(
        "Indexes",
        `branch usage facts rebuilt across ${formatNumber(branchFactsRebuilt)} branch row${branchFactsRebuilt === 1 ? "" : "s"}`,
      );
      if (opts.auto) autoBranchFactsRebuilt = true;
    } else {
      lifecycle?.providerDone?.("Indexes", "branch usage facts already current");
    }
    lifecycle?.provider?.("Indexes", "backfilling checkpoint links");
    await runEntireCheckpointBackfill({
      dbPath,
      trackerDir,
      cursors,
      rebuild: opts.rebuildVibedeckDb,
      auto: opts.auto,
    });
    lifecycle?.providerDone?.("Indexes", "checkpoint links backfilled");
    if (opts.rebuildVibedeckDb) {
      if (!opts.auto) process.stderr.write("Rebuild phase: closing historical idle sessions\n");
      const closure = reapOrphanedSessions(dbPath, {
        idleTimeoutMin: getIdleTimeoutMin(),
        endReason: "historical_idle_reaped",
      });
      if (!opts.auto && closure.reaped > 0) {
        process.stderr.write(`Historical idle closure: ${closure.reaped} open session(s) closed\n`);
      }
      if (!opts.auto) {
        process.stderr.write("Rebuild phase: validating canonical facts\n");
      }

      const queueRows = await readQueueRowsForAudit(queuePath);
      const report = reconcileCanonicalUsage({ dbPath, queueRows });
      const diagnosticsDir = path.join(trackerDir, "diagnostics");
      await fs.mkdir(diagnosticsDir, { recursive: true });
      const outPath = path.join(diagnosticsDir, "canonical-reconciliation.json");
      await fs.writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
      if (!opts.auto) process.stderr.write(`Canonical reconciliation: ${outPath}\n`);
    }

    cursors.updatedAt = new Date().toISOString();
    await writeJson(cursorsPath, cursors);

    progress?.stop();

    await clearAutoRetry(trackerDir);

    if (!opts.rebuildVibedeckDb) {
      try {
        reapOrphanedSessions(dbPath);
      } catch (_e) {
        // ignore
      }
    }

    if (!opts.auto) {
      const totalParsed =
        parseResult.filesProcessed +
        openclawResult.filesProcessed +
        claudeResult.filesProcessed +
        geminiResult.filesProcessed +
        opencodeResult.filesProcessed +
        cursorResult.recordsProcessed +
        kiroResult.recordsProcessed +
        kiroCliResult.recordsProcessed +
        hermesResult.recordsProcessed +
        kimiResult.recordsProcessed +
        codebuddyResult.recordsProcessed +
        ompResult.recordsProcessed +
        piResult.recordsProcessed +
        craftResult.recordsProcessed +
        copilotResult.recordsProcessed;
      const totalBuckets =
        parseResult.bucketsQueued +
        openclawResult.bucketsQueued +
        claudeResult.bucketsQueued +
        geminiResult.bucketsQueued +
        opencodeResult.bucketsQueued +
        cursorResult.bucketsQueued +
        kiroResult.bucketsQueued +
        kiroCliResult.bucketsQueued +
        hermesResult.bucketsQueued +
        kimiResult.bucketsQueued +
        codebuddyResult.bucketsQueued +
        ompResult.bucketsQueued +
        piResult.bucketsQueued +
        craftResult.bucketsQueued +
        copilotResult.bucketsQueued;
      process.stdout.write(
        [
          "Sync finished:",
          `- Parsed files: ${totalParsed}`,
          `- New 30-min buckets queued: ${totalBuckets}`,
          "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    }
  } finally {
    progress?.stop();
    await lock.release();
    await fs.unlink(lockPath).catch(() => {});
  }
}

function parseArgs(argv) {
  const out = {
    auto: false,
    fromNotify: false,
    fromRetry: false,
    fromOpenclaw: false,
    drain: false,
    rebuildVibedeckDb: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--auto") out.auto = true;
    else if (a === "--from-notify") out.fromNotify = true;
    else if (a === "--from-retry") out.fromRetry = true;
    else if (a === "--from-openclaw") out.fromOpenclaw = true;
    else if (a === "--drain") out.drain = true;
    else if (a === "--rebuild-vibedeck-db") out.rebuildVibedeckDb = true;
    else throw new Error(`Unknown option: ${a}`);
  }
  return out;
}

function clearCanonicalVibedeckTables(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('BEGIN');
    try {
      db.exec(`
        DELETE FROM vibedeck_branch_usage_facts;
        DELETE FROM vibedeck_session_branch_windows;
        DELETE FROM vibedeck_session_buckets;
        DELETE FROM vibedeck_session_events;
        DELETE FROM vibedeck_sessions;
        DELETE FROM vibedeck_entire_checkpoint_matches;
        DELETE FROM vibedeck_session_entire_links;
      `);
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw err;
    }
  } finally {
    db.close();
  }
}

function resetSyncCursors(cursors) {
  if (!cursors || typeof cursors !== 'object') return;
  const preservedMigrations =
    cursors.migrations && typeof cursors.migrations === 'object' ? { ...cursors.migrations } : {};
  for (const key of Object.keys(cursors)) {
    delete cursors[key];
  }
  Object.assign(cursors, {
    version: 1,
    files: {},
    updatedAt: null,
    migrations: preservedMigrations,
  });
}

async function resetVibedeckSyncState({
  dbPath,
  queuePath,
  queueStatePath,
  projectQueuePath,
  projectQueueStatePath,
  cursors,
} = {}) {
  clearCanonicalVibedeckTables(dbPath);
  resetSyncCursors(cursors);
  await Promise.all([
    fs.writeFile(queuePath, '', 'utf8'),
    fs.writeFile(projectQueuePath, '', 'utf8'),
    fs.writeFile(queueStatePath, JSON.stringify({ offset: 0 }), 'utf8'),
    fs.writeFile(projectQueueStatePath, JSON.stringify({ offset: 0 }), 'utf8'),
  ]);
}

function createSessionEventProcessor(processor) {
  if (typeof processor !== "function") {
    throw new TypeError("processor must be a function");
  }

  const errors = [];
  let queue = Promise.resolve();
  let total = 0;
  let processed = 0;
  let progressCallback = null;

  const onSessionEvent = (event) => {
    total += 1;
    queue = queue
      .then(() => processor(event))
      .catch((err) => {
        errors.push(eventFailureRecord(event, err));
      })
      .finally(() => {
        processed += 1;
        if (typeof progressCallback === "function") {
          progressCallback({ processed, total, pending: Math.max(0, total - processed) });
        }
      });
    return queue;
  };

  const drain = async ({ onProgress } = {}) => {
    progressCallback = typeof onProgress === "function" ? onProgress : null;
    if (progressCallback) {
      progressCallback({ processed, total, pending: Math.max(0, total - processed) });
    }
    await queue;
    if (progressCallback) {
      progressCallback({ processed, total, pending: 0 });
    }
    progressCallback = null;
    return { errors, processed, total };
  };

  return {
    onSessionEvent,
    drain,
    errors,
    get processed() {
      return processed;
    },
    get total() {
      return total;
    },
  };
}

function eventFailureRecord(event, err) {
  return {
    provider: event?.provider || null,
    session_id: event?.session_id || null,
    kind: event?.kind || null,
    observed_at: event?.observed_at || null,
    message: err?.message || String(err),
    stack: err?.stack || null,
  };
}

async function writeSessionFailureDiagnostics(trackerDir, failures) {
  if (!Array.isArray(failures) || failures.length === 0) return null;
  const diagnosticsDir = path.join(trackerDir, "diagnostics");
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(diagnosticsDir, `session-event-failures-${stamp}.jsonl`);
  const body = failures.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await fs.writeFile(outPath, body, "utf8");
  return outPath;
}

async function readQueueRowsForAudit(queuePath) {
  let raw = '';
  try {
    raw = await fs.readFile(queuePath, "utf8");
  } catch {
    return [];
  }

  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") out.push(parsed);
    } catch {
      // ignore malformed queue rows in diagnostics-only reconciliation path
    }
  }
  return out;
}

function normalizeRepoRoot(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecentIso(iso, nowMs, recentWindowMs) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= nowMs - recentWindowMs;
}

function isEntireStateActive(value) {
  const state = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!state) return false;
  return !["not_enabled", "not_installed", "disabled"].includes(state);
}

function collectRebuildEntireBackfillRepos(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const roots = new Set();
    const repoRows = db.prepare("SELECT repo_root FROM vibedeck_repos").all();
    for (const row of repoRows) {
      const root = normalizeRepoRoot(row?.repo_root);
      if (root) roots.add(root);
    }
    const sessionRows = db.prepare(`
      SELECT DISTINCT repo_root
      FROM vibedeck_sessions
      WHERE repo_root IS NOT NULL AND TRIM(repo_root) <> ''
    `).all();
    for (const row of sessionRows) {
      const root = normalizeRepoRoot(row?.repo_root);
      if (root) roots.add(root);
    }
    return Array.from(roots).sort();
  } finally {
    db.close();
  }
}

function collectIncrementalEntireBackfillRepos(dbPath, { now = () => new Date() } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const nowMs = now().getTime();
    const recentWindowMs = 24 * 60 * 60 * 1000;
    const repoMap = new Map();

    const sessionRows = db.prepare(`
      SELECT
        repo_root,
        MAX(COALESCE(last_observed_at, updated_at)) AS last_activity_at,
        SUM(CASE WHEN ended_at IS NULL THEN 1 ELSE 0 END) AS open_sessions
      FROM vibedeck_sessions
      WHERE repo_root IS NOT NULL AND TRIM(repo_root) <> ''
      GROUP BY repo_root
    `).all();
    for (const row of sessionRows) {
      const root = normalizeRepoRoot(row?.repo_root);
      if (!root) continue;
      const openSessions = Number(row?.open_sessions || 0);
      const recent = isRecentIso(row?.last_activity_at || null, nowMs, recentWindowMs);
      repoMap.set(root, {
        repo_root: root,
        active_recent: openSessions > 0 || recent,
        entire_active: false,
      });
    }

    const repoRows = db.prepare("SELECT repo_root, entire_state FROM vibedeck_repos").all();
    for (const row of repoRows) {
      const root = normalizeRepoRoot(row?.repo_root);
      if (!root) continue;
      const existing = repoMap.get(root) || { repo_root: root, active_recent: false, entire_active: false };
      existing.entire_active = isEntireStateActive(row?.entire_state);
      repoMap.set(root, existing);
    }

    return Array.from(repoMap.values()).sort((a, b) => a.repo_root.localeCompare(b.repo_root));
  } finally {
    db.close();
  }
}

async function writeEntireBackfillDiagnostics(trackerDir, payload) {
  const diagnosticsDir = path.join(trackerDir, "diagnostics");
  await fs.mkdir(diagnosticsDir, { recursive: true });
  const outPath = path.join(diagnosticsDir, "entire-checkpoint-backfill.json");
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  return outPath;
}

async function runEntireCheckpointBackfill({
  dbPath,
  trackerDir,
  cursors,
  rebuild = false,
  auto = false,
} = {}) {
  const backfillCursor = (cursors.entireCheckpointBackfill ||= { tips: {}, updatedAt: null });
  if (!backfillCursor.tips || typeof backfillCursor.tips !== "object") backfillCursor.tips = {};

  const candidates = rebuild
    ? collectRebuildEntireBackfillRepos(dbPath).map((repoRoot) => ({
        repo_root: repoRoot,
        active_recent: true,
        entire_active: true,
      }))
    : collectIncrementalEntireBackfillRepos(dbPath);

  const repos = [];
  const totals = { scanned: 0, linked: 0, ambiguous: 0, unmatched: 0 };

  for (const candidate of candidates) {
    const repoRoot = candidate.repo_root;
    const prevTip = backfillCursor.tips[repoRoot] || null;
    let listed = null;
    let tip = null;
    try {
      listed = await listCheckpointsCached(repoRoot);
      tip = listed && typeof listed.tip === "string" && listed.tip.trim() ? listed.tip.trim() : null;
    } catch (err) {
      repos.push({
        repo_root: repoRoot,
        checkpoint_tip: null,
        scanned: 0,
        linked: 0,
        ambiguous: 0,
        unmatched: 0,
        error: err?.message || String(err),
      });
      continue;
    }

    const tipChanged = tip && tip !== prevTip;
    const shouldRun = rebuild || candidate.active_recent || tipChanged || (candidate.entire_active && tipChanged);
    if (!shouldRun) continue;

    try {
      const result = await backfillEntireCheckpointLinks({
        dbPath,
        repoRoot,
        checkpointTip: tip,
        listCheckpointsCached: async () => listed || listCheckpointsCached(repoRoot),
        readCheckpoint: async (filePath) => readCheckpoint(repoRoot, filePath),
      });
      repos.push({
        repo_root: repoRoot,
        checkpoint_tip: tip,
        scanned: Number(result?.scanned || 0),
        linked: Number(result?.linked || 0),
        ambiguous: Number(result?.ambiguous || 0),
        unmatched: Number(result?.unmatched || 0),
      });
      totals.scanned += Number(result?.scanned || 0);
      totals.linked += Number(result?.linked || 0);
      totals.ambiguous += Number(result?.ambiguous || 0);
      totals.unmatched += Number(result?.unmatched || 0);
      if (tip) backfillCursor.tips[repoRoot] = tip;
    } catch (err) {
      repos.push({
        repo_root: repoRoot,
        checkpoint_tip: tip,
        scanned: 0,
        linked: 0,
        ambiguous: 0,
        unmatched: 0,
        error: err?.message || String(err),
      });
    }
  }

  backfillCursor.updatedAt = new Date().toISOString();
  const diagnosticsPayload = {
    generated_at: new Date().toISOString(),
    repos,
    totals,
  };
  const diagnosticsPath = await writeEntireBackfillDiagnostics(trackerDir, diagnosticsPayload);
  if (!auto) {
    process.stderr.write(
      `Entire checkpoint backfill: ${totals.scanned} scanned, ${totals.linked} linked, ${totals.ambiguous} ambiguous, ${totals.unmatched} unmatched\n`,
    );
    process.stderr.write(`Diagnostics: ${diagnosticsPath}\n`);
  }
  return { diagnosticsPath, repos, totals };
}

module.exports = {
  cmdSync,
  createSyncLifecycleProgressCallback,
  createSessionEventProcessor,
  shouldRunFullBranchFactRebuild,
  migrateCursorUnknownBuckets,
  migrateRolloutCumulativeDeltaBuckets,
  reincludeClaudeMemObserverFiles,
  resetVibedeckSyncState,
  CURSOR_UNKNOWN_MIGRATION_KEY,
  ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY,
  CLAUDE_MEM_OBSERVER_REINCLUDE_KEY,
};

function normalizeString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveOpenclawSignal({ home, env } = {}) {
  if (!env) return null;

  const agentId = normalizeString(env.TOKENTRACKER_OPENCLAW_AGENT_ID);
  const sessionId = normalizeString(env.TOKENTRACKER_OPENCLAW_PREV_SESSION_ID);
  if (!agentId || !sessionId) return null;

  const openclawHome =
    normalizeString(env.TOKENTRACKER_OPENCLAW_HOME) || path.join(home || os.homedir(), ".openclaw");
  const sessionFile = path.join(openclawHome, "agents", agentId, "sessions", `${sessionId}.jsonl`);

  const prevTotals = {
    totalTokens: normalizeNonNegativeInt(env.TOKENTRACKER_OPENCLAW_PREV_TOTAL_TOKENS),
    inputTokens: normalizeNonNegativeInt(env.TOKENTRACKER_OPENCLAW_PREV_INPUT_TOKENS),
    outputTokens: normalizeNonNegativeInt(env.TOKENTRACKER_OPENCLAW_PREV_OUTPUT_TOKENS),
    model: normalizeString(env.TOKENTRACKER_OPENCLAW_PREV_MODEL),
    updatedAt: normalizeIsoOrEpoch(env.TOKENTRACKER_OPENCLAW_PREV_UPDATED_AT),
  };

  return {
    agentId,
    sessionId,
    sessionKey: normalizeString(env.TOKENTRACKER_OPENCLAW_SESSION_KEY),
    openclawHome,
    sessionFile,
    prevTotals,
  };
}

async function applyOpenclawTotalsFallback({
  trackerDir,
  signal,
  cursors,
  queuePath,
  projectQueuePath,
}) {
  const totalTokens = Number(signal?.prevTotals?.totalTokens || 0);
  if (!trackerDir || !signal || totalTokens <= 0) {
    return { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
  }

  const sessionKey = `${signal.agentId}:${signal.sessionId}`;
  const statePath = path.join(trackerDir, "openclaw.fallback.state.json");
  const fallbackFilePath = path.join(trackerDir, "openclaw.fallback.jsonl");
  const state = (await readJson(statePath)) || { version: 1, sessions: {} };
  const sessions = state.sessions && typeof state.sessions === "object" ? state.sessions : {};
  const prev =
    sessions[sessionKey] && typeof sessions[sessionKey] === "object" ? sessions[sessionKey] : null;

  const current = {
    totalTokens: normalizeNonNegativeInt(signal?.prevTotals?.totalTokens) || 0,
    inputTokens: normalizeNonNegativeInt(signal?.prevTotals?.inputTokens) || 0,
    outputTokens: normalizeNonNegativeInt(signal?.prevTotals?.outputTokens) || 0,
    model: normalizeString(signal?.prevTotals?.model) || "unknown",
    updatedAt: normalizeIsoOrEpoch(signal?.prevTotals?.updatedAt) || new Date().toISOString(),
    seenAt: new Date().toISOString(),
  };

  let deltaTotal = current.totalTokens;
  let deltaInput = current.inputTokens;
  let deltaOutput = current.outputTokens;
  if (prev) {
    deltaTotal = Math.max(
      0,
      current.totalTokens - (normalizeNonNegativeInt(prev.totalTokens) || 0),
    );
    deltaInput = Math.max(
      0,
      current.inputTokens - (normalizeNonNegativeInt(prev.inputTokens) || 0),
    );
    deltaOutput = Math.max(
      0,
      current.outputTokens - (normalizeNonNegativeInt(prev.outputTokens) || 0),
    );
  }

  if (deltaTotal > 0 && deltaInput + deltaOutput === 0) {
    deltaInput = deltaTotal;
  }

  sessions[sessionKey] = current;
  state.version = 1;
  state.sessions = sessions;

  if (deltaTotal <= 0) {
    await writeJson(statePath, state);
    return { filesProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 };
  }

  await ensureDir(path.dirname(fallbackFilePath));
  const syntheticMessage = {
    type: "message",
    timestamp: current.updatedAt,
    message: {
      role: "assistant",
      model: current.model,
      usage: {
        input: deltaInput,
        output: deltaOutput,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: deltaTotal,
      },
    },
  };
  await fs.appendFile(fallbackFilePath, `${JSON.stringify(syntheticMessage)}\n`, "utf8");
  await writeJson(statePath, state);

  return parseOpenclawIncremental({
    sessionFiles: [{ path: fallbackFilePath, source: "openclaw" }],
    cursors,
    queuePath,
    projectQueuePath,
    source: "openclaw",
  });
}

function normalizeNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function normalizeIsoOrEpoch(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0 && !Number.isNaN(Date.parse(trimmed))) return trimmed;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      const ms = numeric < 1e12 ? Math.floor(numeric * 1000) : Math.floor(numeric);
      const iso = new Date(ms).toISOString();
      if (!Number.isNaN(Date.parse(iso))) return iso;
    }
  }

  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const ms = n < 1e12 ? Math.floor(n * 1000) : Math.floor(n);
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

async function safeStatSize(p) {
  try {
    const st = await fs.stat(p);
    return st && st.isFile() ? st.size : 0;
  } catch (_e) {
    return 0;
  }
}

function deriveAutoSkipReason({ decision, state }) {
  if (!decision || decision.reason !== "throttled") return decision?.reason || "unknown";
  const backoffUntilMs = Number(state?.backoffUntilMs || 0);
  const nextAllowedAtMs = Number(state?.nextAllowedAtMs || 0);
  if (backoffUntilMs > 0 && backoffUntilMs >= nextAllowedAtMs) return "backoff";
  return "throttled";
}

async function scheduleAutoRetry({
  trackerDir,
  retryAtMs,
  reason,
  pendingBytes,
  source,
  autoRetryNoSpawn,
}) {
  const retryMs = coerceRetryMs(retryAtMs);
  if (!retryMs) return { scheduled: false, retryAtMs: 0 };

  const retryPath = path.join(trackerDir, AUTO_RETRY_FILENAME);
  const nowMs = Date.now();
  const existing = await readJson(retryPath);
  const existingMs = coerceRetryMs(existing?.retryAtMs);
  if (existingMs && existingMs >= retryMs - 1000) {
    return { scheduled: false, retryAtMs: existingMs };
  }

  const payload = {
    version: 1,
    retryAtMs: retryMs,
    retryAt: new Date(retryMs).toISOString(),
    reason: typeof reason === "string" && reason.length > 0 ? reason : "throttled",
    pendingBytes: Math.max(0, Number(pendingBytes || 0)),
    scheduledAt: new Date(nowMs).toISOString(),
    source: typeof source === "string" ? source : "auto",
  };

  await writeJson(retryPath, payload);

  const delayMs = Math.min(AUTO_RETRY_MAX_DELAY_MS, Math.max(0, retryMs - nowMs));
  if (delayMs <= 0) return { scheduled: false, retryAtMs: retryMs };
  if (autoRetryNoSpawn) {
    return { scheduled: false, retryAtMs: retryMs };
  }

  spawnAutoRetryProcess({
    retryPath,
    trackerBinPath: path.join(trackerDir, "app", "bin", "vibedeck.js"),
    fallbackPkg: "vibedeck-cli",
    delayMs,
  });
  return { scheduled: true, retryAtMs: retryMs };
}

async function clearAutoRetry(trackerDir) {
  const retryPath = path.join(trackerDir, AUTO_RETRY_FILENAME);
  await fs.unlink(retryPath).catch(() => {});
}

function spawnAutoRetryProcess({ retryPath, trackerBinPath, fallbackPkg, delayMs }) {
  const script = buildAutoRetryScript({ retryPath, trackerBinPath, fallbackPkg, delayMs });
  try {
    const child = cp.spawn(process.execPath, ["-e", script], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();
  } catch (_e) {}
}

function buildAutoRetryScript({ retryPath, trackerBinPath, fallbackPkg, delayMs }) {
  return (
    `'use strict';\n` +
    `const fs = require('node:fs');\n` +
    `const cp = require('node:child_process');\n` +
    `const retryPath = ${JSON.stringify(retryPath)};\n` +
    `const trackerBinPath = ${JSON.stringify(trackerBinPath)};\n` +
    `const fallbackPkg = ${JSON.stringify(fallbackPkg)};\n` +
    `const delayMs = ${Math.max(0, Math.floor(delayMs || 0))};\n` +
    `setTimeout(() => {\n` +
    `  let retryAtMs = 0;\n` +
    `  try {\n` +
    `    const raw = fs.readFileSync(retryPath, 'utf8');\n` +
    `    retryAtMs = Number(JSON.parse(raw).retryAtMs || 0);\n` +
    `  } catch (_) {}\n` +
    `  if (!retryAtMs || Date.now() + 1000 < retryAtMs) process.exit(0);\n` +
    `  const argv = ['sync', '--auto', '--from-retry'];\n` +
    `  const cmd = fs.existsSync(trackerBinPath)\n` +
    `    ? [process.execPath, trackerBinPath, ...argv]\n` +
    `    : ['npx', '--yes', fallbackPkg, ...argv];\n` +
    `  try {\n` +
    `    const child = cp.spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore', env: process.env });\n` +
    `    child.unref();\n` +
    `  } catch (_) {}\n` +
    `}, delayMs);\n`
  );
}

function coerceRetryMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

async function writeOpenclawSignal(trackerDir) {
  const openclawSignalPath = path.join(trackerDir, "openclaw.signal");
  try {
    await fs.writeFile(openclawSignalPath, new Date().toISOString(), "utf8");
  } catch (_e) {
    // best-effort marker
  }
}

const AUTO_RETRY_FILENAME = "auto.retry.json";
const AUTO_RETRY_MAX_DELAY_MS = 2 * 60 * 60 * 1000;

async function migrateCursorUnknownBuckets({ cursors, queuePath }) {
  if (!cursors || typeof cursors !== "object") return;
  cursors.migrations = cursors.migrations || {};
  if (cursors.migrations[CURSOR_UNKNOWN_MIGRATION_KEY]) return;

  const buckets = cursors.hourly?.buckets;
  if (!buckets || typeof buckets !== "object") {
    cursors.migrations[CURSOR_UNKNOWN_MIGRATION_KEY] = new Date().toISOString();
    return;
  }

  const retractions = [];
  for (const key of Object.keys(buckets)) {
    if (!key.startsWith("cursor|unknown|")) continue;
    const hourStart = key.split("|").slice(2).join("|");
    retractions.push(
      JSON.stringify({
        source: "cursor",
        model: "unknown",
        hour_start: hourStart,
        input_tokens: 0,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        conversation_count: 0,
      }),
    );
    delete buckets[key];
  }

  if (retractions.length > 0) {
    await ensureDir(path.dirname(queuePath));
    await fs.appendFile(queuePath, retractions.join("\n") + "\n");
    if (cursors.cursorApi) {
      cursors.cursorApi.lastRecordTimestamp = null;
    }
  }

  cursors.migrations[CURSOR_UNKNOWN_MIGRATION_KEY] = new Date().toISOString();
}

async function migrateRolloutCumulativeDeltaBuckets({ cursors, queuePath, rolloutFiles }) {
  if (!cursors || typeof cursors !== "object") return;
  cursors.migrations = cursors.migrations || {};
  if (cursors.migrations[ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY]) return;

  const rolloutPathSources = new Map();
  for (const entry of Array.isArray(rolloutFiles) ? rolloutFiles : []) {
    const filePath = typeof entry === "string" ? entry : entry?.path;
    const source = typeof entry === "string" ? "codex" : String(entry?.source || "codex");
    if (!filePath) continue;
    if (source === "codex" || source === "every-code") {
      rolloutPathSources.set(filePath, source);
    }
  }

  if (cursors.files && typeof cursors.files === "object") {
    for (const filePath of rolloutPathSources.keys()) {
      delete cursors.files[filePath];
    }
  }

  const buckets = cursors.hourly?.buckets;
  const retractions = [];
  if (buckets && typeof buckets === "object") {
    for (const key of Object.keys(buckets)) {
      const [source, model, ...hourParts] = key.split("|");
      if (source !== "codex" && source !== "every-code") continue;
      const hourStart = hourParts.join("|");
      retractions.push(
        JSON.stringify({
          source,
          model: model || "unknown",
          hour_start: hourStart,
          input_tokens: 0,
          cached_input_tokens: 0,
          cache_creation_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
          total_tokens: 0,
          billable_total_tokens: 0,
          conversation_count: 0,
        }),
      );
      delete buckets[key];
    }
  }

  const groupQueued = cursors.hourly?.groupQueued;
  if (groupQueued && typeof groupQueued === "object") {
    for (const key of Object.keys(groupQueued)) {
      if (key.startsWith("codex|") || key.startsWith("every-code|")) {
        delete groupQueued[key];
      }
    }
  }

  if (retractions.length > 0) {
    await ensureDir(path.dirname(queuePath));
    await fs.appendFile(queuePath, retractions.join("\n") + "\n");
  }

  cursors.migrations[ROLLOUT_CUMULATIVE_DELTA_MIGRATION_KEY] = new Date().toISOString();
}

async function reincludeClaudeMemObserverFiles({ cursors, claudeFiles, queuePath }) {
  if (!cursors || typeof cursors !== "object") return false;
  const migrations = (cursors.migrations ||= {});
  if (migrations[CLAUDE_MEM_OBSERVER_REINCLUDE_KEY]) return false;

  const observerPaths = (Array.isArray(claudeFiles) ? claudeFiles : [])
    .map((entry) => (typeof entry === "string" ? entry : entry?.path))
    .filter((p) => typeof p === "string" && p.includes(CLAUDE_MEM_OBSERVER_PATH_SEGMENT));

  if (!cursors.files || typeof cursors.files !== "object") {
    cursors.files = {};
  }

  let filesReset = 0;
  for (const filePath of observerPaths) {
    if (cursors.files[filePath]) {
      delete cursors.files[filePath];
      filesReset += 1;
    }
  }

  const hashesToRemove = observerPaths.length > 0
    ? await collectClaudeMessageHashes(observerPaths)
    : new Set();
  let hashesRemoved = 0;
  if (Array.isArray(cursors.claudeHashes) && hashesToRemove.size > 0) {
    const nextHashes = [];
    for (const hash of cursors.claudeHashes) {
      if (hashesToRemove.has(hash)) {
        hashesRemoved += 1;
        continue;
      }
      nextHashes.push(hash);
    }
    cursors.claudeHashes = nextHashes;
  }

  const queueRowsRelabeled = typeof queuePath === "string" && queuePath
    ? await relabelClaudeMemQueueRows(queuePath)
    : 0;

  migrations[CLAUDE_MEM_OBSERVER_REINCLUDE_KEY] = {
    appliedAt: new Date().toISOString(),
    filesReset,
    hashesRemoved,
    queueRowsRelabeled,
  };
  return filesReset > 0 || hashesRemoved > 0 || queueRowsRelabeled > 0;
}

async function relabelClaudeMemQueueRows(queuePath) {
  let raw;
  try {
    raw = await fs.readFile(queuePath, "utf8");
  } catch (_e) {
    return 0;
  }
  if (!raw || !raw.includes('"claude-mem"')) return 0;

  const lines = raw.split("\n");
  const out = [];
  let relabeled = 0;
  for (const line of lines) {
    if (!line) {
      out.push(line);
      continue;
    }
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (_e) {
      out.push(line);
      continue;
    }
    if (obj && obj.source === "claude-mem") {
      obj.source = "claude";
      relabeled += 1;
      out.push(JSON.stringify(obj));
    } else {
      out.push(line);
    }
  }
  if (relabeled === 0) return 0;

  await fs.writeFile(queuePath, out.join("\n"), "utf8");
  return relabeled;
}

async function collectClaudeMessageHashes(filePaths) {
  const hashes = new Set();
  for (const filePath of filePaths) {
    let stream;
    try {
      stream = fssync.createReadStream(filePath, { encoding: "utf8" });
    } catch (_e) {
      continue;
    }
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.includes('"usage"')) continue;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch (_e) {
        continue;
      }
      const msgId = obj?.message?.id;
      const reqId = obj?.requestId;
      if (msgId && reqId) hashes.add(`${msgId}:${reqId}`);
    }
    rl.close();
    stream.close?.();
  }
  return hashes;
}
