import React, { useEffect, useMemo, useState } from "react";
import { Copy, RefreshCw } from "lucide-react";
import { ClawdAnimated } from "../ui/foundation/ClawdAnimated.jsx";
import { KpiCard, PageShell, SectionHeader, SimpleBar, SkeletonKpiGrid, SkeletonRows, Surface } from "../components/RevampSurfaces.jsx";
import { useClawdState } from "../hooks/useClawdState.js";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { safeWriteClipboard } from "../lib/safe-browser";
import { getOptimizeFindings, triggerOptimizeScan } from "../lib/api";

const FIRST_SCAN_TEXT = "No optimize scan has run yet. Run a local scan to populate findings from this machine.";
const EMPTY_TEXT = "No open optimize findings in the latest scan.";

const SEVERITY_TINT = {
  high: "bg-[var(--brand-700)]/12 dark:bg-[var(--brand-400)]/12",
  medium: "bg-[var(--brand-500)]/8 dark:bg-[var(--brand-400)]/8",
};

function severityTint(severity) {
  const key = String(severity || "").toLowerCase();
  return SEVERITY_TINT[key] || "";
}

function severityLabel(severity) {
  const value = String(severity || "");
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}

function findingCost(value, decimals = 6) {
  const formatted = formatUsdCurrency(value ?? "0.000000", { decimals });
  return formatted === "-" ? "$0.000000" : formatted;
}

