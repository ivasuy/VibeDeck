import React, { useCallback, useEffect, useState } from "react";
import { copy } from "../lib/copy";
import { getBranchUsage, getCheckpoints, getEntireStatus, getKnownRepos, hideKnownRepo } from "../lib/vibedeck-api";
import { RepoPathSelector } from "../components/entire/RepoPathSelector";
import { EntireStatusCard } from "../components/entire/EntireStatusCard";
import { CheckpointList } from "../components/entire/CheckpointList";
import { EntireActionsPanel } from "../components/entire/EntireActionsPanel";
import { AdvancedConfigurePanel } from "../components/entire/AdvancedConfigurePanel";
import { EntireMaintenancePanel } from "../components/entire/EntireMaintenancePanel";
import { RecentReposPane } from "../components/entire/RecentReposPane";
import { PageFrame } from "../components/PageFrame.jsx";
import { cn } from "../lib/cn";

function WorkspacePanel({ title = "", subtitle = "", headerHidden = false, className = "", bodyClassName = "", children }) {
  return (
    <section className={cn(
      "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass",
      className,
    )}
    >
      {headerHidden ? null : (
        <header className="shrink-0 border-b border-[var(--glass-border)] px-4 py-3">
          {title ? <h2 className="text-sm font-semibold text-oai-black dark:text-white">{title}</h2> : null}
          {subtitle ? (
            <p className="mt-1 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">{subtitle}</p>
          ) : null}
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-auto p-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function EntirePage() {
  const [repoInput, setRepoInput] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [repoSuggestions, setRepoSuggestions] = useState([]);
  const [repoError, setRepoError] = useState("");

  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusData, setStatusData] = useState(null);

  const [checkpointsLoading, setCheckpointsLoading] = useState(false);
  const [checkpointsError, setCheckpointsError] = useState("");
  const [checkpointsData, setCheckpointsData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const extractRepos = (payload) => (Array.isArray(payload?.repos)
      ? payload.repos
        .map((entry) => String(entry?.repo_root || "").trim())
        .filter(Boolean)
      : []);

    getKnownRepos({ limit: 20 })
      .then((payload) => {
        if (cancelled) return;
        setRepoSuggestions(extractRepos(payload));
      })
      .catch(async () => {
        try {
          const payload = await getBranchUsage({ limit: 20 });
          if (!cancelled) setRepoSuggestions(extractRepos(payload));
        } catch {
          if (!cancelled) setRepoSuggestions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadRepo = useCallback(async (repoPath) => {
    const repo = String(repoPath || "").trim();
    if (!repo) {
      setRepoError(copy("entire.repo.validation.absolute_path"));
      return;
    }
    setRepoInput(repo);
    setRepoError("");
    setSelectedRepo(repo);
    setRepoSuggestions((prev) => {
      const existing = Array.isArray(prev) ? prev : [];
      if (existing.includes(repo)) return existing;
      return [repo, ...existing].slice(0, 20);
    });

    setStatusLoading(true);
    setStatusError("");
    setCheckpointsLoading(true);
    setCheckpointsError("");

    const [statusResult, checkpointsResult] = await Promise.allSettled([
      getEntireStatus(repo),
      getCheckpoints(repo),
    ]);

    if (statusResult.status === "fulfilled") {
      setStatusData(statusResult.value || null);
      setStatusError("");
    } else {
      const message = statusResult.reason instanceof Error
        ? statusResult.reason.message
        : copy("entire.status.error_fallback");
      setStatusData(null);
      setStatusError(message);
    }
    setStatusLoading(false);

    if (checkpointsResult.status === "fulfilled") {
      setCheckpointsData(checkpointsResult.value || null);
      setCheckpointsError("");
    } else {
      const message = checkpointsResult.reason instanceof Error
        ? checkpointsResult.reason.message
        : copy("entire.checkpoints.error_fallback");
      setCheckpointsData(null);
      setCheckpointsError(message);
    }
    setCheckpointsLoading(false);
  }, []);

  const refreshSelectedRepo = useCallback(async () => {
    if (!selectedRepo) return;
    await loadRepo(selectedRepo);
  }, [loadRepo, selectedRepo]);

  const removeRepo = useCallback(async (repoPath) => {
    const repo = String(repoPath || "").trim();
    if (!repo) return;
    try {
      await hideKnownRepo(repo);
      setRepoSuggestions((prev) => (Array.isArray(prev) ? prev.filter((item) => item !== repo) : []));
      if (selectedRepo === repo) {
        setSelectedRepo("");
        setRepoInput("");
        setStatusData(null);
        setStatusError("");
        setCheckpointsData(null);
        setCheckpointsError("");
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("entire.repo.validation.absolute_path");
      setRepoError(message);
    }
  }, [selectedRepo]);

  return (
    <PageFrame hideHeader compact maxWidth="max-w-[1760px]" contentClassName="h-full px-4 sm:px-5 lg:px-6">
      <div className="flex h-full min-h-0 max-h-full flex-col gap-3 overflow-hidden">
        <WorkspacePanel
          headerHidden
          className="shrink-0"
          bodyClassName="overflow-hidden p-4"
        >
          <RepoPathSelector
            value={repoInput}
            onChange={setRepoInput}
            onSubmit={loadRepo}
            suggestions={repoSuggestions}
            loading={statusLoading || checkpointsLoading}
            error={repoError}
            description={copy("entire.repo.subtitle")}
          />
        </WorkspacePanel>

        <div className="grid min-h-0 flex-1 gap-3 overflow-hidden xl:grid-cols-[220px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <RecentReposPane
              className="min-h-0 flex-1"
              repos={repoSuggestions}
              selectedRepo={selectedRepo}
              onSelect={loadRepo}
              onRemove={removeRepo}
            />
            <WorkspacePanel
              title={copy("entire.status.title")}
              className="shrink-0"
              bodyClassName="overflow-hidden p-4"
            >
              <EntireStatusCard status={statusData} loading={statusLoading} error={statusError} />
            </WorkspacePanel>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <WorkspacePanel
              headerHidden
              className="shrink-0"
              bodyClassName="overflow-hidden p-4"
            >
              <h2 className="sr-only">Controls</h2>
              {selectedRepo ? (
                <div className="grid min-h-0 gap-4 xl:grid-cols-[312px_minmax(0,1fr)_272px]">
                  <section className="min-h-0 overflow-hidden">
                    <h3 className="sr-only">Checkpoint id</h3>
                    <EntireMaintenancePanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
                  </section>

                  <section className="min-h-0 overflow-hidden border-t border-[var(--glass-border)] pt-4 xl:border-l xl:border-r xl:border-t-0 xl:px-4 xl:pt-0">
                    <h3 className="sr-only">Actions</h3>
                    <EntireActionsPanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
                  </section>

                  <section className="min-h-0 overflow-hidden border-t border-[var(--glass-border)] pt-4 xl:border-t-0 xl:pt-0">
                    <h3 className="sr-only">Configure</h3>
                    <AdvancedConfigurePanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
                  </section>
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
                  <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.actions.rewind.input_label")}</p>
                  <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.actions.empty")}</p>
                  <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.configure.empty")}</p>
                </div>
              )}
            </WorkspacePanel>

            <CheckpointList
              className={cn("min-h-0 flex-1")}
              repo={selectedRepo}
              checkpoints={checkpointsData}
              loading={checkpointsLoading}
              error={checkpointsError}
            />
          </div>
        </div>
      </div>
    </PageFrame>
  );
}
