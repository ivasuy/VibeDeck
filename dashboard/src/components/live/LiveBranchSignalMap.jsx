import React, { useMemo } from "react";
import { Activity, GitBranch, Radio, Radar, ShieldAlert, ShieldCheck } from "lucide-react";
import { Card } from "../../ui/openai/components";

function isActiveRow(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function branchName(row) {
  const branch = String(row?.branch || "").trim();
  return branch || "unattributed";
}

function normalizeConfidence(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "high" || key === "medium" || key === "low") return key;
  return "unattributed";
}

function WorkloadTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md bg-oai-black/[0.035] px-2.5 py-2 dark:bg-white/[0.06]">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

export function LiveBranchSignalMap({ sessions = [] }) {
  const model = useMemo(() => {
    const active = (Array.isArray(sessions) ? sessions : []).filter(isActiveRow);
    const branches = new Map();
    const confidence = { high: 0, medium: 0, low: 0, unattributed: 0 };
    for (const row of active) {
      const confidenceKey = normalizeConfidence(row?.confidence);
      confidence[confidenceKey] += 1;
      const branch = branchName(row);
      branches.set(branch, true);
    }
    const reviewCount = confidence.low + confidence.unattributed;
    const healthyCount = Math.max(0, active.length - reviewCount);
    const reviewPct = active.length > 0 ? Math.round((reviewCount / active.length) * 100) : 0;
    const healthyPct = active.length > 0 ? 100 - reviewPct : 0;
    const density = branches.size > 0 ? (active.length / branches.size).toFixed(1) : "0";
    return { activeCount: active.length, reviewCount, reviewPct, healthyCount, healthyPct, branchCount: branches.size, density };
  }, [sessions]);

  return (
    <Card bodyClassName="p-5">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
              <h2 className="text-sm font-semibold text-oai-black dark:text-white">Branch routing</h2>
            </div>
            <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              Confidence and freshness across active branch routes.
            </p>
          </div>
        </div>

        <div className="mt-3 rounded-lg bg-oai-black/[0.035] p-3 dark:bg-white/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
              Route coverage
            </div>
            <span className="text-xs font-semibold tabular-nums text-oai-black dark:text-white">
              {model.branchCount} route{model.branchCount === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-oai-black/[0.06] dark:bg-white/[0.08]">
            <div className="h-full shrink-0 bg-oai-brand" style={{ flexBasis: `${model.healthyPct}%` }} aria-hidden />
            <div className="h-full shrink-0 bg-amber-500" style={{ flexBasis: `${model.reviewPct}%` }} aria-hidden />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Routed
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{model.healthyCount}</div>
            </div>
            <div className="rounded-md bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Review
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{model.reviewCount}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 rounded-lg bg-oai-black/[0.035] p-3 dark:bg-white/[0.06]">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(rgb(16 163 127) ${model.reviewPct}%, rgba(255,255,255,0.08) 0)`,
            }}
            aria-hidden
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-xs font-semibold tabular-nums text-oai-black dark:bg-oai-gray-950 dark:text-white">
              {model.reviewPct}%
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              Review pressure
            </div>
            <div className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
              {model.reviewCount} branch route{model.reviewCount === 1 ? "" : "s"} need attention
            </div>
            <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              Sorted by weakest attribution first, then newest signal.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <WorkloadTile icon={Radio} label="Signals" value={model.activeCount} />
          <WorkloadTile icon={GitBranch} label="Routes" value={model.branchCount} />
          <WorkloadTile icon={Activity} label="Density" value={model.density} />
        </div>
        <p className="mt-3 text-xs leading-relaxed text-oai-gray-500 dark:text-oai-gray-400">
          Signals are live sessions grouped into branch routes. Density shows active sessions per route.
        </p>
      </div>
    </Card>
  );
}
