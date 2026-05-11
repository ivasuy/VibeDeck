import React, { useMemo } from "react";
import { Activity, CircleDollarSign, Cpu, Radio, ShieldAlert, ShieldCheck } from "lucide-react";
import { Counter } from "../../ui/openai/components";
import { formatCompactNumber, formatUsdCurrency, toDisplayNumber } from "../../lib/format";

const LIMIT_PROVIDERS = ["claude", "codex", "cursor", "gemini", "kimi", "kiro", "copilot", "antigravity"];

function isActiveRow(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function knownCost(row) {
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(String(row?.cost_quality || ""))) {
    return null;
  }
  const n = Number(row?.estimated_total_cost_usd ?? row?.total_cost_usd);
  return Number.isFinite(n) ? n : null;
}

function confidenceKey(value) {
  const raw = String(value || "").toLowerCase();
  if (raw === "high" || raw === "medium" || raw === "low") return raw;
  return "unattributed";
}

function hasAttributionGap(row) {
  return !String(row?.repo_root || "").trim() || !String(row?.branch || "").trim();
}

function hasRecordedWindow(id, data) {
  if (!data || data.error || data.status === "setup_required" || data.status === "cooldown") return false;
  const windows = id === "claude"
    ? [data.five_hour, data.seven_day, data.seven_day_opus]
    : [data.primary_window, data.secondary_window, data.tertiary_window];
  return windows.some((window) => window && Number.isFinite(Number(window.utilization ?? window.used_percent)));
}

function OverviewTile({ icon: Icon, label, value, tone = "neutral" }) {
  const valueClass = tone === "risk"
    ? "text-amber-700 dark:text-amber-300"
    : "text-oai-black dark:text-white";
  return (
    <div className="rounded-lg bg-oai-black/[0.035] px-4 py-3 dark:bg-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

export function LiveWorkbenchOverview({ sessions = [], status = "idle", limits = null }) {
  const model = useMemo(() => {
    const active = (Array.isArray(sessions) ? sessions : []).filter(isActiveRow);
    const providers = new Map();
    const confidence = { high: 0, medium: 0, low: 0, unattributed: 0 };
    const repos = new Set();
    let tokens = 0;
    let cost = 0;
    let attributionGaps = 0;

    for (const row of active) {
      const provider = String(row?.provider || "unknown").toLowerCase();
      const entry = providers.get(provider) || { id: provider, label: String(row?.provider || "Unknown"), count: 0, tokens: 0 };
      entry.count += 1;
      entry.tokens += Number(row?.total_tokens ?? 0) || 0;
      providers.set(provider, entry);
      const repo = String(row?.repo_root || "").trim();
      if (repo) repos.add(repo);
      tokens += Number(row?.total_tokens ?? 0) || 0;
      const rowCost = knownCost(row);
      if (rowCost != null) cost += rowCost;
      const key = confidenceKey(row?.confidence);
      confidence[key] += 1;
      if (hasAttributionGap(row)) attributionGaps += 1;
    }

    const providerRows = Array.from(providers.values());

    return { active, providers: providerRows, confidence, repos, tokens, cost, attributionGaps };
  }, [sessions]);

  const limitSummary = useMemo(() => {
    const recorded = LIMIT_PROVIDERS.filter((id) => hasRecordedWindow(id, limits?.[id])).length;
    return { recorded };
  }, [limits]);

  const total = model.active.length;
  const confidenceRows = ["high", "medium", "low", "unattributed"].map((key) => ({
    key,
    count: model.confidence[key],
  }));
  const tokenCounter = Number.isFinite(model.tokens) ? model.tokens : 0;
  const activeCost = Number.isFinite(model.cost) ? model.cost : 0;
  const costDisplay = formatUsdCurrency(activeCost.toFixed(2), { decimals: 2 });
  const hasAttributionNeeds = model.attributionGaps > 0;

  return (
    <section className="rounded-xl border border-oai-gray-200 bg-white p-5 dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            Live control center
          </div>
          <div className="mt-2 text-4xl font-semibold leading-none tracking-tight text-oai-black dark:text-white md:text-6xl">
            <Counter
              value={tokenCounter}
              displayValue={toDisplayNumber(tokenCounter)}
              fontSize={60}
              padding={4}
              gap={0}
              fontWeight={600}
              gradientHeight={0}
              digitStyle={{ width: "0.82ch" }}
              counterStyle={{ gap: 0 }}
            />
          </div>
          <div className="mt-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <Counter
              value={activeCost}
              displayValue={costDisplay}
              fontSize={14}
              padding={2}
              gap={0}
              fontWeight={600}
              gradientHeight={0}
              digitStyle={{ width: "0.72ch" }}
              counterStyle={{ gap: 0 }}
            />
            <span className="ml-1">active cost</span>
          </div>
        </div>
        <div className="inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-3 text-xs font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
          {status === "connected" ? "Live stream connected" : status}
        </div>
      </div>

      <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-oai-black/[0.06] dark:bg-white/[0.08]">
        {confidenceRows.map((row) => {
          const pct = total > 0 ? (row.count / total) * 100 : 0;
          const colors = {
            high: "bg-emerald-500",
            medium: "bg-amber-500",
            low: "bg-indigo-500",
            unattributed: "bg-red-500",
          };
          return (
            <div
              key={row.key}
              className={`h-full shrink-0 ${colors[row.key]}`}
              style={{ flexBasis: `${pct}%` }}
              aria-hidden
            />
          );
        })}
      </div>

      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        <OverviewTile icon={Radio} label="Live sessions" value={model.active.length} />
        <OverviewTile icon={Activity} label="Providers" value={model.providers.length} />
        <OverviewTile icon={Cpu} label="Tokens" value={formatCompactNumber(model.tokens, { decimals: 1 })} />
        <OverviewTile
          icon={hasAttributionNeeds ? ShieldAlert : CircleDollarSign}
          label={hasAttributionNeeds ? "Needs attribution" : "Known cost"}
          value={hasAttributionNeeds ? model.attributionGaps : formatUsdCurrency(String(model.cost))}
          tone={hasAttributionNeeds ? "risk" : "neutral"}
        />
        <OverviewTile icon={ShieldCheck} label="Limit sources" value={limitSummary.recorded} />
        <OverviewTile icon={Activity} label="Active repos" value={model.repos.size} />
      </div>
    </section>
  );
}
