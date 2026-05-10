import React from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { ConfidenceBadge } from "./ConfidenceBadge";

function toCount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const CONFIDENCE_KEYS = ["high", "medium", "low", "unattributed"];

export function AttributionHealthCard({ stats, loading = false, error = null }) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.attribution.title")}</h2>

      {loading ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("live.attribution.loading")}</p>
      ) : error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{copy("live.attribution.error", { error })}</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <span>{copy("live.attribution.total")}</span>
            <span className="font-semibold text-oai-black dark:text-white">{toCount(stats?.total)}</span>
          </div>
          {CONFIDENCE_KEYS.map((confidence) => (
            <div key={confidence} className="flex items-center justify-between">
              <ConfidenceBadge confidence={confidence} />
              <span className="text-sm font-semibold text-oai-black dark:text-white">
                {toCount(stats?.[confidence])}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
