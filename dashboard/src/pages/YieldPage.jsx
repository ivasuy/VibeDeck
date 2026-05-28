import React, { useEffect, useState } from "react";
import { EmptyState, KpiCard, PageShell, SectionHeader, SimpleBar, SkeletonKpiGrid, SkeletonRows, Surface } from "../components/RevampSurfaces.jsx";
import { formatCompactNumber, formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getYieldView } from "../lib/api";

const STATES = ["productive", "reverted", "abandoned", "unknown"];

export function YieldPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getYieldView()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch(() => {
        if (!active) return;
        setPayload(null);
        setError("Unable to load branch yield.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const branches = Array.isArray(payload?.branches) ? payload.branches : [];
  const empty = !loading && !error && branches.length === 0;
  const totals = payload?.totals || {};
  const maxTokens = Math.max(...branches.map((branch) => Number(branch.total_tokens || 0)), 1);

  return (
    <PageShell title="Yield" subtitle="Branch outcomes and cache yield signals.">
      <div className="mb-5">
        {loading ? (
          <>
            <span className="sr-only">Loading parity data...</span>
            <SkeletonKpiGrid count={3} />
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Branches" value={toDisplayNumber(branches.length)} accent />
            <KpiCard label="Tokens" value={formatCompactNumber(totals.total_tokens || 0, { decimals: 1 })} />
            <KpiCard label="Cost" value={formatUsdCurrency(totals.total_cost_usd || "0.0000", { decimals: 4 })} />
          </div>
        )}
      </div>

      <Surface>
        <div className="mb-4 flex flex-wrap gap-2">
          {STATES.map((state) => (
            <span key={state} className="rounded-full border border-[var(--glass-border)] px-2.5 py-1 text-caption font-semibold uppercase text-oai-gray-600 dark:text-oai-gray-300">
              {state}
            </span>
          ))}
        </div>
        <SectionHeader title="Branch yield" />
        {loading ? <SkeletonRows rows={5} /> : null}
        {error ? <EmptyState title={error} body="Check that the local VibeDeck server is running, then refresh." /> : null}
        {empty ? <EmptyState title="No data for this window yet." body="Try a wider range, or check back after more sessions." /> : null}
        {branches.length ? (
          <div className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
            {branches.map((branch) => (
              <div key={`${branch.branch}:${branch.yield_state}`} className="grid gap-3 py-3 lg:grid-cols-[minmax(180px,0.9fr)_120px_minmax(0,1fr)_auto_auto_auto] lg:items-center">
                <span className="min-w-0 truncate font-medium text-oai-black dark:text-white">{branch.branch || "Unknown branch"}</span>
                <span className="rounded-full bg-[var(--vd-tint)] px-2.5 py-1 text-caption font-semibold uppercase text-oai-gray-700 dark:text-oai-gray-200">
                  {branch.yield_state || "unknown"}
                </span>
                <SimpleBar value={Number(branch.total_tokens || 0)} max={maxTokens} />
                <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(branch.total_tokens)}</span>
                <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatUsdCurrency(branch.total_cost_usd, { decimals: 4 })}</span>
                <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(branch.session_count)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </Surface>
    </PageShell>
  );
}
