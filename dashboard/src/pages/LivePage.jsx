import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { getAttributionStats, getEntireStatus, getSyncStatus } from "../lib/vibedeck-api";
import { getSyncFreshnessWarning } from "../lib/sync-freshness";
import { useVibeDeckLiveSessions } from "../hooks/use-vibedeck-live-sessions";
import { LiveSessionList } from "../components/live/LiveSessionList";
import { AttributionHealthCard } from "../components/live/AttributionHealthCard";
import { BranchOverridePanel } from "../components/live/BranchOverridePanel";
import { PageFrame } from "../components/PageFrame.jsx";

function sessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function entireStateLabel(state) {
  if (state === "not_installed") return copy("entire.state.not_installed");
  if (state === "not_enabled") return copy("entire.state.not_enabled");
  if (state === "enabled_no_commits") return copy("entire.state.enabled_no_commits");
  if (state === "active") return copy("entire.state.active");
  return copy("entire.state.unknown");
}

function stateClass(state) {
  if (state === "active") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (state === "not_installed") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (state === "enabled_no_commits") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-oai-black/[0.06] text-oai-gray-700 dark:bg-white/[0.12] dark:text-oai-gray-200";
}

function RepoEntireCard({ session, status, loading, error }) {
  const repo = String(session?.repo_root || "");
  const state = String(status?.state || "");

  return (
    <Card className="h-[178px] overflow-hidden" bodyClassName="h-full overflow-auto">
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">
        {copy("live.repo_state.title")}
      </h2>
      {!repo ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("live.repo_state.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">Repo</div>
            <div className="truncate font-medium text-oai-black dark:text-white" title={repo}>{repo}</div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <span>Entire</span>
            {loading ? (
              <span className="font-medium text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.status.loading")}</span>
            ) : error ? (
              <span className="truncate pl-2 text-right font-medium text-red-700 dark:text-red-300" title={error}>{error}</span>
            ) : (
              <span className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${stateClass(state)}`}>
                {entireStateLabel(state)}
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function BranchOverridePlaceholder() {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.override.title")}</h2>
      <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        Select a live session to correct branch attribution.
      </p>
    </Card>
  );
}

export function LivePage() {
  const { sessions, status, error } = useVibeDeckLiveSessions();
  const [selectedKey, setSelectedKey] = useState(null);
  const [attributionStats, setAttributionStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(null);
  const [syncWarning, setSyncWarning] = useState(null);
  const [entireStatus, setEntireStatus] = useState(null);
  const [entireLoading, setEntireLoading] = useState(false);
  const [entireError, setEntireError] = useState("");

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
      setSelectedKey(sessionKey(sessions[0]));
    }
  }, [sessions, selectedKey]);

  const selectedSession = useMemo(
    () => sessions.find((row) => sessionKey(row) === selectedKey) || null,
    [sessions, selectedKey],
  );

  useEffect(() => {
    const repo = String(selectedSession?.repo_root || "");
    if (!repo) {
      setEntireStatus(null);
      setEntireError("");
      setEntireLoading(false);
      return;
    }
    let active = true;
    setEntireLoading(true);
    setEntireError("");
    getEntireStatus(repo)
      .then((payload) => {
        if (!active) return;
        setEntireStatus(payload || null);
      })
      .catch((cause) => {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : copy("entire.status.error_fallback");
        setEntireError(message);
        setEntireStatus(null);
      })
      .finally(() => {
        if (active) setEntireLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedSession?.repo_root]);

  const streamStatusLabel = useMemo(() => {
    if (status === "connected") return copy("live.status.connected");
    if (status === "connecting") return copy("live.status.connecting");
    if (status === "degraded") return copy("live.status.degraded");
    return copy("live.status.idle");
  }, [status]);

  return (
    <PageFrame
      title={copy("live.title")}
      subtitle={copy("live.subtitle")}
      actions={(
        <div className="inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-3 text-xs font-medium text-oai-gray-700 ring-1 ring-oai-black/10 dark:bg-white/[0.08] dark:text-oai-gray-200 dark:ring-white/10">
          {streamStatusLabel}
        </div>
      )}
    >
      {syncWarning ? (
        <div className="-mt-4 mb-4 inline-flex min-h-8 items-center rounded-md border border-amber-300/60 bg-amber-50/60 px-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
          {syncWarning}
        </div>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="min-w-0">
          <LiveSessionList
            sessions={sessions}
            selectedKey={selectedKey}
            onSelectSession={setSelectedKey}
            streamStatus={status}
            streamError={error}
          />
        </section>
        <aside className="grid auto-rows-max content-start items-start gap-4">
          <AttributionHealthCard
            stats={attributionStats}
            sessions={sessions}
            loading={statsLoading}
            error={statsError}
          />
          {selectedSession ? (
            <BranchOverridePanel
              session={selectedSession}
              onSuccess={refreshAttributionStats}
            />
          ) : (
            <BranchOverridePlaceholder />
          )}
          <RepoEntireCard
            session={selectedSession}
            status={entireStatus}
            loading={entireLoading}
            error={entireError}
          />
        </aside>
      </div>
    </PageFrame>
  );
}
