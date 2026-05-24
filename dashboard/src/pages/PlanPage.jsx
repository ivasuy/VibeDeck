import React, { useEffect, useMemo, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency } from "../lib/format";
import { getPlanView } from "../lib/api";

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePlanDetail(payload) {
  const label = String(payload?.label || "Plan usage");
  const rawDetail = String(payload?.label_detail || payload?.labelDetail || label);
  if (/API-equivalent cost/i.test(label) && /not what you owe Cursor/i.test(rawDetail)) {
    return "API-equivalent cost — this is what these tokens would have cost via direct API, not what you owe Cursor.";
  }
  if (/API-equivalent cost/i.test(label) && /not what you owe Copilot/i.test(rawDetail)) {
    return "API-equivalent cost — this is what these tokens would have cost via direct API, not what you owe Copilot.";
  }
  return rawDetail;
}

export function PlanPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getPlanView()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch((err) => {
        if (active) setError(err?.message || "Failed to load plan usage");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const monthlyUsd = numberOrZero(payload?.monthly_plan_usd ?? payload?.monthly_usd);
  const monthToDateUsd = numberOrZero(payload?.month_to_date_api_equivalent_usd);
  const usagePercent = useMemo(() => {
    const explicit = Number(payload?.usage_percent);
    if (Number.isFinite(explicit)) return Math.max(0, explicit);
    return monthlyUsd > 0 ? (monthToDateUsd / monthlyUsd) * 100 : 0;
  }, [monthToDateUsd, monthlyUsd, payload?.usage_percent]);
  const progressPercent = Math.min(100, usagePercent);
  const detail = normalizePlanDetail(payload);
  const configuredPlan = monthlyUsd > 0;

  return (
    <PageFrame
      title="Plan"
      subtitle="Configured plan display for API-equivalent usage"
      maxWidth="max-w-5xl"
    >
      {loading ? <p className="mb-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading plan usage...</p> : null}
      {error ? <p className="mb-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {!loading && !error && !configuredPlan ? (
        <Card className="mb-4" title="Monthly plan not configured">
          <p className="text-sm text-oai-gray-600 dark:text-oai-gray-300">
            VibeDeck is showing live API-equivalent spend, but it cannot calculate budget percentage until
            `VIBEDECK_PLAN`, `VIBEDECK_PLAN_MONTHLY_USD`, or `~/.vibedeck/plan-config.json` is configured.
          </p>
        </Card>
      ) : null}

      <Card title={payload?.label || "Plan usage"}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-semibold text-oai-black dark:text-white">
              {payload?.plan || "custom"}
            </div>
            <p className="mt-2 max-w-2xl text-sm text-oai-gray-600 dark:text-oai-gray-300">
              {detail}
            </p>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-oai-gray-500">Monthly plan</div>
            <div className="mt-1 text-xl font-semibold tabular-nums text-oai-black dark:text-white">
              {formatUsdCurrency(monthlyUsd, { decimals: 2 })}
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-2 flex justify-between gap-3 text-sm">
            <span className="text-oai-gray-600 dark:text-oai-gray-300">Month-to-date API-equivalent spend</span>
            <span className="font-medium tabular-nums text-oai-black dark:text-white">
              {formatUsdCurrency(monthToDateUsd, { decimals: 4 })}
            </span>
          </div>
          {configuredPlan ? (
            <>
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Number(progressPercent.toFixed(2))}
                className="h-3 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800"
              >
                <div className="h-full rounded-full bg-oai-brand dark:bg-oai-brand-400" style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="mt-2 text-xs tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                {usagePercent.toFixed(2)}%
              </div>
            </>
          ) : (
            <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              Budget percentage unavailable until a monthly plan amount is configured.
            </p>
          )}
        </div>
      </Card>
    </PageFrame>
  );
}
