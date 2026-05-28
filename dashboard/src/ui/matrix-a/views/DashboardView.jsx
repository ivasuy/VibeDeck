import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowUpRight, RefreshCw, Settings } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { Shell, Button } from "../../openai/components";
import { CostAnalysisModal } from "../components/CostAnalysisModal.jsx";
import { ClawdAnimated } from "../../foundation/ClawdAnimated.jsx";
import { useClawdState } from "../../../hooks/useClawdState.js";
import { ProviderLogo } from "../../../lib/provider-logos.jsx";
import { formatCompactNumber, formatUsdCurrency } from "../../../lib/format";
import { FreshnessBadge, HeaderThemeMenu } from "../../../components/RevampSurfaces.jsx";

const PERIOD_LABELS = {
  day: "Today",
  week: "Week",
  month: "Month",
  total: "Total",
  custom: "Custom",
};

function asNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function money(value) {
  const numeric = asNumber(value);
  if (numeric <= 0) return "$0.00";
  return formatUsdCurrency(numeric.toFixed(2), { decimals: 2 });
}

function safePercent(value) {
  const numeric = asNumber(value);
  if (numeric <= 0) return "0%";
  if (numeric >= 100) return "100%";
  return `${Math.round(numeric)}%`;
}

function Surface({ children, className = "", style }) {
  return (
    <div
      className={`rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-none backdrop-blur-sm ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}

function SectionHeader({ title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-label uppercase text-oai-gray-500 dark:text-oai-gray-400">
        {title}
      </h2>
      {action}
    </div>
  );
}

function SparklineBars({ values = [], light = false }) {
  const numeric = values.map((row) => asNumber(row?.total_cost_usd ?? row?.cost ?? row?.value)).filter((value) => value > 0);
  const display = numeric.length ? numeric.slice(-8) : [2, 4, 3, 6, 8, 7, 5, 6];
  const max = Math.max(...display, 1);
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {display.map((value, index) => (
        <span
          key={`${value}-${index}`}
          className={`w-full rounded-sm ${light ? "bg-white/45" : "bg-[var(--brand-400)]/55"}`}
          style={{ height: `${Math.max(18, (value / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

const PROVIDER_BREAKDOWN_VIEW_KEY = "vd-dashboard-provider-breakdown-view";

function readProviderBreakdownView() {
  if (typeof window === "undefined") return "bar";
  try {
    const value = window.localStorage.getItem(PROVIDER_BREAKDOWN_VIEW_KEY);
    return value === "list" ? "list" : "bar";
  } catch (_err) {
    return "bar";
  }
}

function ProviderBreakdown({ providers, freshness }) {
  const total = providers.reduce((sum, provider) => sum + asNumber(provider.usage), 0);
  const visible = providers.slice(0, 5);
  const [view, setView] = useState(() => readProviderBreakdownView());

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(PROVIDER_BREAKDOWN_VIEW_KEY, view);
    } catch (_err) {
      // Persistence is a convenience; the toggle still works without storage.
    }
  }, [view]);

  const viewToggle = (
    <div className="inline-flex rounded-lg border border-[var(--vd-border)] bg-[var(--vd-tint)] p-0.5" role="group" aria-label="Provider breakdown view">
      {["bar", "list"].map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setView(item)}
          className={`h-7 rounded-md px-2.5 text-caption font-semibold uppercase transition-colors ${
            view === item
              ? "bg-[var(--glass-bg)] text-oai-black dark:text-white"
              : "text-oai-gray-500 hover:text-oai-black dark:hover:text-white"
          }`}
          aria-pressed={view === item}
        >
          {item}
        </button>
      ))}
    </div>
  );

  return (
    <Surface>
      <SectionHeader
        title="Provider breakdown"
        action={<div className="flex items-center gap-2">{freshness}{viewToggle}</div>}
      />
      {visible.length ? (
        <>
          {view === "bar" ? (
            <div className="flex h-3 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
              {visible.map((provider, index) => {
                const width = total > 0 ? (asNumber(provider.usage) / total) * 100 : 0;
                const shade = ["var(--brand-700)", "var(--brand-600)", "var(--brand-500)", "var(--brand-400)", "var(--brand-300)"][index] || "var(--oai-gray-400)";
                return (
                  <span
                    key={provider.label}
                    className="h-full"
                    style={{ width: `${Math.max(width, 4)}%`, background: shade }}
                  />
                );
              })}
            </div>
          ) : null}
          <div className={view === "bar" ? "mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5" : "space-y-2"}>
            {visible.map((provider, index) => {
              const shade = ["var(--brand-700)", "var(--brand-600)", "var(--brand-500)", "var(--brand-400)", "var(--brand-300)"][index] || "var(--oai-gray-400)";
              return (
                <div key={provider.label} className="flex min-w-0 items-center gap-2">
                  <ProviderLogo provider={provider.label} size={16} className="text-oai-gray-700 dark:text-oai-gray-200" />
                  <span className="min-w-0 truncate text-sm font-medium text-oai-black dark:text-white">
                    {provider.label}
                  </span>
                  {view === "list" ? (
                    <span className="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800" aria-hidden>
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.max(asNumber(provider.totalPercent), 2)}%`,
                          background: shade,
                        }}
                      />
                    </span>
                  ) : null}
                  <span className="ml-auto shrink-0 text-caption tabular-nums text-oai-gray-500">
                    {safePercent(provider.totalPercent)}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
          Run any AI coding tool to start tracking provider usage.
        </p>
      )}
    </Surface>
  );
}

function sessionActivityTimestamp(row) {
  return row?.activity_at || row?.last_observed_at || row?.observed_at || row?.ended_at || row?.started_at || row?.updated_at || null;
}

function sessionLabel(row) {
  const branch = String(row?.attribution_branch || row?.branch || "").trim();
  const repo = String(row?.repo_name || row?.repo_root || row?.cwd || "").trim();
  if (branch && repo) return `${branch} · ${repo.split("/").filter(Boolean).pop() || repo}`;
  if (branch) return branch;
  return repo || "Unattributed session";
}

function sessionMetric(row) {
  const cost = Number(row?.estimated_total_cost_usd ?? row?.total_cost_usd);
  if (Number.isFinite(cost) && cost > 0) return money(cost);
  return `${formatCompactNumber(asNumber(row?.total_tokens), { decimals: 1 })} tokens`;
}

function formatActivityTimestamp(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatHeaderDate() {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function RecentActivity({ rows, sessionRows, renderDate, renderCell }) {
  const visibleSessions = Array.isArray(sessionRows) ? sessionRows.slice(0, 5) : [];
  const visibleRows = Array.isArray(rows) ? rows.slice(0, 5) : [];
  return (
    <section>
      <SectionHeader
        title="Recent activity"
        action={
          <Link to="/live" className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-700)] no-underline dark:text-[var(--brand-300)]">
            See all <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        }
      />
      <div className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
        {visibleSessions.length ? visibleSessions.map((row, index) => (
          <div key={`${row?.provider || "provider"}-${row?.session_id || index}`} className="grid min-h-10 grid-cols-[minmax(132px,0.95fr)_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
            <span className="font-mono text-caption tabular-nums text-oai-gray-500">
              {formatActivityTimestamp(sessionActivityTimestamp(row))}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-oai-gray-700 dark:text-oai-gray-300">
              <ProviderLogo provider={row?.provider} size={16} className="shrink-0 text-oai-gray-700 dark:text-oai-gray-200" />
              <span className="min-w-0 truncate">{sessionLabel(row)}</span>
            </span>
            <span className="font-medium tabular-nums text-oai-black dark:text-white">
              {sessionMetric(row)}
            </span>
          </div>
        )) : visibleRows.length ? visibleRows.map((row, index) => (
          <div key={`${renderDate?.(row) || "row"}-${index}`} className="grid min-h-10 grid-cols-[minmax(88px,0.8fr)_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
            <span className="font-mono text-caption tabular-nums text-oai-gray-500">
              {renderDate?.(row)}
            </span>
            <span className="min-w-0 truncate text-oai-gray-700 dark:text-oai-gray-300">
              {row?.source ? String(row.source) : "Usage event"}
            </span>
            <span className="font-medium tabular-nums text-oai-black dark:text-white">
              {renderCell?.(row, "total_tokens")}
            </span>
          </div>
        )) : (
          <div className="rounded-xl border border-dashed border-oai-gray-200 p-6 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
            No recent activity for this period.
          </div>
        )}
      </div>
    </section>
  );
}

function attributionCoverage(stats) {
  const total = asNumber(stats?.total);
  if (total <= 0) return null;
  const trusted = asNumber(stats?.high) + asNumber(stats?.medium);
  return Math.max(0, Math.min(100, (trusted / total) * 100));
}

function AttributionGauge({ value }) {
  const pct = Math.max(0, Math.min(100, asNumber(value)));
  return (
    <svg className="h-20 w-36" viewBox="0 0 120 70" role="img" aria-label={`Attribution health ${Math.round(pct)} percent`}>
      <path
        d="M15 60 A45 45 0 0 1 105 60"
        fill="none"
        stroke="currentColor"
        strokeWidth="10"
        pathLength="100"
        className="text-oai-gray-100 dark:text-oai-gray-800"
      />
      <path
        d="M15 60 A45 45 0 0 1 105 60"
        fill="none"
        stroke="var(--brand-500)"
        strokeLinecap="round"
        strokeWidth="10"
        pathLength="100"
        strokeDasharray={`${pct} 100`}
      />
      <text
        x="60"
        y="55"
        textAnchor="middle"
        className="fill-oai-black text-[18px] font-semibold tabular-nums dark:fill-white"
      >
        {Math.round(pct)}%
      </text>
    </svg>
  );
}

function PeriodPicker({ period, periods = [], onPeriodChange, className = "" }) {
  if (!periods.length) return null;
  return (
    <div className={`inline-flex rounded-lg border border-[var(--vd-border)] bg-[var(--vd-tint)] p-0.5 ${className}`}>
      {periods.filter((item) => item !== "custom").map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onPeriodChange?.(item)}
          className={`h-8 rounded-md px-2.5 text-sm font-medium transition-colors sm:px-3 ${
            period === item
              ? "bg-[var(--glass-bg)] text-oai-black dark:text-white"
              : "text-oai-gray-500 hover:text-oai-black dark:hover:text-white"
          }`}
        >
          {PERIOD_LABELS[item] || item}
        </button>
      ))}
    </div>
  );
}

export function DashboardView(props) {
  const {
    screenshotMode,
    showExpiredGate,
    showAuthGate,
    identityDisplayName,
    hasDashboardUsage = true,
    syncFreshnessWarning,
    syncFreshnessSource,
    activeLiveSessions = 0,
    liveSessionsLoading = false,
    liveSessionsStale = false,
    recentSessionRows = [],
    attributionStats = null,
    attributionLoading = false,
    attentionInsight = null,
    summaryCostValue,
    summaryValue,
    summaryConversationsValue,
    fleetData = [],
    trendRowsForDisplay = [],
    periodsForDisplay,
    period,
    setSelectedPeriod,
    refreshAll,
    usageLoadingState,
    usageError,
    pagedDetails,
    renderDetailDate,
    renderDetailCell,
    costModalOpen,
    closeCostModal,
  } = props;
  const shouldReduceMotion = useReducedMotion();
  const providers = useMemo(() => fleetData.filter((entry) => asNumber(entry.usage) > 0), [fleetData]);
  const topProvider = providers[0] || null;
  const attentionProvider = providers.find((entry) => asNumber(entry.totalPercent) >= 70) || topProvider;
  const resolvedAttentionInsight =
    attentionInsight && typeof attentionInsight === "object" ? attentionInsight : null;
  const totalCost = summaryCostValue && summaryCostValue !== "-" ? summaryCostValue : "$0.00";
  const activeLabel = liveSessionsLoading ? "Loading" : liveSessionsStale ? "Stale" : `${activeLiveSessions}`;
  const identityName = typeof identityDisplayName === "string" ? identityDisplayName.trim() : "";
  const hasPersonalIdentity = Boolean(identityName && !["anonymous", "vibedeck"].includes(identityName.toLowerCase()));
  const headerTitle = hasPersonalIdentity ? `Welcome back, ${identityName}` : "VibeDeck dashboard";
  const attributionPercent = attributionCoverage(attributionStats);
  const attributionTotal = asNumber(attributionStats?.total);
  const unattributedSessions = asNumber(attributionStats?.unattributed ?? attributionStats?.unattributed_session_count);
  const attributionLabel = attributionLoading
    ? "Loading"
    : attributionPercent == null
      ? "Waiting"
      : `${Math.round(attributionPercent)}%`;
  const dataFreshness = (
    <FreshnessBadge
      timestamp={syncFreshnessSource}
      live={!syncFreshnessWarning && !usageError && !usageLoadingState && !liveSessionsStale}
      stale={Boolean(syncFreshnessWarning || usageError || liveSessionsStale)}
    />
  );
  const headerClawdState = useClawdState({
    activeSessionCount: activeLiveSessions,
    todayTokens: asNumber(summaryValue),
    isSyncing: Boolean(usageLoadingState),
    hasError: Boolean(usageError),
    hasLowConfidence: providers.length === 0 && activeLiveSessions > 0,
  });
  const showDashboardFirstRun = !usageLoadingState && !usageError && !hasDashboardUsage;

  const page = (
    <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
      {(showExpiredGate || showAuthGate) ? (
        <Surface className="mx-auto max-w-xl text-center">
          <ClawdAnimated state="mini-happy" size={80} className="mx-auto" />
          <h1 className="mt-4 text-h2 font-semibold text-oai-black dark:text-white">Welcome to VibeDeck</h1>
          <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Run any AI coding tool to start tracking.
          </p>
        </Surface>
      ) : (
        <motion.div
          initial={shouldReduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { type: "spring", mass: 0.6, stiffness: 240, damping: 28 }}
        >
          <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-h1 font-semibold text-oai-black dark:text-white">{headerTitle}</h1>
              <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {formatHeaderDate()}
              </p>
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              <PeriodPicker
                period={period}
                periods={periodsForDisplay}
                onPeriodChange={setSelectedPeriod}
                className="max-w-full"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={refreshAll}
                disabled={usageLoadingState}
                className="h-9 gap-2"
              >
                {usageLoadingState ? (
                  <span aria-hidden className="shimmer inline-block h-4 w-4 rounded-sm" />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                Sync
              </Button>
              <Link to="/settings" aria-label="Settings" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--vd-border)] text-oai-gray-500 no-underline hover:text-oai-black dark:hover:text-white">
                <Settings className="h-4 w-4" aria-hidden />
              </Link>
              <HeaderThemeMenu />
              {!showDashboardFirstRun ? <ClawdAnimated state={headerClawdState} size={48} /> : null}
            </div>
          </header>

          {syncFreshnessWarning || usageError ? (
            <div className="mb-4 flex min-h-10 items-center gap-2 rounded-lg border border-[var(--vd-border-strong)] bg-[var(--vd-tint)] px-3 text-sm text-oai-gray-700 dark:text-oai-gray-200">
              <AlertTriangle className="h-4 w-4 text-[var(--oai-warning)]" aria-hidden />
              <span>{syncFreshnessWarning || "Couldn't refresh data. Showing last-known values."}</span>
            </div>
          ) : null}

          {showDashboardFirstRun ? (
            <Surface className="mx-auto flex min-h-[360px] max-w-2xl flex-col items-center justify-center text-center">
              <ClawdAnimated state="mini-happy" size={80} className="mx-auto" />
              <h2 className="mt-5 text-h2 font-semibold text-oai-black dark:text-white">Welcome to VibeDeck</h2>
              <p className="mt-2 max-w-md text-sm text-oai-gray-500 dark:text-oai-gray-400">
                Run any AI coding tool to start tracking. VibeDeck listens automatically.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <Button type="button" variant="primary" size="sm" onClick={refreshAll}>
                  Detect now
                </Button>
                <a
                  href="https://github.com/ivasuy/VibeDeck#quick-start"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-9 items-center gap-1 rounded-lg px-3 text-sm font-medium text-[var(--brand-700)] no-underline hover:bg-[var(--vd-surface-hover)] dark:text-[var(--brand-300)]"
                >
                  Setup guide <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </a>
              </div>
            </Surface>
          ) : (
            <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <Surface className="border-transparent text-white" style={{ background: "var(--brand-600)" }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-label uppercase text-white/70">Today&apos;s spend</p>
                  <p className="mt-4 text-hero font-semibold tabular-nums">{totalCost}</p>
                  <p className="mt-2 text-sm text-white/75">
                    {summaryValue} tokens tracked
                  </p>
                </div>
                <span className="rounded-full bg-white/12 px-2.5 py-1">
                  <FreshnessBadge
                    timestamp={syncFreshnessSource}
                    live={!syncFreshnessWarning && !usageError && !usageLoadingState && !liveSessionsStale}
                    stale={Boolean(syncFreshnessWarning || usageError || liveSessionsStale)}
                    className="text-white/80 dark:text-white/80"
                  />
                </span>
              </div>
              <div className="mt-6">
                <SparklineBars values={trendRowsForDisplay} light />
              </div>
            </Surface>

            <Surface>
              <div className="flex items-start justify-between gap-3">
                <p className="text-label uppercase text-oai-gray-500 dark:text-oai-gray-400">Active sessions</p>
                {dataFreshness}
              </div>
              <p className="mt-4 text-h1 font-semibold tabular-nums text-oai-black dark:text-white">{activeLabel}</p>
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {summaryConversationsValue ? `${summaryConversationsValue} sessions in range` : "No sessions in this range"}
              </p>
              <div className="mt-5 flex gap-1.5" aria-hidden>
                {Array.from({ length: Math.max(1, Math.min(4, activeLiveSessions || 1)) }).map((_, index) => (
                  <span key={index} className={`h-2 w-2 rounded-full ${activeLiveSessions > 0 ? "bg-[var(--brand-500)]" : "bg-oai-gray-300 dark:bg-oai-gray-700"}`} />
                ))}
              </div>
            </Surface>
          </div>

          <div className="mt-4">
            <ProviderBreakdown providers={providers} freshness={dataFreshness} />
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
            <Surface>
              <SectionHeader title="Attribution health" action={dataFreshness} />
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-h2 font-semibold tabular-nums text-oai-black dark:text-white">
                    {attributionLabel}
                  </p>
                  <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                    {attributionTotal > 0
                      ? `${formatCompactNumber(attributionTotal, { decimals: 1 })} sessions · ${formatCompactNumber(unattributedSessions, { decimals: 1 })} need attribution`
                      : "Waiting for canonical sessions"}
                  </p>
                </div>
                {attributionPercent != null ? <AttributionGauge value={attributionPercent} /> : null}
              </div>
            </Surface>
            <Surface>
              <SectionHeader title="Needs attention" action={dataFreshness} />
              {resolvedAttentionInsight ? (
                <div>
                  <p className="font-semibold text-oai-black dark:text-white">
                    {resolvedAttentionInsight.title || "Needs attention"}
                  </p>
                  <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                    {resolvedAttentionInsight.body}
                  </p>
                </div>
              ) : attentionProvider ? (
                <div className="flex items-start gap-3">
                  <ProviderLogo provider={attentionProvider.label} size={24} className="mt-0.5 text-oai-gray-700 dark:text-oai-gray-200" />
                  <div className="min-w-0">
                    <p className="font-semibold text-oai-black dark:text-white">
                      {attentionProvider.label} is {safePercent(attentionProvider.totalPercent)} of tracked usage
                    </p>
                    <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                      {money(attentionProvider.usd)} · {formatCompactNumber(asNumber(attentionProvider.usage), { decimals: 1 })} tokens
                    </p>
                  </div>
                </div>
              ) : (
                <div>
                  <p className="font-semibold text-oai-black dark:text-white">
                    Cache opportunity
                  </p>
                  <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                    Keep recent work warm to reduce repeated token spend.
                  </p>
                </div>
              )}
            </Surface>
          </div>

          <div className="mt-6">
            <RecentActivity
              rows={pagedDetails}
              sessionRows={recentSessionRows}
              renderDate={renderDetailDate}
              renderCell={renderDetailCell}
            />
          </div>
            </>
          )}
        </motion.div>
      )}
    </div>
  );

  return (
    <>
      <Shell
        bare={!screenshotMode}
        hideHeader={screenshotMode}
        className={screenshotMode ? "screenshot-mode" : ""}
      >
        {page}
      </Shell>
      <CostAnalysisModal isOpen={costModalOpen} onClose={closeCostModal} fleetData={fleetData} />
    </>
  );
}
