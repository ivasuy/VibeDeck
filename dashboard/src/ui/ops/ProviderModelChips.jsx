import React from "react";
import { cn } from "../../lib/cn";
import { toDisplayNumber } from "../../lib/format";
import { ProviderIcon } from "../matrix-a/components/ProviderIcon.jsx";

export function ProviderModelChips({ items = [], className = "" }) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {rows.map((item, index) => {
        const provider = String(item.provider || "unknown");
        const model = String(item.model || "—");
        const tokens = item.total_tokens != null ? toDisplayNumber(item.total_tokens) : null;

        return (
          <div
            key={`${provider}-${model}-${index}`}
            className="inline-flex min-w-0 items-center gap-2 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] px-2.5 py-1.5 dark:border-oai-gray-800 dark:bg-white/[0.04]"
          >
            <ProviderIcon provider={provider} size={14} className="shrink-0 text-oai-gray-700 dark:text-oai-gray-300" />
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-oai-black dark:text-oai-white">{model}</div>
              <div className="truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                {provider}
                {tokens ? ` • ${tokens}` : ""}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
