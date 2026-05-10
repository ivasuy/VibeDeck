import React from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency } from "../../lib/format";
import { MiniBarChart } from "../../ui/ops";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toBarRow(row) {
  const knownCost = toKnownNumber(row?.total_cost_usd);
  if (knownCost == null) return null;

  return {
    key: String(row?.branch || "branch"),
    label: String(row?.branch || "—"),
    value: knownCost,
    valueLabel: `${formatUsdCurrency(String(knownCost))}${row?.cost_estimated ? ` ${copy("live.cost.estimated_suffix")}` : ""}`,
  };
}

export function BranchCostBars({ repoRoot = "", rows = [] }) {
  const chartRows = (Array.isArray(rows) ? rows : []).filter(Boolean).map(toBarRow).filter(Boolean);

  return (
    <Card bodyClassName="space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">
          {copy("branches.chart.title")}
        </h2>
        <p className="mt-1 text-sm text-oai-gray-600 dark:text-oai-gray-300">
          {chartRows.length
            ? copy("branches.chart.summary", { count: chartRows.length })
            : copy("branches.chart.empty_known_cost")}
        </p>
      </div>

      {chartRows.length ? (
        <MiniBarChart
          ariaLabel={copy("branches.chart.aria", { project: repoRoot || "—" })}
          accent="cost"
          rows={chartRows}
        />
      ) : (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.chart.empty_note")}</p>
      )}
    </Card>
  );
}
