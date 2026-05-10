import React, { useCallback, useEffect, useState } from "react";
import { copy } from "../lib/copy";
import { getBranchUsage, getCheckpoints, getEntireStatus } from "../lib/vibedeck-api";
import { RepoPathSelector } from "../components/entire/RepoPathSelector";
import { EntireStatusCard } from "../components/entire/EntireStatusCard";
import { CheckpointList } from "../components/entire/CheckpointList";

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
    getBranchUsage({ limit: 20 })
      .then((payload) => {
        if (cancelled) return;
        const repos = Array.isArray(payload?.repos)
          ? payload.repos
            .map((entry) => String(entry?.repo_root || "").trim())
            .filter(Boolean)
          : [];
        setRepoSuggestions(repos);
      })
      .catch(() => {
        if (!cancelled) setRepoSuggestions([]);
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

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <header className="mb-4 min-w-0">
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">{copy("entire.title")}</h1>
        <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.subtitle")}</p>
      </header>

      <div className="grid gap-4">
        <RepoPathSelector
          value={repoInput}
          onChange={setRepoInput}
          onSubmit={loadRepo}
          suggestions={repoSuggestions}
          loading={statusLoading || checkpointsLoading}
          error={repoError}
        />

        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <EntireStatusCard status={statusData} loading={statusLoading} error={statusError} />
          <CheckpointList
            repo={selectedRepo}
            checkpoints={checkpointsData}
            loading={checkpointsLoading}
            error={checkpointsError}
          />
        </div>
      </div>
    </main>
  );
}
