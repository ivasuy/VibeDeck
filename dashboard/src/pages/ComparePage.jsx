import React, { useEffect, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getCompareMetrics } from "../lib/api";

const EMPTY_TOTALS = { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 };
const METRICS = [
  ["One-shot rate", "one_shot_rate", "percent"],
  ["Retry rate", "retry_rate", "percent"],
  ["Self-correction", "self_correction_rate", "percent"],
  ["Cost / call", "cost_per_call_usd", "usd"],
  ["Cost / edit", "cost_per_edit_usd", "usd"],
  ["Cache hit", "cache_hit_percent", "percent"],
];

function metricValue(value, kind) {
  if (kind === "usd") return formatUsdCurrency(value ?? "0.0000", { decimals: 4 });
  const raw = value == null || value === "" ? "0.00" : String(value);
  return `${raw}%`;
}

function hasCompareData(payload) {
  const totalTokens = Number(payload?.totals?.total_tokens || 0);
  const sessions = Number(payload?.totals?.session_count || 0);
  return totalTokens > 0 || sessions > 0;
}

export function ComparePage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getCompareMetrics()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const totals = payload?.totals || EMPTY_TOTALS;
  const metrics = payload?.metrics || {};
  const empty = !loading && !hasCompareData(payload);

  return (
    <PageFrame
      title="Compare"
      subtitle="Model and workflow efficiency across the selected window"
      maxWidth="max-w-7xl"
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {METRICS.map(([label, key, kind]) => (
          <Card key={key} title={label}>
            <div className="text-2xl font-semibold tabular-nums text-oai-black dark:text-white">
              {metricValue(metrics[key], kind)}
            </div>
          </Card>
        ))}
      </div>

      <Card className="mt-5" title="Totals">
        {loading ? <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading parity data...</p> : null}
        {empty ? <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">No data for this window yet.</p> : null}
        {!empty ? (
          <div className="grid gap-3 text-sm text-oai-gray-600 dark:text-oai-gray-300 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Tokens</div>
              <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                {toDisplayNumber(totals.total_tokens)}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Cost</div>
              <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                {formatUsdCurrency(totals.total_cost_usd, { decimals: 4 })}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Sessions</div>
              <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                {toDisplayNumber(totals.session_count)}
              </div>
            </div>
          </div>
        ) : null}
      </Card>
    </PageFrame>
  );
}
