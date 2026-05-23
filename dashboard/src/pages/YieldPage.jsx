import React, { useEffect, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getYieldView } from "../lib/api";

const STATES = ["productive", "reverted", "abandoned", "unknown"];

export function YieldPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getYieldView()
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

  const branches = Array.isArray(payload?.branches) ? payload.branches : [];
  const empty = !loading && branches.length === 0;

  return (
    <PageFrame title="Yield" maxWidth="max-w-7xl">
      <div className="mb-4 flex flex-wrap gap-2">
        {STATES.map((state) => (
          <span key={state} className="vd-chip rounded-md border border-[var(--glass-border)] px-2 py-1 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
            {state}
          </span>
        ))}
      </div>

      {loading ? <p className="mb-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading parity data...</p> : null}
      {empty ? <p className="mb-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">No data for this window yet.</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {branches.map((branch) => (
          <Card key={`${branch.branch}:${branch.yield_state}`} title={branch.branch || "Unknown branch"}>
            <div className="mb-4">
              <span className="vd-chip rounded-md border border-[var(--glass-border)] px-2 py-1 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                {branch.yield_state || "unknown"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <div className="text-xs uppercase tracking-wide text-oai-gray-500">Tokens</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">{toDisplayNumber(branch.total_tokens)}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-oai-gray-500">Cost</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">{formatUsdCurrency(branch.total_cost_usd, { decimals: 4 })}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-oai-gray-500">Sessions</div>
                <div className="mt-1 font-semibold tabular-nums text-oai-black dark:text-white">{toDisplayNumber(branch.session_count)}</div>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </PageFrame>
  );
}
