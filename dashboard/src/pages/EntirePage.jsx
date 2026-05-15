import React, { useCallback, useEffect, useRef, useState } from "react";
import { copy } from "../lib/copy";
import { getBranchUsage, getCheckpoints, getEntireStatus, getKnownRepos, hideKnownRepo } from "../lib/vibedeck-api";
import { EntireCommandCenter } from "../components/entire/EntireCommandCenter";
import { CheckpointTimeline } from "../components/entire/CheckpointTimeline";
import { EntireControlPanel } from "../components/entire/EntireControlPanel";
import { PageFrame } from "../components/PageFrame.jsx";

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
  const loadSeqRef = useRef(0);

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
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
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

    if (loadSeqRef.current !== seq) return;

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
    <PageFrame hideHeader compact maxWidth="max-w-[1760px]">
      <div className="flex h-full min-h-0 max-h-full flex-col gap-5 overflow-y-auto overflow-x-hidden pr-1">
        <EntireCommandCenter
          repoInput={repoInput}
          onRepoInputChange={setRepoInput}
          onRepoSubmit={loadRepo}
          repoSuggestions={repoSuggestions}
          selectedRepo={selectedRepo}
          onRecentRepoSelect={loadRepo}
          onRecentRepoRemove={removeRepo}
          repoLoading={statusLoading || checkpointsLoading}
          repoError={repoError}
          status={statusData}
          statusLoading={statusLoading}
          statusError={statusError}
        />

        <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
          <CheckpointTimeline
            repo={selectedRepo}
            checkpoints={checkpointsData}
            loading={checkpointsLoading}
            error={checkpointsError}
            className="min-h-0"
          />
          <EntireControlPanel
            repo={selectedRepo}
            onActionSuccess={refreshSelectedRepo}
            className="sticky top-5 self-start"
          />
        </div>
      </div>
    </PageFrame>
  );
}
