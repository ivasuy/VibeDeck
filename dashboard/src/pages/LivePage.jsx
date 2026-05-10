import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { getAttributionStats, getSyncStatus } from "../lib/vibedeck-api";
import { getSyncFreshnessWarning } from "../lib/sync-freshness";
import { useVibeDeckLiveSessions } from "../hooks/use-vibedeck-live-sessions";
import { AttributionHealthCard } from "../components/live/AttributionHealthCard";
import { BranchOverridePanel } from "../components/live/BranchOverridePanel";
import { LiveProjectWorkbench } from "../components/live/LiveProjectWorkbench";
import { LiveSessionDetailPanel } from "../components/live/LiveSessionDetailPanel";

function sessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function isActiveRow(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

export function LivePage() {
  const { sessions, status, error } = useVibeDeckLiveSessions();
  const [selectedKey, setSelectedKey] = useState(null);
  const [attributionStats, setAttributionStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);
  const [syncWarning, setSyncWarning] = useState(null);

  const refreshAttributionStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      const payload = await getAttributionStats();
      setAttributionStats(payload || null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("live.override.error.fallback");
      setStatsError(message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshAttributionStats();
  }, [refreshAttributionStats]);

  const visibleSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions.filter(isActiveRow) : []),
    [sessions],
  );

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
    if (!Array.isArray(visibleSessions) || visibleSessions.length === 0) {
      if (selectedKey !== null) setSelectedKey(null);
      return;
    }
    const existing = selectedKey != null
      ? visibleSessions.some((row) => sessionKey(row) === selectedKey)
      : false;
    if (!existing) {
      setSelectedKey(sessionKey(visibleSessions[0]));
    }
  }, [selectedKey, visibleSessions]);

  const selectedSession = useMemo(
    () => visibleSessions.find((row) => sessionKey(row) === selectedKey) || null,
    [selectedKey, visibleSessions],
  );

  const streamStatusLabel = useMemo(() => {
    if (status === "connected") return copy("live.status.connected");
    if (status === "connecting") return copy("live.status.connecting");
    if (status === "degraded") return copy("live.status.degraded");
    return copy("live.status.idle");
  }, [status]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-oai-black dark:text-white">{copy("live.title")}</h1>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("live.subtitle")}</p>
          {syncWarning ? (
            <div className="mt-2 inline-flex min-h-8 items-center rounded-md border border-amber-300/60 bg-amber-50/60 px-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
              {syncWarning}
            </div>
          ) : null}
        </div>
        <div className="inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-3 text-xs font-medium text-oai-gray-700 ring-1 ring-oai-black/10 dark:bg-white/[0.08] dark:text-oai-gray-200 dark:ring-white/10">
          {streamStatusLabel}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="grid min-w-0 content-start gap-4">
          <LiveProjectWorkbench
            sessions={visibleSessions}
            selectedKey={selectedKey}
            onSelectSession={setSelectedKey}
            streamStatus={status}
            streamError={error}
          />
        </section>
        <aside className="grid content-start gap-4">
          <LiveSessionDetailPanel session={selectedSession} />
          <AttributionHealthCard
            stats={attributionStats}
            loading={statsLoading}
            error={statsError}
          />
          {selectedSession ? (
            <BranchOverridePanel
              session={selectedSession}
              onSuccess={refreshAttributionStats}
            />
          ) : null}
          <Card>
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("live.repo_state.title")}
            </h2>
            {selectedSession?.repo_root ? (
              <p className="mt-2 truncate text-sm text-oai-gray-500 dark:text-oai-gray-400" title={selectedSession.repo_root}>
                {copy("live.repo_state.selected", { repo: selectedSession.repo_root })}
              </p>
            ) : (
              <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("live.repo_state.empty")}
              </p>
            )}
          </Card>
        </aside>
      </div>
    </main>
  );
}
