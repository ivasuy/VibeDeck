import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Database, FolderGit2, PencilLine } from "lucide-react";
import { Card } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { getAttributionStats, getEntireStatus, getSyncStatus } from "../lib/vibedeck-api";
import { getSyncFreshnessWarning } from "../lib/sync-freshness";
import { useVibeDeckLiveSessions } from "../hooks/use-vibedeck-live-sessions";
import { useUsageLimits } from "../hooks/use-usage-limits";
import { LiveOperationsPanel } from "../components/live/LiveOperationsPanel";
import { LiveWorkbenchOverview } from "../components/live/LiveWorkbenchOverview";
import { LiveBranchSignalMap } from "../components/live/LiveBranchSignalMap";
import { BranchOverridePanel } from "../components/live/BranchOverridePanel";
import { PageFrame } from "../components/PageFrame.jsx";

function sessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function isActiveSession(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function entireStateLabel(state) {
  if (state === "not_installed") return copy("entire.state.not_installed");
  if (state === "not_enabled") return copy("entire.state.not_enabled");
  if (state === "enabled_no_commits") return copy("entire.state.enabled_no_commits");
  if (state === "active") return copy("entire.state.active");
  return copy("entire.state.unknown");
}

function stateClass(state) {
  if (state === "active") return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (state === "not_installed") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (state === "enabled_no_commits") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-oai-black/[0.06] text-oai-gray-700 dark:bg-white/[0.12] dark:text-oai-gray-200";
}

function RepoEntireCard({ session, status, loading, error }) {
  const repo = String(session?.repo_root || "");
  const state = String(status?.state || "");

  return (
    <Card className="h-[178px] overflow-hidden" bodyClassName="h-full overflow-auto">
      <div className="flex items-center gap-2">
        <FolderGit2 className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">
          {copy("live.repo_state.title")}
        </h2>
      </div>
      {!repo ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("live.repo_state.empty")}
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="vd-subcard rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
              <Database className="h-3.5 w-3.5" aria-hidden />
              Repo
            </div>
            <div className="truncate font-medium text-oai-black dark:text-white" title={repo}>{repo}</div>
          </div>
          <div className="vd-subcard flex items-center justify-between gap-3 rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <span className="flex items-center gap-1.5">
              <Box className="h-3.5 w-3.5" aria-hidden />
              Entire
            </span>
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
      <div className="flex items-center gap-2">
        <PencilLine className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.override.title")}</h2>
      </div>
      <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        Select a live session to correct branch attribution.
      </p>
    </Card>
  );
}

export function LivePage() {
  const { sessions, status, error } = useVibeDeckLiveSessions();
  const {
    data: usageLimits,
    error: limitsError,
    isLoading: limitsLoading,
  } = useUsageLimits({ initialRefresh: true });
  const [selectedKey, setSelectedKey] = useState(null);
  const [syncWarning, setSyncWarning] = useState(null);
  const [entireStatus, setEntireStatus] = useState(null);
  const [entireLoading, setEntireLoading] = useState(false);
  const [entireError, setEntireError] = useState("");

  const refreshAttributionStats = useCallback(async () => {
    try {
      await getAttributionStats();
    } catch (_cause) {
      // The live stream remains the source of truth for visible dashboard data.
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
      const activeSession = sessions.find(isActiveSession);
      setSelectedKey(sessionKey(activeSession || sessions[0]));
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

  return (
    <PageFrame
      maxWidth="max-w-[1760px]"
      hideHeader
    >
      {syncWarning ? (
        <div className="mb-4 inline-flex min-h-8 items-center rounded-md border border-amber-300/60 bg-amber-50/60 px-3 text-xs text-amber-800 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-200">
          {syncWarning}
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="grid min-w-0 gap-6">
          <LiveWorkbenchOverview
            sessions={sessions}
            status={status}
            limits={usageLimits}
          />
          <LiveOperationsPanel
            sessions={sessions}
            selectedKey={selectedKey}
            onSelectSession={setSelectedKey}
            streamStatus={status}
            streamError={error}
            limits={usageLimits}
            limitsLoading={limitsLoading}
            limitsError={limitsError}
          />
        </section>
        <aside className="grid auto-rows-max content-start items-start gap-6">
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
          <LiveBranchSignalMap sessions={sessions} />
        </aside>
      </div>
    </PageFrame>
  );
}
