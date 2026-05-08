import React from "react";
import { copy } from "../../../lib/copy";

export const TopModelsPanel = React.memo(function TopModelsPanel({ rows = [], className = "" }) {
  const placeholder = copy("shared.placeholder.short");
  const percentSymbol = copy("shared.unit.percent");
  const displayRows = Array.from({ length: 3 }, (_, index) => {
    const row = rows[index];
    if (row) return row;
    return {
      id: "",
      name: "",
      percent: "",
      empty: true,
    };
  });

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      <div className="mb-3">
        <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("dashboard.top_models.title")}
        </h3>
      </div>

      <div className="flex flex-col">
        {displayRows.map((row, index) => {
          const rankLabel = String(index + 1);
          const isEmpty = Boolean(row?.empty);
          const name = isEmpty ? "" : row?.name ? String(row.name) : placeholder;
          const percent = isEmpty ? "" : row?.percent ? String(row.percent) : placeholder;
          const showPercentSymbol = !isEmpty && percent !== placeholder;
          const rowKey = row?.id ? String(row.id) : `${name}-${index}`;

          return (
            <div
              key={rowKey}
              className="flex items-center justify-between py-2 border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex items-center justify-center w-4 h-4 rounded text-[10px] font-medium bg-oai-gray-100 dark:bg-oai-gray-800 text-oai-gray-500 dark:text-oai-gray-300">
                  {rankLabel}
                </span>
                <span className="text-sm text-oai-black dark:text-oai-white truncate" title={name}>
                  {name || "—"}
                </span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-sm font-medium text-oai-black dark:text-oai-white tabular-nums">{percent || "—"}</span>
                {showPercentSymbol ? (
                  <span className="text-xs text-oai-gray-400 dark:text-oai-gray-400">{percentSymbol}</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
