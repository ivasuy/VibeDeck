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
  return branch || null;
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

function routeKey(row) {
  const repo = String(row?.repo_root || "").trim();
  const branch = branchName(row);
  if (!repo || !branch) return null;
  return `${repo}::${branch}`;
}

export function LiveBranchSignalMap({ sessions = [] }) {
  const model = useMemo(() => {
    const active = (Array.isArray(sessions) ? sessions : []).filter(isActiveRow);
    const branches = new Map();
    let routedCount = 0;
    let unroutedCount = 0;
    for (const row of active) {
      const key = routeKey(row);
      if (key) {
        routedCount += 1;
        branches.set(key, true);
      } else {
        unroutedCount += 1;
      }
    }
    const routePct = active.length > 0 ? Math.round((routedCount / active.length) * 100) : 0;
    const unroutedPct = active.length > 0 ? 100 - routePct : 0;
    const density = branches.size > 0 ? (routedCount / branches.size).toFixed(1) : "0";
    return {
      activeCount: active.length,
      routePct,
      unroutedCount,
      unroutedPct,
      routedCount,
      branchCount: branches.size,
      density,
    };
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
            <div className="h-full shrink-0 bg-oai-brand" style={{ flexBasis: `${model.routePct}%` }} aria-hidden />
            <div className="h-full shrink-0 bg-amber-500" style={{ flexBasis: `${model.unroutedPct}%` }} aria-hidden />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-md bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                Routed
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{model.routedCount}</div>
            </div>
            <div className="rounded-md bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Unrouted
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{model.unroutedCount}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-4 rounded-lg bg-oai-black/[0.035] p-3 dark:bg-white/[0.06]">
          <div
            className="grid h-16 w-16 shrink-0 place-items-center rounded-full"
            style={{
              background: `conic-gradient(rgb(99 102 241) ${model.routePct}%, rgba(255,255,255,0.08) 0)`,
            }}
            aria-hidden
          >
            <div className="grid h-11 w-11 place-items-center rounded-full bg-white text-xs font-semibold tabular-nums text-oai-black dark:bg-oai-gray-950 dark:text-white">
              {model.routePct}%
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
              Routing coverage
            </div>
            <div className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
              {model.unroutedCount} session{model.unroutedCount === 1 ? "" : "s"} need routing
            </div>
            <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              Real routes require both repository and branch attribution.
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
