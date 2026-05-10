import React, { useCallback, useEffect, useState } from "react";
import { copy } from "../lib/copy";
import { getBranchUsage, getCheckpoints, getEntireStatus } from "../lib/vibedeck-api";
import { Button } from "../ui/openai/components";
import { RepoPathSelector } from "../components/entire/RepoPathSelector";
import { isAbsolutePath } from "../components/entire/RepoPathSelector";
import { EntireStatusCard } from "../components/entire/EntireStatusCard";
import { CheckpointList } from "../components/entire/CheckpointList";
import { EntireActionsPanel } from "../components/entire/EntireActionsPanel";
import { AdvancedConfigurePanel } from "../components/entire/AdvancedConfigurePanel";

const ENTIRE_SELECTED_REPO_KEY = "vibedeck.entire.selectedRepo";

function readStoredSelectedRepo() {
  if (typeof window === "undefined" || !window.localStorage) return "";
  try {
    return String(window.localStorage.getItem(ENTIRE_SELECTED_REPO_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeStoredSelectedRepo(repo) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (repo) window.localStorage.setItem(ENTIRE_SELECTED_REPO_KEY, repo);
    else window.localStorage.removeItem(ENTIRE_SELECTED_REPO_KEY);
  } catch {
    // Ignore storage failures in restricted browser modes.
  }
}

function formatLastRefreshed(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(value);
  } catch {
    return value.toLocaleString();
  }
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
  const [lastRefreshedAt, setLastRefreshedAt] = useState(null);

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

  useEffect(() => {
    const storedRepo = readStoredSelectedRepo();
    if (!storedRepo) return;
    setRepoInput(storedRepo);
    void loadRepo(storedRepo);
  }, []);

  const loadRepo = useCallback(async (repoPath) => {
    const repo = String(repoPath || "").trim();
    if (!repo || !isAbsolutePath(repo)) {
      setRepoError(copy("entire.repo.validation.absolute_path"));
      return;
    }
    setRepoInput(repo);
    setRepoError("");
    setSelectedRepo(repo);
    writeStoredSelectedRepo(repo);

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
    setLastRefreshedAt(new Date());
  }, []);

  const refreshSelectedRepo = useCallback(async () => {
    if (!selectedRepo) return;
    await loadRepo(selectedRepo);
  }, [loadRepo, selectedRepo]);

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <header className="mb-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-oai-black dark:text-white">{copy("entire.title")}</h1>
            <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.subtitle")}</p>
          </div>
          {selectedRepo ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={statusLoading || checkpointsLoading}
                onClick={() => void refreshSelectedRepo()}
              >
                {copy("entire.refresh.action")}
              </Button>
            </div>
          ) : null}
        </div>
        {lastRefreshedAt ? (
          <p className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.refresh.last", { time: formatLastRefreshed(lastRefreshedAt) })}
          </p>
        ) : null}
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

        {selectedRepo ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <EntireActionsPanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
            <AdvancedConfigurePanel repo={selectedRepo} onActionSuccess={refreshSelectedRepo} />
          </div>
        ) : null}
      </div>
    </main>
  );
}
