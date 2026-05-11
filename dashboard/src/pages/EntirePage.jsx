import React, { useCallback, useEffect, useState } from "react";
import { copy } from "../lib/copy";
import { getBranchUsage, getCheckpoints, getEntireStatus, getKnownRepos } from "../lib/vibedeck-api";
import { RepoPathSelector } from "../components/entire/RepoPathSelector";
import { EntireStatusCard } from "../components/entire/EntireStatusCard";
import { CheckpointList } from "../components/entire/CheckpointList";
import { EntireActionsPanel } from "../components/entire/EntireActionsPanel";
import { AdvancedConfigurePanel } from "../components/entire/AdvancedConfigurePanel";
import { PageFrame } from "../components/PageFrame.jsx";
import { cn } from "../lib/cn";

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

  return (
    <PageFrame title={copy("entire.title")} subtitle={copy("entire.subtitle")} compact maxWidth="max-w-[1760px]">
      <div className="flex h-[calc(100dvh-124px)] min-h-0 flex-col gap-3 overflow-hidden">
        <RepoPathSelector
          className="shrink-0"
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={loadRepo}
          suggestions={repoSuggestions}
          loading={statusLoading || checkpointsLoading}
          error={repoError}
        />

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-3 overflow-hidden",
            selectedRepo ? "xl:grid-cols-[320px_minmax(0,1fr)]" : "lg:grid-cols-[360px_minmax(0,1fr)]",
          )}
        >
          <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
            <EntireStatusCard status={statusData} loading={statusLoading} error={statusError} />
            {selectedRepo ? (
              <>
                <EntireActionsPanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
                <AdvancedConfigurePanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
              </>
            ) : null}
          </div>
          <CheckpointList
            className="min-h-[360px]"
            repo={selectedRepo}
            checkpoints={checkpointsData}
            loading={checkpointsLoading}
            error={checkpointsError}
          />
        </div>
      </div>
    </PageFrame>
  );
}
