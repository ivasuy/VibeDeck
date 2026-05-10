import React from "react";
import { cn } from "../../lib/cn";

const CONFIDENCE_SEGMENTS = [
  { key: "high", className: "bg-emerald-500", textClassName: "text-emerald-700 dark:text-emerald-300" },
  { key: "medium", className: "bg-amber-500", textClassName: "text-amber-700 dark:text-amber-300" },
  { key: "low", className: "bg-indigo-500", textClassName: "text-indigo-700 dark:text-indigo-300" },
  { key: "unattributed", className: "bg-rose-500", textClassName: "text-rose-700 dark:text-rose-300" },
];

function toCount(value) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function ConfidenceBar({ confidence = {}, ariaLabel, className = "" }) {
  const summary = CONFIDENCE_SEGMENTS.map((segment) => ({
    ...segment,
    value: toCount(confidence?.[segment.key]),
  }));
  const total = summary.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div
      aria-label={ariaLabel}
      className={cn("space-y-2", className)}
      role="img"
    >
      <div className="flex h-2 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-800">
        {summary.map((segment) => {
          const width = total > 0 ? `${(segment.value / total) * 100}%` : "0%";
          return (
            <div
              key={segment.key}
              className={cn("h-full transition-[width]", segment.className)}
              style={{ width }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
        {summary.map((segment) => (
          <span key={segment.key} className={cn("font-medium", segment.textClassName)}>
            {segment.key} {segment.value}
          </span>
        ))}
      </div>
    </div>
  );
}
