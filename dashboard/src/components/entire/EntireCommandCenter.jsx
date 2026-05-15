import React from "react";
import { cn } from "../../lib/cn";
import { RepoPathSelector } from "./RepoPathSelector";
import { RecentReposPane } from "./RecentReposPane";
import { EntireStatusCard } from "./EntireStatusCard";

export function EntireCommandCenter({
  repoInput = "",
  onRepoInputChange,
  onRepoSubmit,
  repoSuggestions = [],
  selectedRepo = "",
  onRecentRepoSelect,
  onRecentRepoRemove,
  repoLoading = false,
  repoError = "",
  status = null,
  statusLoading = false,
  statusError = "",
  className = "",
}) {
  return (
    <section
      className={cn(
        "vd-card flex min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-glass backdrop-blur-[var(--glass-blur)]",
        className,
      )}
    >
      <header className="shrink-0 border-b border-[var(--vd-border)] px-5 py-4">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">Repo command center</h2>
        <p className="mt-1 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
          Load a project, check Entire status, and pick from recent repos before reviewing checkpoints.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
        <RepoPathSelector
          value={repoInput}
          onChange={onRepoInputChange}
          onSubmit={onRepoSubmit}
          suggestions={repoSuggestions}
          loading={repoLoading}
          error={repoError}
          description="Use an absolute repository path, then review the current status and recent project history."
        />

        <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <RecentReposPane
            className="min-h-[220px]"
            repos={repoSuggestions}
            selectedRepo={selectedRepo}
            onSelect={onRecentRepoSelect}
            onRemove={onRecentRepoRemove}
          />
          <div className="vd-card min-h-[220px] rounded-xl border border-oai-gray-200 bg-white p-3 dark:border-oai-gray-800 dark:bg-oai-gray-900">
            <div className="border-b border-[var(--vd-border)] px-0 pb-2">
              <h3 className="text-sm font-semibold text-oai-black dark:text-white">Status</h3>
            </div>
            <div className="pt-3">
              <EntireStatusCard status={status} loading={statusLoading} error={statusError} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
