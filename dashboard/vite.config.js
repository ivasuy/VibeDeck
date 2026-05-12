import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import os from "node:os";

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON_PATH = path.resolve(ROOT_DIR, "..", "package.json");
const REPO_ROOT = path.resolve(ROOT_DIR, "..");
const LOCAL_SYNC_TIMEOUT_MS = 120_000;
const LEGACY_PRODUCT_SLUG = ["token", "tracker"].join("");
const LOCAL_API_ROUTES = {
  localSync: "/functions/vibedeck-local-sync",
  usageSummary: "/functions/vibedeck-usage-summary",
  usageDaily: "/functions/vibedeck-usage-daily",
  usageHeatmap: "/functions/vibedeck-usage-heatmap",
  usageModelBreakdown: "/functions/vibedeck-usage-model-breakdown",
  projectUsageSummary: "/functions/vibedeck-project-usage-summary",
  usageLimits: "/functions/vibedeck-usage-limits",
  userStatus: "/functions/vibedeck-user-status",
};

function legacyRoute(primaryRoute) {
  return primaryRoute.replace("/functions/vibedeck-", `/functions/${LEGACY_PRODUCT_SLUG}-`);
}

function isLocalApiRoute(pathname, primaryRoute) {
  return pathname === primaryRoute || pathname === legacyRoute(primaryRoute);
}

function loadAppVersion() {
  try {
    const raw = fs.readFileSync(PACKAGE_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed?.version || "").trim() || null;
  } catch (error) {
    console.warn("[vibedeck] Failed to read package.json version:", error.message);
    return null;
  }
}

function trimCommandOutput(value, maxLength = 4000) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return text.slice(text.length - maxLength);
}

function readJsonBodyVite(req) {
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

async function runLocalSyncCommand(extraEnv = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.platform === "win32" ? "npx.cmd" : "npx", ["vibedeck-cli", "sync"], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      handler(value);
    };

    const timeoutId = setTimeout(() => {
      child.kill("SIGTERM");
      finish(reject, Object.assign(new Error("Local sync timed out after 120 seconds"), {
        code: "SYNC_TIMEOUT",
        stdout: trimCommandOutput(stdout),
        stderr: trimCommandOutput(stderr),
      }));
    }, LOCAL_SYNC_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      finish(reject, Object.assign(error, {
        stdout: trimCommandOutput(stdout),
        stderr: trimCommandOutput(stderr),
      }));
    });

    child.on("close", (code) => {
      const result = {
        code: code ?? 1,
        stdout: trimCommandOutput(stdout),
        stderr: trimCommandOutput(stderr),
      };

      if (code === 0) {
        finish(resolve, result);
        return;
      }

      finish(reject, Object.assign(new Error(result.stderr || result.stdout || `Local sync exited with code ${result.code}`), result));
    });
  });
}

// Per-model pricing — delegated to src/lib/pricing/ (CJS). vite.config.js is
// ESM but createRequire (already imported above) gives us first-class CJS
// interop. The pricing module loads its bundled seed snapshot synchronously
// at require-time, so dev-server mocks still get LiteLLM-backed cost data.
const __viteRequire = createRequire(import.meta.url);
const __pricing = __viteRequire(path.resolve(REPO_ROOT, "src/lib/pricing"));
const { getModelPricing, computeRowCost } = __pricing;

