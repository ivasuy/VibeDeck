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
        "vd-card grid min-h-[260px] overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-glass backdrop-blur-[var(--glass-blur)]",
        className,
      )}
    >
      <div className="grid min-h-0 gap-4 overflow-hidden p-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.9fr)_minmax(320px,0.85fr)]">
        <div className="min-h-0 overflow-auto rounded-xl border border-[var(--vd-border)] bg-white/70 p-4 dark:bg-oai-gray-900/55">
          <RepoPathSelector
            value={repoInput}
            onChange={onRepoInputChange}
            onSubmit={onRepoSubmit}
            suggestions={repoSuggestions}
            loading={repoLoading}
            error={repoError}
            description="Use an absolute repository path, then review status and checkpoint history in the panels below."
          />
        </div>
        <RecentReposPane
          className="min-h-0"
          repos={repoSuggestions}
          selectedRepo={selectedRepo}
          onSelect={onRecentRepoSelect}
          onRemove={onRecentRepoRemove}
        />
        <div className="vd-card grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
          <div className="border-b border-[var(--vd-border)] px-4 py-3">
            <h3 className="text-sm font-semibold text-oai-black dark:text-white">Status</h3>
          </div>
          <div className="min-h-0 overflow-auto p-4">
            <EntireStatusCard status={status} loading={statusLoading} error={statusError} />
          </div>
        </div>
      </div>
    </section>
  );
}
