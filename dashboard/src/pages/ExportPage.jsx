import React, { useEffect, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { downloadExport } from "../lib/api";

const EMPTY_TOTALS = { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 };

export function ExportPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState("json");

  useEffect(() => {
    let active = true;
    setLoading(true);
    downloadExport({ format: "json" })
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

  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const totals = payload?.totals || EMPTY_TOTALS;
  const empty = !loading && rows.length === 0;

  return (
    <PageFrame title="Export" maxWidth="max-w-7xl">
      <Card>
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="grid gap-1 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
            From
            <input placeholder="From" className="vd-control h-10 rounded-md border border-oai-gray-300 bg-oai-white px-3 text-sm text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white" />
          </label>
          <label className="grid gap-1 text-sm font-medium text-oai-gray-700 dark:text-oai-gray-300">
            To
            <input placeholder="To" className="vd-control h-10 rounded-md border border-oai-gray-300 bg-oai-white px-3 text-sm text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white" />
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
      </Card>

      <Card className="mt-5" title="Aggregate totals" subtitle={`Preview format: ${format.toUpperCase()}`}>
        {loading ? <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading parity data...</p> : null}
        {empty ? <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">No data for this window yet.</p> : null}
        {!empty ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Tokens</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-oai-black dark:text-white">{toDisplayNumber(totals.total_tokens)}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Cost</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-oai-black dark:text-white">{formatUsdCurrency(totals.total_cost_usd, { decimals: 4 })}</div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wide text-oai-gray-500">Sessions</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-oai-black dark:text-white">{toDisplayNumber(totals.session_count)}</div>
            </div>
          </div>
        ) : null}
      </Card>
    </PageFrame>
  );
}
