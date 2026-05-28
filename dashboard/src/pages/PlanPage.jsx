import React, { useEffect, useMemo, useState } from "react";
import { KpiCard, PageShell, SectionHeader, SimpleBar, SkeletonKpiGrid, Surface } from "../components/RevampSurfaces.jsx";
import { ClawdAnimated } from "../ui/foundation/ClawdAnimated.jsx";
import { useClawdState } from "../hooks/useClawdState.js";
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

function ForecastSketch({ percent, insufficientData = false }) {
  const points = [18, 34, 25, 50, 42, 66, 58, Math.min(88, Math.max(16, percent))];
  const max = 100;
  return (
    <div className="mt-8 h-48 rounded-xl border border-white/15 bg-white/8 p-5">
      <div className="relative h-full">
        {[200, 100, 50].map((tier, index) => (
          <div key={tier} className="absolute left-0 right-0 border-t border-dashed border-white/22" style={{ top: `${index * 30 + 8}%` }}>
            <span className="absolute right-0 -top-3 bg-[var(--brand-700)] px-2 text-caption text-white/70">${tier} tier</span>
          </div>
        ))}
        <div className="absolute inset-x-0 bottom-0 flex h-[78%] items-end gap-1.5">
          {points.map((point, index) => (
            <div key={index} className="flex-1">
              <div
                className={index > 5 || insufficientData ? "is-projected rounded-t-sm bg-white/60" : "rounded-t-sm bg-white/70"}
                style={{ height: `${(point / max) * 100}%` }}
              />
            </div>
          ))}
        </div>
        {insufficientData ? (
          <div className="absolute bottom-2 left-0 rounded-md bg-white/12 px-2 py-1 text-caption text-white/75">
            Forecast unlocks after 7 days of usage.
          </div>
        ) : null}
      </div>
    </div>
  );
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
  const detail = normalizePlanDetail(payload);
  const configuredPlan = monthlyUsd > 0;
  const paygWins = configuredPlan && monthToDateUsd < monthlyUsd;
  const observedDaysRaw = payload?.active_days ?? payload?.activeDays ?? payload?.days_observed ?? payload?.history_days;
  const observedDays = Number(observedDaysRaw);
  const hasObservedDays = Number.isFinite(observedDays);
  const insufficientData = hasObservedDays && observedDays > 0 && observedDays < 7;
  const clawdState = useClawdState({
    activeOperation: "forecast",
    hasError: Boolean(error),
  });

  return (
    <PageShell title="Plan" subtitle="Forecast monthly burn and compare subscription efficiency.">
      {loading ? <div className="mb-5"><SkeletonKpiGrid count={3} /></div> : null}
      {error ? <p className="mb-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      {!loading && !error && !configuredPlan ? (
        <Surface className="mb-4">
          <h2 className="text-h4 font-semibold text-oai-black dark:text-white">Monthly plan not configured</h2>
          <p className="mt-2 text-sm text-oai-gray-600 dark:text-oai-gray-300">
            VibeDeck is showing live API-equivalent spend, but it cannot calculate budget percentage until
            `VIBEDECK_PLAN`, `VIBEDECK_PLAN_MONTHLY_USD`, or `~/.vibedeck/plan-config.json` is configured.
          </p>
        </Surface>
      ) : null}

      {!loading && !error && insufficientData ? (
        <Surface className="mb-4">
          <h2 className="text-h4 font-semibold text-oai-black dark:text-white">Forecast unlocks after 7 days of usage.</h2>
          <p className="mt-2 text-sm text-oai-gray-600 dark:text-oai-gray-300">
            VibeDeck has {observedDays.toLocaleString()} active {observedDays === 1 ? "day" : "days"} so far. Current spend stays visible, while projected bars are marked as forecast data.
          </p>
        </Surface>
      ) : null}

      <Surface accent style={{ background: "var(--brand-700)" }} className="overflow-hidden">
        <SectionHeader title="Monthly forecast" className="text-white" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <div>
            <p className="text-hero font-semibold tabular-nums text-white">
              {formatUsdCurrency(monthToDateUsd, { decimals: 4 })}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-white/75">{detail}</p>
          </div>
          <div className="relative overflow-hidden rounded-xl bg-white/10 p-4">
            <p className="text-label uppercase text-white/60">Current plan</p>
            <p className="mt-2 text-h3 font-semibold text-white">{payload?.plan || "custom"}</p>
            <p className="mt-1 text-sm tabular-nums text-white/75">
              {formatUsdCurrency(monthlyUsd, { decimals: 2 })} / mo
            </p>
            <ClawdAnimated state={clawdState} size={64} className="absolute bottom-3 right-3 opacity-95" />
          </div>
        </div>
        <ForecastSketch percent={usagePercent} insufficientData={insufficientData} />
      </Surface>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <KpiCard
          label={payload?.label || "Plan usage"}
          value={configuredPlan ? `${usagePercent.toFixed(2)}%` : "Not configured"}
          detail={configuredPlan ? `${formatUsdCurrency(monthToDateUsd, { decimals: 4 })} of ${formatUsdCurrency(monthlyUsd, { decimals: 2 })}` : "Budget percentage unavailable until a monthly plan amount is configured."}
        >
          {configuredPlan ? (
            <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Number(Math.min(100, usagePercent).toFixed(2))}>
              <SimpleBar value={Math.min(100, usagePercent)} />
            </div>
          ) : null}
        </KpiCard>
        <KpiCard
          label="Breakeven analysis"
          value={paygWins ? "PAYG wins" : "Plan wins"}
          detail={`PAYG equivalent: ${formatUsdCurrency(monthToDateUsd, { decimals: 4 })} · Plan: ${formatUsdCurrency(monthlyUsd, { decimals: 2 })}`}
        />
      </div>
    </PageShell>
  );
}
