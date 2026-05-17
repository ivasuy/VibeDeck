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
  if (String(row?.audit_scope || "").trim().toLowerCase() === "cwd_only") return false;
  if (String(row?.cwd || "").trim() && !String(row?.repo_root || "").trim()) return false;
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
    <div className="vd-subcard rounded-lg bg-oai-black/[0.035] px-4 py-3 dark:bg-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

export function LiveWorkbenchOverview({
  sessions = [],
  workstreams = [],
  totals = null,
  status = "idle",
  limits = null,
  canonicalIncomplete = false,
  initialLoading = false,
}) {
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
  const activeTokens = Number(totals?.active_tokens ?? model.tokens ?? 0) || 0;
  const activeCost = Number(totals?.active_cost_usd ?? model.cost ?? 0) || 0;
  const auditTokens = Number(totals?.audit_tokens ?? activeTokens) || 0;
  const auditCost = Number(totals?.audit_cost_usd ?? activeCost) || 0;
  const activeProjectCount = Number(totals?.active_projects ?? workstreams.length ?? 0) || 0;
  const costDisplay = formatUsdCurrency(auditCost.toFixed(2), { decimals: 2 });
  const hasAttributionNeeds = model.attributionGaps > 0;

  if (initialLoading) {
    return <LiveWorkbenchOverviewSkeleton />;
  }

  return (
    <section className="vd-card rounded-xl border border-oai-gray-200 bg-white p-5 dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            Live control center
          </div>
          <div className="mt-2 text-4xl font-semibold leading-none tracking-tight text-oai-black dark:text-white md:text-6xl">
            <Counter
              value={auditTokens}
              displayValue={toDisplayNumber(auditTokens)}
              fontSize={60}
              padding={4}
              gap={0}
              fontWeight={600}
              gradientHeight={0}
              digitStyle={{ width: "0.82ch" }}
              counterStyle={{ gap: 0 }}
            />
          </div>
          <div className="mt-2 text-sm font-medium text-oai-brand dark:text-oai-brand-300">
            <Counter
              value={auditCost}
              displayValue={costDisplay}
              fontSize={14}
              padding={2}
              gap={1.5}
              fontWeight={600}
              gradientHeight={0}
              digitStyle={{ width: "0.86ch" }}
              counterStyle={{ gap: "0.08em", letterSpacing: "0.03em" }}
            />
          </div>
        </div>
        <div className="vd-chip inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-3 text-xs font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
          {status === "connected" ? "Live stream connected" : status}
        </div>
      </div>

      <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-oai-brand-100/80 dark:bg-oai-brand-950/60">
        {confidenceRows.map((row) => {
          const pct = total > 0 ? (row.count / total) * 100 : 0;
          const colors = {
            high: "bg-indigo-500",
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
        <OverviewTile icon={Activity} label="Active projects" value={activeProjectCount} />
        <OverviewTile icon={Cpu} label="Live now" value={formatCompactNumber(activeTokens, { decimals: 1 })} />
        <OverviewTile icon={CircleDollarSign} label="Live cost" value={formatUsdCurrency(activeCost.toFixed(2))} />
        <OverviewTile icon={Cpu} label="Project total" value={formatCompactNumber(auditTokens, { decimals: 1 })} />
        <OverviewTile
          icon={hasAttributionNeeds ? ShieldAlert : CircleDollarSign}
          label={hasAttributionNeeds ? "Needs attribution" : "Known cost"}
          value={hasAttributionNeeds ? model.attributionGaps : formatUsdCurrency(String(model.cost))}
          tone={hasAttributionNeeds ? "risk" : "neutral"}
        />
        <OverviewTile icon={ShieldCheck} label="Limit sources" value={limitSummary.recorded} />
      </div>
      {canonicalIncomplete ? (
        <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
          Canonical backfill is incomplete. Live audit totals may exclude older sessions until rebuild finishes.
        </div>
      ) : null}
    </section>
  );
}

function LiveWorkbenchOverviewSkeleton() {
  return (
    <section className="vd-card rounded-xl border border-oai-gray-200 bg-white p-5 dark:border-oai-gray-800 dark:bg-oai-gray-900" aria-busy="true">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            Live control center
          </div>
          <div className="shimmer mt-4 h-14 w-56 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
          <div className="shimmer mt-3 h-5 w-28 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
        </div>
        <div className="shimmer h-8 w-32 rounded-md bg-oai-gray-100 dark:bg-oai-gray-800" />
      </div>
      <div className="shimmer mt-6 h-2 rounded-full bg-oai-gray-100 dark:bg-oai-gray-800" />
      <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((index) => (
          <div key={index} className="shimmer h-16 rounded-lg bg-oai-gray-100 dark:bg-oai-gray-800" />
        ))}
      </div>
    </section>
  );
}
