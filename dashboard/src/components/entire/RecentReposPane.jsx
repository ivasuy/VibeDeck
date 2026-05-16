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
        "vd-card grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900",
        className,
      )}
    >
      <div className="border-b border-[var(--vd-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">
          {copy("entire.repo.suggestions.label")}
        </h2>
      </div>
      <div className="min-h-0 overflow-auto">
        {repos.map((repo) => {
          const { name, context, fullPath } = repoChipParts(repo);
          const active = selectedRepo === repo;
          return (
            <div
              key={repo}
              className={cn(
                "group flex items-start gap-2 border-b border-[var(--vd-border)] px-4 py-3 last:border-b-0",
                active
                  ? "bg-oai-brand-500/10 shadow-[inset_3px_0_0_rgba(99,102,241,0.75)]"
                  : "bg-transparent transition-colors hover:bg-oai-black/[0.025] dark:hover:bg-white/[0.04]",
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                title={fullPath}
                aria-label={`Load recent repo ${name}`}
                onClick={() => onSelect?.(repo)}
              >
                <span className="block break-words text-sm font-semibold leading-5 text-oai-black dark:text-white">{name}</span>
                {context ? (
                  <span className="mt-1 block break-all font-mono text-[11px] leading-4 text-oai-gray-500 dark:text-oai-gray-400">{context}</span>
                ) : null}
              </button>
              <button
                type="button"
                aria-label={`Remove recent repo ${name}`}
                className="rounded-md p-1 text-oai-gray-400 opacity-70 transition hover:bg-oai-brand-50 hover:text-oai-brand-700 hover:opacity-100 dark:text-oai-gray-500 dark:hover:bg-oai-brand-950/40 dark:hover:text-oai-brand-200"
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
