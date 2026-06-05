import React, { useEffect, useState } from "react";
import { EmptyState, KpiCard, PageShell, SkeletonKpiGrid, SkeletonRows, Surface } from "../components/RevampSurfaces.jsx";
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
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getCompareMetrics()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch(() => {
        if (active) {
          setPayload(null);
          setError("Unable to load compare metrics.");
        }
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
  const hasData = hasCompareData(payload);
  const empty = !loading && !error && !hasData;

  return (
    <PageShell title="Compare" subtitle="Model and workflow efficiency across the selected window.">
      {loading ? (
        <>
          <span className="sr-only">Loading parity data...</span>
          <SkeletonKpiGrid count={3} />
        </>
      ) : error ? (
        <EmptyState
          title={error}
          body="Check that the local VibeDeck server is running, then refresh."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {METRICS.map(([label, key, kind], index) => (
          <KpiCard
            key={key}
            label={label}
            value={metricValue(metrics[key], kind)}
            detail={index < 3 ? "workflow signal" : "cost signal"}
            accent={index === 0}
          />
          ))}
        </div>
      )}

      <div className="mt-5">
        <Surface>
          <h2 className="text-label uppercase text-oai-gray-500 dark:text-oai-gray-400">Totals</h2>
          {loading ? <SkeletonRows rows={3} className="mt-3" /> : null}
          {empty ? (
            <div className="mt-3">
              <EmptyState title="No data for this window yet." body="Try a wider range, or check back after more sessions." />
            </div>
          ) : null}
          {!loading && !error && hasData ? (
            <div className="mt-4 grid gap-3 text-sm text-oai-gray-600 dark:text-oai-gray-300 sm:grid-cols-3">
              <div>
                <div className="text-label uppercase text-oai-gray-500">Tokens</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                  {toDisplayNumber(totals.total_tokens)}
                </div>
              </div>
              <div>
                <div className="text-label uppercase text-oai-gray-500">Cost</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                  {formatUsdCurrency(totals.total_cost_usd, { decimals: 4 })}
                </div>
              </div>
              <div>
                <div className="text-label uppercase text-oai-gray-500">Sessions</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">
                  {toDisplayNumber(totals.session_count)}
                </div>
              </div>
            </div>
          ) : null}
        </Surface>
      </div>
    </PageShell>
  );
}
