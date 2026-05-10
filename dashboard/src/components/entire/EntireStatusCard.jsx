import React, { useMemo } from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";

const STATE_LABELS = {
  not_installed: "entire.state.not_installed",
  not_enabled: "entire.state.not_enabled",
  enabled_no_commits: "entire.state.enabled_no_commits",
  active: "entire.state.active",
};

function stateClass(state) {
  if (state === "active") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (state === "not_installed") return "bg-red-500/10 text-red-700 dark:text-red-300";
  if (state === "enabled_no_commits") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "bg-oai-black/[0.06] text-oai-gray-700 dark:bg-white/[0.12] dark:text-oai-gray-200";
}

function statusLabel(state) {
  const key = STATE_LABELS[String(state || "")];
  return key ? copy(key) : copy("entire.state.unknown");
}

function MetaRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
      <span>{label}</span>
      <span className="max-w-[70%] truncate text-right font-medium text-oai-black dark:text-white" title={value}>
        {value}
      </span>
    </div>
  );
}

export function EntireStatusCard({ status = null, loading = false, error = "" }) {
  const state = String(status?.state || "");
  const label = useMemo(() => statusLabel(state), [state]);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.status.title")}</h2>

      {loading ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.status.loading")}</p>
      ) : error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          {copy("entire.status.error", { error })}
        </p>
      ) : !status ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.status.empty")}</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
              {copy("entire.status.state")}
            </span>
            <span className={`inline-flex h-6 items-center rounded-md px-2 text-xs font-medium ${stateClass(state)}`}>
              {label}
            </span>
          </div>
          {status?.version ? (
            <MetaRow label={copy("entire.status.version")} value={String(status.version)} />
          ) : null}
          {status?.checkpoint_branch_tip ? (
            <MetaRow
              label={copy("entire.status.tip")}
              value={String(status.checkpoint_branch_tip)}
            />
          ) : null}
          {status?.cached_state ? (
            <MetaRow label={copy("entire.status.cached_state")} value={String(status.cached_state)} />
          ) : null}
        </div>
      )}
    </Card>
  );
}
