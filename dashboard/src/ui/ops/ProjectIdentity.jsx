import React from "react";
import { FolderKanban } from "lucide-react";
import { cn } from "../../lib/cn";

function basename(pathname = "") {
  const value = String(pathname || "").replace(/[\\/]+$/, "");
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || value || "—";
}

export function ProjectIdentity({ repoRoot, className = "" }) {
  const label = basename(repoRoot);

  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-oai-gray-200 bg-oai-black/[0.02] text-oai-gray-600 dark:border-oai-gray-800 dark:bg-white/[0.04] dark:text-oai-gray-300">
        <FolderKanban className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-oai-black dark:text-oai-white">{label}</div>
        <div
          className="truncate text-xs text-oai-gray-500 dark:text-oai-gray-400"
          title={repoRoot}
        >
          {repoRoot}
        </div>
      </div>
    </div>
  );
}
