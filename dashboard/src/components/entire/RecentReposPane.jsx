import React from "react";
import { X } from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { repoChipParts } from "./checkpoint-file-utils";

export function RecentReposPane({ repos = [], selectedRepo = "", onSelect, onRemove, className = "" }) {
  return (
    <aside
      aria-label={copy("entire.repo.suggestions.label")}
      className={cn(
        "vd-card flex h-full min-h-0 max-h-full flex-col overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900",
        className,
      )}
    >
      <div className="border-b border-[var(--vd-border)] px-3 py-2">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">
          {copy("entire.repo.suggestions.label")}
        </h2>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {repos.map((repo) => {
          const { name, context, fullPath } = repoChipParts(repo);
          const active = selectedRepo === repo;
          return (
            <div
              key={repo}
              className={cn(
                "mb-1 flex items-start gap-2 rounded-lg border px-2.5 py-1.5 last:mb-0",
                active
                  ? "border-oai-brand-500/40 bg-oai-brand-500/10"
                  : "vd-subcard border-oai-gray-200 dark:border-oai-gray-800",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                title={fullPath}
                aria-label={`Load recent repo ${name}`}
                onClick={() => onSelect?.(repo)}
              >
                <span className="block truncate text-sm font-medium text-oai-black dark:text-white">{name}</span>
                {context ? (
                  <span className="block truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">{context}</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Remove recent repo ${name}`}
                className="rounded p-1 text-oai-brand-400 hover:bg-oai-brand-50 hover:text-oai-brand-700 dark:text-oai-brand-300 dark:hover:bg-oai-brand-950/40 dark:hover:text-oai-brand-200"
                onClick={() => onRemove?.(repo)}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
