import React from "react";
import { cn } from "../../lib/cn";
import { Card } from "../openai/components";
import { IconBadge } from "./IconBadge";

function MetricStripItem({ item }) {
  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-lg border border-oai-gray-200/80 bg-oai-black/[0.02] px-3 py-2.5 dark:border-oai-gray-800/80 dark:bg-white/[0.04]",
        item.className,
      )}
    >
      <IconBadge accent={item.accent} label={item.label} className="row-span-2 self-start" />
      <div className="min-w-0 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        {item.label}
      </div>
      <div className="min-w-0 truncate text-sm font-semibold text-oai-black dark:text-oai-white">
        {item.value}
      </div>
      {item.detail ? (
        <div className="col-start-2 min-w-0 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {item.detail}
        </div>
      ) : null}
    </div>
  );
}

export function MetricStrip({ items = [], className = "", contentClassName = "" }) {
  const rows = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!rows.length) return null;

  return (
    <Card className={className} bodyClassName={cn("p-3", contentClassName)}>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((item, index) => (
          <MetricStripItem key={item.key || `${item.label || "metric"}-${index}`} item={item} />
        ))}
      </div>
    </Card>
  );
}
