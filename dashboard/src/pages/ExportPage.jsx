import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { EmptyState, KpiCard, PageShell, SkeletonBlock, Surface } from "../components/RevampSurfaces.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { downloadExport } from "../lib/api";

const EMPTY_TOTALS = { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 };

export function ExportPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [format, setFormat] = useState("json");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    downloadExport({ format: "json" })
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch(() => {
        if (!active) return;
        setPayload(null);
        setError("Unable to load export preview.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totals = payload?.totals || EMPTY_TOTALS;
  const empty = !loading && !error && rows.length === 0;

  return (
    <PageShell
      title="Export"
      subtitle="Preview local ledger totals before downloading usage data."
      actions={
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[var(--brand-600)] px-3 text-sm font-semibold text-white"
        >
          <Download className="h-4 w-4" aria-hidden />
          Export {format.toUpperCase()}
        </button>
      }
    >
      <Surface>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="grid gap-1 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
            From
            <input placeholder="From" className="vd-control h-10 rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 text-sm text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-white" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
            To
            <input placeholder="To" className="vd-control h-10 rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 text-sm text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-white" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setFormat("json")} className="rounded-md border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-oai-black dark:text-white">
              JSON
            </button>
            <button type="button" onClick={() => setFormat("csv")} className="rounded-md border border-[var(--glass-border)] px-4 py-2 text-sm font-medium text-oai-black dark:text-white">
              CSV
            </button>
          </div>
        </div>
      </Surface>

      <Surface className="mt-5">
        <div className="mb-4">
          <h2 className="text-h3 font-semibold text-oai-black dark:text-white">Aggregate totals</h2>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">Preview format: {format.toUpperCase()}</p>
        </div>
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <span className="sr-only">Loading parity data...</span>
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-lg border border-[var(--glass-border)] p-4">
                <SkeletonBlock className="h-3 w-20 rounded" />
                <SkeletonBlock className="mt-4 h-8 w-28" />
              </div>
            ))}
          </div>
        ) : null}
        {error ? <EmptyState title={error} body="Check that the local VibeDeck server is running, then refresh." /> : null}
        {empty ? <EmptyState title="No data for this window yet." body="Try a wider date range after more local sessions have synced." /> : null}
        {!empty && !error ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Tokens" value={toDisplayNumber(totals.total_tokens)} accent />
            <KpiCard label="Cost" value={formatUsdCurrency(totals.total_cost_usd, { decimals: 4 })} />
            <KpiCard label="Sessions" value={toDisplayNumber(totals.session_count)} />
          </div>
        ) : null}
      </Surface>
    </PageShell>
  );
}
