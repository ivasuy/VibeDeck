import React from "react";
import { cn } from "../../lib/cn";
import { getAccentToken } from "./AccentTokens";

function toNumber(value) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

export function MiniBarChart({ rows = [], ariaLabel, accent = "default", className = "" }) {
  const items = (Array.isArray(rows) ? rows : [])
    .filter(Boolean)
    .map((row) => ({ ...row, numericValue: toNumber(row.value) }))
    .sort((left, right) => right.numericValue - left.numericValue);

  if (!items.length) return null;

  const token = getAccentToken(accent);
  const maxValue = items.reduce((max, row) => Math.max(max, row.numericValue), 0);

  return (
    <div aria-label={ariaLabel} className={cn("space-y-2", className)} role="img">
      {items.map((row) => {
        const width = maxValue > 0 ? `${(row.numericValue / maxValue) * 100}%` : "0%";
        return (
          <div
            key={row.key || row.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
            data-testid="mini-bar-row"
          >
            <div className="min-w-0">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-oai-black dark:text-oai-white">{row.label}</span>
                <span className="shrink-0 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                  {row.valueLabel}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-oai-gray-200 dark:bg-oai-gray-800">
                <div className={cn("h-full rounded-full", token.barClassName)} style={{ width }} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
