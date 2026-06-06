import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { copy } from "../lib/copy";
import {
  getAttributionStats,
  getLiveSessionsSnapshot,
  getSyncStatus,
  resolveProjectionReadinessState,
} from "../lib/vibedeck-api";
import { getSyncFreshnessWarning } from "../lib/sync-freshness";
import { useVibeDeckLiveSessions } from "../hooks/use-vibedeck-live-sessions";
import { useUsageLimits } from "../hooks/use-usage-limits";
import { LiveWorkbenchOverview } from "../components/live/LiveWorkbenchOverview";
import { LiveBranchSignalMap } from "../components/live/LiveBranchSignalMap";
import { BranchOverridePanel } from "../components/live/BranchOverridePanel";
import { AttributionHealthCard } from "../components/live/AttributionHealthCard";
import { LiveProviderLimitsGrid } from "../components/live/LiveProviderLimitsGrid";
import { LiveSessionList } from "../components/live/LiveSessionList";
import { ConfidenceBadge } from "../components/live/ConfidenceBadge";
import { PageShell, SectionHeader } from "../components/RevampSurfaces.jsx";
import { ProviderLogo } from "../lib/provider-logos.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";

function sessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function isActiveSession(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function repoName(row) {
  const raw = String(row?.repo_root || row?.cwd || "").replace(/\\/g, "/");
  const parts = raw.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Unknown project";
}

function rowTime(row) {
  const raw = row?.last_observed_at || row?.observed_at || row?.updated_at || row?.started_at;
  if (!raw) return "-";
  const ts = Date.parse(String(raw));
  if (!Number.isFinite(ts)) return "-";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts));
}

function rowCost(row) {
  const n = Number(row?.estimated_total_cost_usd ?? row?.total_cost_usd);
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "$0";
  return formatUsdCurrency(n.toFixed(2), { decimals: 2 });
}

function ReadinessBadge({ state }) {
  if (!state?.label) return null;
  const toneClass = state.tone === "indexing"
    ? "border-amber-300/60 bg-amber-50/60 text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200"
    : "border-[var(--vd-border)] bg-[var(--vd-tint)] text-oai-gray-600 dark:text-oai-gray-300";
  return (
    <span className={`inline-flex h-8 items-center rounded-md border px-3 text-caption font-semibold uppercase ${toneClass}`}>
      {state.label}
    </span>
  );
}

function LiveOperationsTable({ sessions = [] }) {
  const rows = Array.isArray(sessions) ? sessions.slice(0, 50) : [];
  if (rows.length === 0) return null;
  return (
    <section className="mt-6">
      <SectionHeader title="Operations" />
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--vd-border)] text-caption font-semibold uppercase text-oai-gray-500 dark:text-oai-gray-400">
              <th className="py-2 pr-4">Time</th>
              <th className="py-2 pr-4">Provider</th>
              <th className="py-2 pr-4">Project</th>
              <th className="py-2 pr-4">Branch</th>
              <th className="py-2 pr-4 text-right">Tokens</th>
              <th className="py-2 pr-4 text-right">Cost</th>
              <th className="py-2 text-right">Conf</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
            {rows.map((row, index) => (
              <tr key={sessionKey(row) || index} className="h-11">
                <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">{rowTime(row)}</td>
                <td className="py-2 pr-4">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <ProviderLogo provider={row?.provider} size={16} className="text-oai-gray-700 dark:text-oai-gray-200" />
                    <span className="truncate text-oai-gray-700 dark:text-oai-gray-200">{String(row?.provider || "unknown")}</span>
                  </span>
                </td>
                <td className="max-w-[220px] truncate py-2 pr-4 text-oai-black dark:text-white">{repoName(row)}</td>
                <td className="max-w-[220px] truncate py-2 pr-4 text-oai-gray-600 dark:text-oai-gray-300">{String(row?.branch || "unrouted")}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(row?.total_tokens ?? 0)}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{rowCost(row)}</td>
                <td className="py-2 text-right"><ConfidenceBadge confidence={row?.confidence} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BranchOverrideDrawer({ session, onClose, onSuccess }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!session) return undefined;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, session]);

  if (!session) return null;

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button
        type="button"
        className="absolute inset-0 h-full w-full cursor-default bg-black/30"
        aria-label="Close branch override"
        onClick={onClose}
      />
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-override-drawer-title"
        className="fixed inset-y-0 right-0 flex w-full flex-col border-l border-[var(--vd-border-strong)] bg-[var(--vd-card-bg-solid)] shadow-[var(--vd-shadow)] sm:w-[480px]"
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-oai-gray-200 px-6 dark:border-oai-gray-800">
          <div>
            <h2 id="branch-override-drawer-title" className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("live.override.title")}
            </h2>
            <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">Correct attribution for the selected session.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Close branch override"
            onClick={onClose}
            className="vd-control inline-flex h-8 w-8 items-center justify-center rounded-md border border-oai-gray-200 text-oai-gray-600 transition-colors hover:border-oai-brand-300 hover:text-oai-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60 dark:border-oai-gray-800 dark:text-oai-gray-300 dark:hover:border-oai-brand-500 dark:hover:text-oai-brand-300"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4">
          <BranchOverridePanel session={session} onSuccess={onSuccess} surface={false} />
        </div>
      </section>
    </div>
  );
}

