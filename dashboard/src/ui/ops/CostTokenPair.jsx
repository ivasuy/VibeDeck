import React from "react";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { cn } from "../../lib/cn";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function CostTokenPair({ cost, tokens, estimated = false, className = "" }) {
  const numericCost = toKnownNumber(cost);
  const costLabel = numericCost == null ? "—" : formatUsdCurrency(String(numericCost));
  const tokenLabel = tokens == null ? "—" : toDisplayNumber(tokens);

  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <span className="text-sm font-semibold tabular-nums text-oai-black dark:text-oai-white">
        {costLabel}
        {numericCost != null && estimated ? " est." : ""}
      </span>
      <span className="text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400">{tokenLabel}</span>
    </div>
  );
}
