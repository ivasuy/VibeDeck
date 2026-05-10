import React from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { MiniBarChart } from "../../ui/ops";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toBarRow(row) {
  const knownCost = toKnownNumber(row?.total_cost_usd);
  const tokens = Number(row?.total_tokens ?? 0);
  const value = knownCost ?? tokens;

  return {
    key: String(row?.branch || "branch"),
    label: String(row?.branch || "—"),
    value,
    valueLabel:
      knownCost != null
        ? `${formatUsdCurrency(String(knownCost))}${row?.cost_estimated ? ` ${copy("live.cost.estimated_suffix")}` : ""}`
        : copy("branches.chart.tokens_fallback", {
          tokens: toDisplayNumber(tokens),
        }),
  };
}

export function BranchCostBars({ repoRoot = "", rows = [] }) {
  const chartRows = (Array.isArray(rows) ? rows : []).filter(Boolean).map(toBarRow);

  return (
    <Card bodyClassName="space-y-4 p-4 sm:p-5">
      <div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
          {copy("branches.chart.title")}
        </div>
        <p className="mt-1 text-sm text-oai-gray-600 dark:text-oai-gray-300">
          {copy("branches.filter.summary", { count: chartRows.length, total: chartRows.length })}
        </p>
      </div>

      {chartRows.length ? (
        <MiniBarChart
          ariaLabel={copy("branches.chart.aria", { project: repoRoot || "—" })}
          accent="branch"
          rows={chartRows}
        />
      ) : (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.empty")}</p>
      )}
    </Card>
  );
}
