import React, { useEffect, useMemo, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { safeWriteClipboard } from "../lib/safe-browser";
import { getOptimizeFindings, triggerOptimizeScan } from "../lib/api";

const SEVERITIES = ["high", "medium", "low"];
const FIRST_SCAN_TEXT = "No optimize scan has run yet. Run a local scan to populate findings from this machine.";
const EMPTY_TEXT = "No open optimize findings in the latest scan.";

function severityLabel(severity) {
  const value = String(severity || "");
  return value ? value[0].toUpperCase() + value.slice(1) : "Unknown";
}

function findingCost(value) {
  const formatted = formatUsdCurrency(value ?? "0.000000", { decimals: 6 });
  return formatted === "-" ? "$0.000000" : formatted;
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
  const groups = useMemo(() => {
    const next = { high: [], medium: [], low: [] };
    for (const finding of findings) {
      const severity = String(finding?.severity || "low").toLowerCase();
      (next[severity] || next.low).push(finding);
    }
    return next;
  }, [findings]);
  const totalCost = findings.reduce((sum, finding) => {
    const value = Number(finding?.estimated_cost_waste_usd || 0);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);

  return (
    <PageFrame
      title="Optimize"
      subtitle="Inferred waste findings from local usage patterns"
      maxWidth="max-w-7xl"
    >
      {loading ? <p className="mb-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading optimize findings...</p> : null}
      {error ? <p className="mb-4 text-sm text-red-700 dark:text-red-300">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Health grade">
          <div className="text-4xl font-semibold text-oai-black dark:text-white">
            {payload?.health?.health_grade || payload?.health?.grade || "-"}
          </div>
          <div className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Score {toDisplayNumber(payload?.health?.score ?? 0)}
          </div>
        </Card>
        <Card title="Latest run">
          <div className="text-lg font-semibold text-oai-black dark:text-white">
            {payload?.latest_run?.observed_at || payload?.latest_run?.created_at || "-"}
          </div>
        </Card>
        <Card title="Estimated avoidable cost">
          <div className="text-2xl font-semibold tabular-nums text-oai-gray-800 dark:text-oai-gray-100">
            {findingCost(totalCost)}
          </div>
        </Card>
      </div>

      {!loading && !error && findings.length === 0 ? (
        <Card className="mt-5">
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {hasRun ? EMPTY_TEXT : FIRST_SCAN_TEXT}
          </p>
          {!hasRun ? (
            <button
              type="button"
              onClick={runScan}
              disabled={scanning}
              className="mt-3 rounded-md border border-oai-gray-300 px-3 py-1.5 text-xs font-medium text-oai-gray-700 hover:bg-oai-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-oai-gray-700 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
            >
              {scanning ? "Running scan..." : "Run local scan"}
            </button>
          ) : null}
        </Card>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        {SEVERITIES.map((severity) => (
          <Card key={severity} title={severityLabel(severity)}>
            <div className="space-y-3">
              {groups[severity].length === 0 ? (
                <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">No {severity} findings.</p>
              ) : (
                groups[severity].map((finding) => (
                  <div key={finding.id || finding.fingerprint || finding.title} className="rounded-lg border border-oai-gray-200 bg-oai-gray-50 p-3 dark:border-oai-gray-800 dark:bg-oai-gray-950/40">
                    <div className="font-medium text-oai-black dark:text-white">{finding.title}</div>
                    <p className="mt-1 text-sm text-oai-gray-600 dark:text-oai-gray-300">{finding.detail}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      <span>{toDisplayNumber(finding.estimated_token_waste)} tokens</span>
                      <span className="text-right tabular-nums">{findingCost(finding.estimated_cost_waste_usd)}</span>
                    </div>
                    {finding.paste_fix ? (
                      <button
                        type="button"
                        onClick={() => safeWriteClipboard(finding.paste_fix)}
                        className="mt-3 rounded-md border border-oai-gray-300 px-3 py-1.5 text-xs font-medium text-oai-gray-700 hover:bg-oai-gray-100 dark:border-oai-gray-700 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
                      >
                        Paste fix
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </Card>
        ))}
      </div>
    </PageFrame>
  );
}