async function handleLocalApi(req, res, url) {
  const QUEUE_PATH_PRIMARY = path.join(os.homedir(), ".vibedeck", "tracker", "queue.jsonl");
  const QUEUE_PATH_LEGACY = path.join(os.homedir(), `.${LEGACY_PRODUCT_SLUG}`, "tracker", "queue.jsonl");
  const QUEUE_PATH = fs.existsSync(QUEUE_PATH_PRIMARY)
    ? QUEUE_PATH_PRIMARY
    : QUEUE_PATH_LEGACY;

  function isLegacyInclusiveCodexRow(row) {
    if (!row || (row.source !== "codex" && row.source !== "every-code")) return false;
    const inputTokens = Number(row.input_tokens || 0);
    const cachedInputTokens = Number(row.cached_input_tokens || 0);
    const outputTokens = Number(row.output_tokens || 0);
    const totalTokens = Number(row.total_tokens || 0);
    if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedInputTokens)) return false;
    if (cachedInputTokens <= 0 || inputTokens < cachedInputTokens) return false;
    return totalTokens === inputTokens + outputTokens;
  }

  function normalizeQueueRow(row) {
    if (!isLegacyInclusiveCodexRow(row)) return row;
    return {
      ...row,
      input_tokens: Number(row.input_tokens || 0) - Number(row.cached_input_tokens || 0),
    };
  }

  function readQueueData() {
    try {
      const raw = fs.readFileSync(QUEUE_PATH, "utf8");
      const lines = raw.split("\n").filter(line => line.trim());
      const parsed = lines.map(line => JSON.parse(line));
      // Deduplicate: each sync appends cumulative totals per bucket, so for
      // each (source, model, hour_start) keep only the latest (last) entry.
      const seen = new Map();
      for (const row of parsed) {
        const key = `${row.source || ""}|${row.model || ""}|${row.hour_start || ""}`;
        seen.set(key, normalizeQueueRow(row));
      }
      return Array.from(seen.values());
    } catch (error) {
      console.warn("[localDataApi] Failed to read queue.jsonl:", error.message);
      return [];
    }
  }

  function aggregateByDay(rows) {
    const byDay = new Map();
    for (const row of rows) {
      const hourStart = row.hour_start;
      if (!hourStart) continue;
      const day = hourStart.slice(0, 10);
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
      const agg = byDay.get(day);
      agg.total_tokens += row.total_tokens || 0;
      agg.billable_total_tokens += row.total_tokens || 0;
      agg.total_cost_usd += computeRowCost(row);
      agg.input_tokens += row.input_tokens || 0;
      agg.output_tokens += row.output_tokens || 0;
      agg.cached_input_tokens += row.cached_input_tokens || 0;
      agg.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
      agg.reasoning_output_tokens += row.reasoning_output_tokens || 0;
      agg.conversation_count += row.conversation_count || 0;
    }
    return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
  }

  const pathname = url.pathname;

  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.localSync)) {
    if (String(req.method || "GET").toUpperCase() !== "POST") {
      res.statusCode = 405;
      res.setHeader("Allow", "POST");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: false, error: "Method Not Allowed" }));
      return true;
    }

    try {
      let body = {};
      try {
        body = await readJsonBodyVite(req);
      } catch {
        body = {};
      }
      void body;
      const result = await runLocalSyncCommand();
      try {
        const esmRequire = createRequire(import.meta.url);
        const { resetUsageLimitsCache } = esmRequire("../src/lib/usage-limits");
        resetUsageLimitsCache();
      } catch (_e) {
        // ignore
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        ok: false,
        error: error?.message || "Local sync failed",
        code: error?.code ?? null,
        stdout: error?.stdout || "",
        stderr: error?.stderr || "",
      }));
    }
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.usageSummary)) {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const rows = readQueueData();
    const daily = aggregateByDay(rows).filter(d => d.day >= from && d.day <= to);
    const totals = daily.reduce((acc, row) => {
      acc.total_tokens += row.total_tokens;
      acc.billable_total_tokens += row.billable_total_tokens;
      acc.total_cost_usd += row.total_cost_usd || 0;
      acc.input_tokens += row.input_tokens;
      acc.output_tokens += row.output_tokens;
      acc.cached_input_tokens += row.cached_input_tokens;
      acc.cache_creation_input_tokens += row.cache_creation_input_tokens;
      acc.reasoning_output_tokens += row.reasoning_output_tokens;
      acc.conversation_count += row.conversation_count;
      return acc;
    }, {
      total_tokens: 0, billable_total_tokens: 0, total_cost_usd: 0, input_tokens: 0,
      output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, conversation_count: 0,
    });
    const totalCost = totals.total_cost_usd;


    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const allDaily = aggregateByDay(rows);


    const last7Days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const dayData = allDaily.find(x => x.day === dayStr);
      if (dayData) last7Days.push(dayData);
    }
    const last7dTotals = last7Days.reduce((acc, row) => {
      acc.billable_total_tokens += row.billable_total_tokens;
      acc.conversation_count += row.conversation_count;
      return acc;
    }, { billable_total_tokens: 0, conversation_count: 0 });


    const last30Days = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      const dayStr = d.toISOString().slice(0, 10);
      const dayData = allDaily.find(x => x.day === dayStr);
      if (dayData) last30Days.push(dayData);
    }
    const last30dTotals = last30Days.reduce((acc, row) => {
      acc.billable_total_tokens += row.billable_total_tokens;
      acc.conversation_count += row.conversation_count;
      return acc;
    }, { billable_total_tokens: 0, conversation_count: 0 });
    const avgPerActiveDay = last30Days.length > 0 ? Math.round(last30dTotals.billable_total_tokens / last30Days.length) : 0;


    const last7dFrom = new Date(today);
    last7dFrom.setUTCDate(last7dFrom.getUTCDate() - 6);
    const last30dFrom = new Date(today);
    last30dFrom.setUTCDate(last30dFrom.getUTCDate() - 29);

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      from, to, days: daily.length,
      totals: { ...totals, total_cost_usd: totalCost.toFixed(6) },
      rolling: {
        last_7d: {
          from: last7dFrom.toISOString().slice(0, 10),
          to: todayStr,
          active_days: last7Days.length,
          totals: last7dTotals,
        },
        last_30d: {
          from: last30dFrom.toISOString().slice(0, 10),
          to: todayStr,
          active_days: last30Days.length,
          totals: last30dTotals,
          avg_per_active_day: avgPerActiveDay,
        },
      },
    }));
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.usageDaily)) {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const rows = readQueueData();
    const daily = aggregateByDay(rows).filter(d => d.day >= from && d.day <= to);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ from, to, data: daily }));
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.usageHeatmap)) {
    const weeks = parseInt(url.searchParams.get("weeks") || "52", 10);
    const rows = readQueueData();
    const daily = aggregateByDay(rows);
    const today = new Date();
    const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - weeks * 7 + 1);
    const from = start.toISOString().slice(0, 10);
    const to = end.toISOString().slice(0, 10);
    const byDay = new Map(daily.map(d => [d.day, d]));
    const cells = [];
    const cursor = new Date(start);


    const allValues = daily.map(d => d.billable_total_tokens).filter(v => v > 0).sort((a, b) => a - b);
    const maxValue = allValues.length > 0 ? allValues[allValues.length - 1] : 0;


    function calcLevel(value) {
      if (value <= 0) return 0;
      if (maxValue === 0) return 1;
      const ratio = value / maxValue;
      if (ratio <= 0.25) return 1;
      if (ratio <= 0.5) return 2;
      if (ratio <= 0.75) return 3;
      return 4;
    }

    while (cursor <= end) {
      const day = cursor.toISOString().slice(0, 10);
      const data = byDay.get(day);
      const billable = data?.billable_total_tokens || 0;
      cells.push({
        day,
        total_tokens: data?.total_tokens || 0,
        billable_total_tokens: billable,
        level: calcLevel(billable),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    const activeDays = cells.filter(c => c.billable_total_tokens > 0).length;

    const weeksArr = [];
    for (let i = 0; i < cells.length; i += 7) {
      weeksArr.push(cells.slice(i, i + 7));
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ from, to, week_starts_on: "sun", active_days: activeDays, streak_days: 0, weeks: weeksArr }));
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.usageModelBreakdown)) {
    const from = url.searchParams.get("from") || "";
    const to = url.searchParams.get("to") || "";
    const rows = readQueueData();


    const filteredRows = rows.filter(row => {
      if (!row.hour_start) return false;
      const day = row.hour_start.slice(0, 10);
      return day >= from && day <= to;
    });

    const bySource = new Map();


    for (const row of filteredRows) {
      const source = row.source || "unknown";
      const modelName = row.model || "unknown";

      if (!bySource.has(source)) {
        bySource.set(source, {
          source,
          totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" },
          models: new Map()
        });
      }
      const sourceAgg = bySource.get(source);


      sourceAgg.totals.total_tokens += row.total_tokens || 0;
      sourceAgg.totals.billable_total_tokens += row.total_tokens || 0;
      sourceAgg.totals.input_tokens += row.input_tokens || 0;
      sourceAgg.totals.output_tokens += row.output_tokens || 0;
      sourceAgg.totals.cached_input_tokens += row.cached_input_tokens || 0;
      sourceAgg.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
      sourceAgg.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;


      if (!sourceAgg.models.has(modelName)) {
        sourceAgg.models.set(modelName, {
          model: modelName,
          model_id: modelName,
          totals: { total_tokens: 0, billable_total_tokens: 0, input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_cost_usd: "0" }
        });
      }
      const modelAgg = sourceAgg.models.get(modelName);
      modelAgg.totals.total_tokens += row.total_tokens || 0;
      modelAgg.totals.billable_total_tokens += row.total_tokens || 0;
      modelAgg.totals.input_tokens += row.input_tokens || 0;
      modelAgg.totals.output_tokens += row.output_tokens || 0;
      modelAgg.totals.cached_input_tokens += row.cached_input_tokens || 0;
      modelAgg.totals.cache_creation_input_tokens += row.cache_creation_input_tokens || 0;
      modelAgg.totals.reasoning_output_tokens += row.reasoning_output_tokens || 0;
    }


    const sources = Array.from(bySource.values()).map(s => {
      s.models = Array.from(s.models.values()).map(m => {
        const cost = computeRowCost({
          ...m.totals,
          model: m.model,
          source: s.source,
        });
        return { ...m, totals: { ...m.totals, total_cost_usd: cost.toFixed(6) } };
      }).sort((a, b) => b.totals.total_tokens - a.totals.total_tokens);
      const sourceCost = s.models.reduce((sum, m) => sum + Number(m.totals.total_cost_usd), 0);
      s.totals.total_cost_usd = sourceCost.toFixed(6);
      return s;
    });

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      from, to, days: 0, sources,
      pricing: { model: "default", pricing_mode: "add", source: "default", effective_from: new Date().toISOString().slice(0, 10), rates_per_million_usd: { input: "1.750000", cached_input: "0.175000", output: "14.000000", reasoning_output: "14.000000" } },
    }));
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.projectUsageSummary)) {

    const projectQueuePath = fs.existsSync(path.join(os.homedir(), ".vibedeck", "tracker", "project.queue.jsonl"))
      ? path.join(os.homedir(), ".vibedeck", "tracker", "project.queue.jsonl")
      : path.join(os.homedir(), `.${LEGACY_PRODUCT_SLUG}`, "tracker", "project.queue.jsonl");
    try {
      const projectRaw = fs.readFileSync(projectQueuePath, "utf8");
      const dedup = new Map();
      for (const line of projectRaw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const row = JSON.parse(trimmed);
          const k = `${row.project_key || ""}|${row.source || ""}|${row.hour_start || ""}`;
          dedup.set(k, row);
        } catch { /* skip malformed */ }
      }
      const byProject = new Map();
      for (const row of dedup.values()) {
        const key = row.project_key || "unknown";
        if (!byProject.has(key)) {
          byProject.set(key, {
            project_key: key,
            project_ref: row.project_ref || key,
            total_tokens: 0,
            billable_total_tokens: 0,
          });
        }
        const agg = byProject.get(key);
        agg.total_tokens += Number(row.total_tokens || 0);
        agg.billable_total_tokens += Number(row.total_tokens || 0);
        if (!agg.project_ref && row.project_ref) agg.project_ref = row.project_ref;
      }
      if (byProject.size > 0) {
        const entries = Array.from(byProject.values())
          .sort((a, b) => b.billable_total_tokens - a.billable_total_tokens)
          .map((e) => ({
            ...e,
            total_tokens: String(e.total_tokens),
            billable_total_tokens: String(e.billable_total_tokens),
          }));
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ generated_at: new Date().toISOString(), entries }));
        return true;
      }
    } catch (e) {
      if (e?.code !== "ENOENT") console.warn("[vite-mock] project.queue.jsonl read failed:", e?.message || e);
    }


    const projectMap = new Map();

    function parseGitUrl(url) {
      if (!url) return null;

      const sshMatch = url.match(/git@[^:]+:([^\/]+)\/(.+?)(?:\.git)?$/);
      if (sshMatch) {
        return { host: 'gitlab', owner: sshMatch[1], repo: sshMatch[2] };
      }

      const httpMatch = url.match(/https?:\/\/[^\/]+\/([^\/]+)\/(.+?)(?:\.git)?$/);
      if (httpMatch) {
        return { host: 'gitlab', owner: httpMatch[1], repo: httpMatch[2] };
      }
      return null;
    }


    function extractProjectFromCwd(cwd) {
      if (!cwd || cwd === '/Users/sunxiufeng' || cwd === os.homedir()) return null;

      const relative = cwd.replace(os.homedir() + '/', '');

      const parts = relative.split('/').filter(p => p && !p.startsWith('.') && p !== 'ext-global');
      if (parts.length === 0) return null;
      return parts[0];
    }


    const codexDir = path.join(os.homedir(), ".codex", "sessions");
    try {
      const years = fs.readdirSync(codexDir);
      for (const year of years) {
        const yearPath = path.join(codexDir, year);
        if (!fs.statSync(yearPath).isDirectory()) continue;
        const months = fs.readdirSync(yearPath);
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          if (!fs.statSync(monthPath).isDirectory()) continue;
          const days = fs.readdirSync(monthPath);
          for (const day of days) {
            const dayPath = path.join(monthPath, day);
            if (!fs.statSync(dayPath).isDirectory()) continue;
            const files = fs.readdirSync(dayPath).filter(f => f.endsWith('.jsonl'));
            for (const file of files.slice(0, 200)) {
              const filePath = path.join(dayPath, file);
              try {
                const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
                const data = JSON.parse(firstLine);

                if (data.git?.repository_url) {
                  const parsed = parseGitUrl(data.git.repository_url);
                  if (parsed) {
                    const projectKey = `${parsed.owner}/${parsed.repo}`;
                    if (!projectMap.has(projectKey)) {
                      projectMap.set(projectKey, {
                        project_key: projectKey,
                        project_ref: data.git.repository_url,
                        source: 'codex',
                        count: 0
                      });
                    }
                    projectMap.get(projectKey).count++;
                  }
                }
              } catch (e) { /* ignore */ }
            }
          }
        }
      }
    } catch (e) { /* ignore */ }


    const claudeDir = path.join(os.homedir(), ".claude", "projects");
    function findSubagentsDirs(dir, depth = 0) {
      const results = [];
      if (depth > 3) return results;
      try {
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (!stat.isDirectory()) continue;
          if (item === 'subagents') {
            results.push(fullPath);
          } else {
            results.push(...findSubagentsDirs(fullPath, depth + 1));
          }
        }
      } catch (e) { /* ignore */ }
      return results;
    }

    try {
      const subagentsDirs = findSubagentsDirs(claudeDir);
      for (const subagentsPath of subagentsDirs) {
        const files = fs.readdirSync(subagentsPath).filter(f => f.endsWith('.jsonl'));
        for (const file of files.slice(0, 100)) {
          const filePath = path.join(subagentsPath, file);
          try {
            const firstLine = fs.readFileSync(filePath, 'utf8').split('\n')[0];
            if (!firstLine) continue;
            const data = JSON.parse(firstLine);
            const projectName = extractProjectFromCwd(data.cwd);
            if (projectName) {
              if (!projectMap.has(projectName)) {
                projectMap.set(projectName, {
                  project_key: projectName,
                  project_ref: `file://${data.cwd}`,
                  source: 'claude',
                  count: 0
                });
              }
              projectMap.get(projectName).count++;
            }
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* ignore */ }


    const rows = readQueueData();
    const totalTokens = rows.reduce((sum, row) => sum + (row.total_tokens || 0), 0);
    const entries = [];

    if (projectMap.size === 0) {

      const bySource = new Map();
      for (const row of rows) {
        const source = row.source || "unknown";
        if (!bySource.has(source)) {
          bySource.set(source, {
            project_key: source,
            project_ref: `https://${source}.ai`,
            total_tokens: 0,
            billable_total_tokens: 0
          });
        }
        bySource.get(source).total_tokens += row.total_tokens || 0;
        bySource.get(source).billable_total_tokens += row.total_tokens || 0;
      }
      entries.push(...Array.from(bySource.values()).sort((a, b) => b.billable_total_tokens - a.total_tokens).map(e => ({
        ...e,
        total_tokens: String(e.total_tokens),
        billable_total_tokens: String(e.billable_total_tokens)
      })));
    } else {

      const totalCount = Array.from(projectMap.values()).reduce((sum, p) => sum + p.count, 0);
      for (const [, project] of projectMap) {
        const ratio = totalCount > 0 ? project.count / totalCount : 1 / projectMap.size;
        const tokens = Math.floor(totalTokens * ratio);
        entries.push({
          project_key: project.project_key,
          project_ref: project.project_ref,
          total_tokens: String(tokens),
          billable_total_tokens: String(tokens)
        });
      }

      entries.sort((a, b) => Number(b.billable_total_tokens) - Number(a.billable_total_tokens));
    }

    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      generated_at: new Date().toISOString(),
      entries
    }));
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.usageLimits)) {
    try {
      const esmRequire = createRequire(import.meta.url);
      const { getUsageLimits, resetUsageLimitsCache } = esmRequire("../src/lib/usage-limits");
      const forceRefresh = url.searchParams.get("refresh");
      if (forceRefresh === "1" || forceRefresh === "true") {
        resetUsageLimitsCache();
      }
      const data = await getUsageLimits({
        home: os.homedir(),
        env: process.env,
        platform: process.platform,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(data));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: e?.message || "Unknown error" }));
    }
    return true;
  }


  if (isLocalApiRoute(pathname, LOCAL_API_ROUTES.userStatus)) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      user_id: "local-user", email: "local@localhost", name: "Local User", is_public: false,
      created_at: new Date().toISOString(),
      pro: { active: true, sources: ["local"], expires_at: null, partial: false, as_of: new Date().toISOString() },
    }));
    return true;
  }

  return null;
}