function estimateMonthlySavings(findings) {
  return findings.reduce((sum, finding) => {
    const value = Number(finding?.estimated_cost_waste_usd || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export function OptimizePage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getOptimizeFindings()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch((err) => {
        if (active) setError(err?.message || "Failed to load optimize findings");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function runScan() {
    setScanning(true);
    setError("");
    try {
      await triggerOptimizeScan();
      setPayload((await getOptimizeFindings()) || {});
    } catch (err) {
      setError(err?.message || "Failed to run optimize scan");
    } finally {
      setScanning(false);
    }
  }

  const findings = Array.isArray(payload?.findings) ? payload.findings : [];
  const hasRun = Boolean(payload?.latest_run);
  const totalCost = useMemo(() => estimateMonthlySavings(findings), [findings]);
  const cacheSavings = totalCost * 0.62;
  const swapSavings = totalCost * 0.29;
  const subscriptionSavings = Math.max(0, totalCost - cacheSavings - swapSavings);
  const noFindings = !loading && !error && findings.length === 0;
  const groupedFindings = useMemo(
    () => findings.slice().sort((left, right) => Number(right?.estimated_cost_waste_usd || 0) - Number(left?.estimated_cost_waste_usd || 0)),
    [findings],
  );
  const clawdState = useClawdState({
    activeOperation: scanning ? "optimize scan" : "",
    hasError: Boolean(error),
  });

  const sidecars = (
    <div className="grid gap-4">
      <KpiCard label="Health grade" value={payload?.health?.health_grade || payload?.health?.grade || "-"} detail={`Score ${toDisplayNumber(payload?.health?.score ?? 0)}`} />
      <KpiCard label="Estimated avoidable cost" value={noFindings ? "None found" : findingCost(totalCost, 2)} detail={`${findings.length} open findings`} />
      <KpiCard label="Latest run" value={payload?.latest_run?.observed_at || payload?.latest_run?.created_at || "-"} />
    </div>
  );

  return (
    <PageShell
      title="Optimize"
      subtitle="Ranked savings opportunities from local usage patterns."
      actions={
        <button
          type="button"
          onClick={runScan}
          disabled={scanning}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--vd-border)] px-3 text-sm font-medium text-oai-gray-700 transition-colors hover:text-oai-black disabled:cursor-not-allowed disabled:opacity-60 dark:text-oai-gray-200 dark:hover:text-white"
        >
          {scanning ? (
            <span aria-hidden className="shimmer inline-block h-4 w-4 rounded-sm" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden />
          )}
          {scanning ? "Scanning" : "Run scan"}
        </button>
      }
    >
      {loading ? <div className="mb-5"><SkeletonKpiGrid count={3} /></div> : null}
      {error ? <p className="mb-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}
      {scanning ? (
        <div className="mb-4 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800" aria-label="Optimize scan running">
          <div className="h-1.5 w-1/3 animate-[vd-indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-[var(--brand-500)] motion-reduce:animate-none motion-reduce:w-full motion-reduce:bg-[var(--brand-300)] motion-reduce:opacity-60" />
        </div>
      ) : null}

      {noFindings ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.5fr)]">
          <Surface className="relative min-h-[250px] overflow-hidden text-center">
            <ClawdAnimated
              state={scanning ? clawdState : "idle-look"}
              size={80}
              className="mx-auto"
            />
            <h2 className="mx-auto mt-4 max-w-2xl text-h3 font-semibold text-oai-black dark:text-white">
              {hasRun ? EMPTY_TEXT : FIRST_SCAN_TEXT}
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-oai-gray-500 dark:text-oai-gray-400">
              {hasRun ? "Nothing to optimize right now. Run another scan after a few more sessions." : "Run a scan after you have enough local sessions for meaningful findings."}
            </p>
            {!hasRun ? (
              <button
                type="button"
                onClick={runScan}
                disabled={scanning}
                className="mt-5 inline-flex h-9 items-center rounded-lg bg-[var(--brand-600)] px-4 text-sm font-semibold text-white disabled:opacity-60"
              >
                {scanning ? "Running scan..." : "Run local scan"}
              </button>
            ) : null}
          </Surface>
          {sidecars}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,0.5fr)]">
          <Surface accent style={{ background: "var(--brand-700)" }} className="relative min-h-[250px] overflow-hidden">
            <div className="max-w-xl">
              <p className="text-label uppercase text-white/70">You can save</p>
              <p className="mt-5 text-hero font-semibold tabular-nums text-white">
                {findingCost(totalCost, 2)} / mo
              </p>
              <SimpleBar value={Math.min(100, totalCost * 100)} className="mt-8 bg-white/18" />
              <p className="mt-5 text-sm text-white/80">
                {findingCost(cacheSavings, 2)} cache · {findingCost(swapSavings, 2)} model swap · {findingCost(subscriptionSavings, 2)} subscription
              </p>
            </div>
            <ClawdAnimated
              state={scanning ? clawdState : totalCost > 0 ? "working-wizard" : "idle-look"}
              size={72}
              className="absolute bottom-5 right-6"
            />
          </Surface>
          {sidecars}
        </div>
      )}

      <section className="mt-6">
        <SectionHeader title="Opportunities" />
        <div className="grid gap-3">
          {loading ? <SkeletonRows rows={4} /> : null}
          {groupedFindings.map((finding) => (
            <Surface
              key={finding.id || finding.fingerprint || finding.title}
              className={severityTint(finding.severity)}
            >
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[var(--vd-tint)] px-2.5 py-1 text-caption font-semibold uppercase text-[var(--brand-700)] dark:text-[var(--brand-300)]">
                      {severityLabel(finding.severity)}
                    </span>
                    <h2 className="min-w-0 text-h4 font-semibold text-oai-black dark:text-white">{finding.title}</h2>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">{finding.detail}</p>
                </div>
                <div className="text-right">
                  <p className="text-h4 font-semibold tabular-nums text-oai-black dark:text-white">{findingCost(finding.estimated_cost_waste_usd)}</p>
                  <p className="mt-1 text-caption tabular-nums text-oai-gray-500">{toDisplayNumber(finding.estimated_token_waste)} tokens</p>
                </div>
              </div>
              {finding.paste_fix ? (
                <button
                  type="button"
                  onClick={() => safeWriteClipboard(finding.paste_fix)}
                  className="mt-4 inline-flex h-8 items-center gap-2 rounded-lg border border-[var(--vd-border)] px-3 text-xs font-semibold text-oai-gray-700 hover:text-oai-black dark:text-oai-gray-200 dark:hover:text-white"
                >
                  <Copy className="h-3.5 w-3.5" aria-hidden />
                  Paste fix
                </button>
              ) : null}
            </Surface>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
