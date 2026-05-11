import React, { useMemo } from "react";
import { Activity, GitCommit, Server, Tag } from "lucide-react";
import { copy } from "../../lib/copy";

function stateClass(state) {
  if (state === "active") return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (state === "not_installed") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (state === "enabled_no_commits") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-oai-black/[0.06] text-oai-gray-700 dark:bg-white/[0.12] dark:text-oai-gray-200";
}

function statusLabel(state) {
  if (state === "not_installed") return copy("entire.state.not_installed");
  if (state === "not_enabled") return copy("entire.state.not_enabled");
  if (state === "enabled_no_commits") return copy("entire.state.enabled_no_commits");
  if (state === "active") return copy("entire.state.active");
  return copy("entire.state.unknown");
}

function cachedStateLabel(state) {
  if (state === "not_installed") return copy("entire.state.not_installed");
  if (state === "not_enabled") return copy("entire.state.not_enabled");
  if (state === "enabled_no_commits") return copy("entire.state.enabled_no_commits");
  if (state === "active") return copy("entire.state.active");
  return state;
}

function MetaRow({ label, value, wrap = false, mono = false, icon: Icon = null }) {
  return (
    <div className={[
      "rounded-md bg-oai-black/[0.03] px-3 py-3 text-[11px] text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300",
      wrap ? "grid gap-2" : "flex items-center justify-between gap-2",
    ].join(" ")}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0 text-oai-gray-400 dark:text-oai-gray-500" aria-hidden /> : null}
        <span>{label}</span>
      </span>
      <span
        className={[
          wrap ? "max-w-full text-left" : "max-w-[72%] text-right",
          "font-medium text-oai-black dark:text-white",
          wrap ? "break-all whitespace-normal leading-5" : "truncate",
          mono ? "font-mono text-[10px]" : "",
        ].join(" ")}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

export function EntireStatusCard({ status = null, loading = false, error = "", className = "" }) {
  const state = String(status?.state || "");
  const label = useMemo(() => statusLabel(state), [state]);

  return (
    <div className={className}>
      {loading ? (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.status.loading")}</p>
      ) : error ? (
        <p className="text-sm text-red-700 dark:text-red-300">
          {copy("entire.status.error", { error })}
        </p>
      ) : !status ? (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.status.empty")}</p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-md bg-oai-black/[0.03] px-3 py-3 dark:bg-white/[0.08]">
            <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
              <Activity className="h-3.5 w-3.5" aria-hidden />
              {copy("entire.status.state")}
            </span>
            <span className={`inline-flex h-5 items-center rounded-md px-2 text-[11px] font-medium ${stateClass(state)}`}>
              {label}
            </span>
          </div>
          {status?.version ? (
            <MetaRow label={copy("entire.status.version")} value={String(status.version)} icon={Tag} />
          ) : null}
          {status?.checkpoint_branch_tip ? (
            <MetaRow
              label={copy("entire.status.tip")}
              value={String(status.checkpoint_branch_tip)}
              wrap
              mono
              icon={GitCommit}
            />
          ) : null}
          {status?.cached_state ? (
            <MetaRow
              label={copy("entire.status.cached_state")}
              value={cachedStateLabel(String(status.cached_state))}
              icon={Server}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