async function proxyToLocalCli(req, res) {
  const target = `http://127.0.0.1:7690${req.url}`;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.connection;
  const init = { method: req.method, headers };
  if (req.method && !["GET", "HEAD"].includes(req.method.toUpperCase())) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    init.body = Buffer.concat(chunks);
  }
  try {
    const upstream = await fetch(target, init);
    res.statusCode = upstream.status;
    upstream.headers.forEach((value, key) => {
      if (key === "content-encoding" || key === "content-length") return;
      res.setHeader(key, value);
    });
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (error) {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      error: `Local CLI not reachable on :7690 — start it with: node bin/vibedeck.js serve --no-sync --no-open`,
      detail: String(error?.message || error),
    }));
  }
}

function localDataApiPlugin() {
  return {
    name: "vibedeck-local-data-api",
    configureServer(server) {

      server.middlewares.use((req, res, next) => {
        if (typeof req.url === "string" && req.url.startsWith("/functions/")) {
          const url = new URL(req.url, `http://${req.headers.host}`);
          Promise.resolve(handleLocalApi(req, res, url))
            .then((handled) => {
              if (handled) return;

              return proxyToLocalCli(req, res);
            })
            .catch(next);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ROOT_DIR, "VITE_");
  const fallbackVersion = loadAppVersion();
  const define = {};

  if (!env.VITE_APP_VERSION && fallbackVersion) {
    define["import.meta.env.VITE_APP_VERSION"] = JSON.stringify(fallbackVersion);
  }

  return {
    plugins: [react(), localDataApiPlugin()],
    ...(Object.keys(define).length ? { define } : {}),
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(ROOT_DIR, "index.html"),
        },
      },
    },
    server: {
      port: 5173,
      // Prefer 5173 for local CLI integration, but don't fail if already in use.
      strictPort: false,

      historyApiFallback: {
        rewrites: [
          { from: /^\/functions\/.*$/, to: (ctx) => ctx.parsedUrl.pathname }
        ]
      },

      proxy: {},
    },
  };
});