export function LivePage() {
  const {
    sessions,
    workstreams,
    totals,
    status,
    error,
    canonicalIncomplete,
    initialLoading,
    reconnecting,
    stale,
    generatedAt,
    lastSyncAt,
  } = useVibeDeckLiveSessions();
  const {
    data: usageLimits,
    error: limitsError,
    isLoading: limitsLoading,
  } = useUsageLimits({ initialRefresh: true });
  const [selectedKey, setSelectedKey] = useState(() => {
    if (typeof window === "undefined") return null;
    const session = new URLSearchParams(window.location.search).get("session");
    return session ? String(session) : null;
  });
  const [syncWarning, setSyncWarning] = useState(null);
  const [attributionStats, setAttributionStats] = useState(null);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [attributionError, setAttributionError] = useState("");
  const [overrideSession, setOverrideSession] = useState(null);
  const [readinessState, setReadinessState] = useState(null);
  const refreshAttributionStats = useCallback(async () => {
    setAttributionLoading(true);
    setAttributionError("");
    try {
      setAttributionStats(await getAttributionStats());
    } catch (cause) {
      setAttributionError(cause instanceof Error ? cause.message : "Failed to load attribution stats");
      // The live stream remains the source of truth for visible dashboard data.
    } finally {
      setAttributionLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAttributionStats();
  }, [refreshAttributionStats]);

  useEffect(() => {
    let active = true;
    getLiveSessionsSnapshot()
      .then((payload) => {
        if (active) setReadinessState(resolveProjectionReadinessState(payload?.freshness));
      })
      .catch(() => {
        if (active) setReadinessState(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const payload = await getSyncStatus();
        if (!active) return;
        setSyncWarning(getSyncFreshnessWarning(payload));
      } catch (_err) {
        if (!active) return;
        setSyncWarning(null);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!Array.isArray(sessions) || sessions.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    const existing = selectedKey != null
      ? sessions.some((row) => sessionKey(row) === selectedKey)
      : false;
    if (!existing) {
      const activeSession = sessions.find(isActiveSession);
      setSelectedKey(sessionKey(activeSession || sessions[0]));
    }
  }, [sessions, selectedKey]);

  const activeCount = useMemo(
    () => (Array.isArray(sessions) ? sessions.filter(isActiveSession).length : 0),
    [sessions],
  );
  const liveFreshnessTimestamp = generatedAt || lastSyncAt || sessions[0]?.last_observed_at || sessions[0]?.observed_at || sessions[0]?.updated_at || null;

  useEffect(() => {
    if (!overrideSession || !Array.isArray(sessions) || sessions.length === 0) return;
    const key = sessionKey(overrideSession);
    if (!key || sessions.some((row) => sessionKey(row) === key)) return;
    setOverrideSession(null);
  }, [overrideSession, sessions]);

  return (
    <PageShell
      title="Live"
      subtitle="Active sessions, branch confidence, and correction controls."
      actions={
        <>
          <ReadinessBadge state={readinessState} />
          <span className="inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--vd-border)] px-3 text-caption font-semibold uppercase text-oai-gray-700 dark:text-oai-gray-200">
            <span className={`h-2 w-2 rounded-full ${activeCount > 0 ? "bg-[var(--brand-500)]" : "bg-oai-gray-300 dark:bg-oai-gray-700"}`} />
            {activeCount} active
          </span>
        </>
      }
    >
      {syncWarning ? (
        <div className="mb-4 inline-flex min-h-8 items-center rounded-md border border-amber-300/60 bg-amber-50/60 px-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
          {syncWarning}
        </div>
      ) : null}
      {reconnecting || stale ? (
        <div className="mb-4 inline-flex min-h-8 items-center rounded-md border border-oai-gray-200 bg-oai-gray-50/70 px-3 text-xs text-oai-gray-700 dark:border-oai-gray-800 dark:bg-oai-gray-900/60 dark:text-oai-gray-300">
          {reconnecting ? "Reconnecting live stream; showing last data." : "Showing cached live data while VibeDeck refreshes."}
        </div>
      ) : null}

      <LiveWorkbenchOverview
        sessions={sessions}
        workstreams={workstreams}
        totals={totals}
        canonicalIncomplete={canonicalIncomplete}
        status={status}
        limits={usageLimits}
        initialLoading={initialLoading}
        freshnessTimestamp={liveFreshnessTimestamp}
        stale={stale || reconnecting}
      />

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <LiveSessionList
          sessions={sessions}
          workstreams={workstreams}
          totals={totals}
          selectedKey={selectedKey}
          onSelectSession={setSelectedKey}
          streamStatus={status}
          streamError={error}
          initialLoading={initialLoading}
          onOpenBranchOverride={(session) => {
            const key = sessionKey(session);
            if (key) setSelectedKey(key);
            setOverrideSession(session);
          }}
          className="h-[620px] min-h-0"
        />
        <aside className="grid auto-rows-max content-start items-start gap-5">
          <AttributionHealthCard
            stats={attributionStats}
            sessions={sessions}
            loading={attributionLoading}
            error={attributionError}
            freshnessTimestamp={liveFreshnessTimestamp}
            stale={stale || reconnecting}
          />
          <LiveProviderLimitsGrid
            sessions={sessions}
            limits={usageLimits}
            loading={limitsLoading}
            error={limitsError}
            freshnessTimestamp={liveFreshnessTimestamp}
            stale={stale || reconnecting}
            className="h-auto max-h-[420px]"
          />
        </aside>
      </div>

      <div className="mt-6">
        <LiveBranchSignalMap sessions={sessions} />
      </div>
      <LiveOperationsTable sessions={sessions} />
      <BranchOverrideDrawer
        session={overrideSession}
        onClose={() => setOverrideSession(null)}
        onSuccess={refreshAttributionStats}
      />
    </PageShell>
  );
}
