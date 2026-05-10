import React, { useMemo } from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency } from "../../lib/format";
import { CostTokenPair, MiniBarChart, MetricStrip, ProjectIdentity, ProviderModelChips } from "../../ui/ops";
import { LiveBranchGroup } from "./LiveBranchGroup";

function sessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function repoRootOf(row) {
  return String(row?.repo_root || row?.cwd || "").trim();
}

function branchOf(row) {
  return String(row?.branch || "").trim() || copy("live.value.unattributed_branch");
}

function sortByRecent(a, b) {
  const left = String(a?.updated_at || a?.last_observed_at || a?.observed_at || a?.started_at || "");
  const right = String(b?.updated_at || b?.last_observed_at || b?.observed_at || b?.started_at || "");
  return right.localeCompare(left);
}

function sessionCostValue(row) {
  const costQuality = String(row?.cost_quality || "");
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(costQuality)) return null;
  const preferredCost = row?.estimated_total_cost_usd ?? row?.total_cost_usd;
  if (preferredCost == null || preferredCost === "") return null;
  const numeric = Number(preferredCost);
  return Number.isFinite(numeric) ? numeric : null;
}

function aggregateConfidence(rows) {
  return rows.reduce(
    (summary, row) => {
      const key = String(row?.confidence || "").toLowerCase();
      if (key === "high" || key === "medium" || key === "low") summary[key] += 1;
      else summary.unattributed += 1;
      return summary;
    },
    { high: 0, medium: 0, low: 0, unattributed: 0 },
  );
}

function aggregateProviderModels(rows) {
  const keyed = new Map();
  for (const row of rows) {
    const provider = String(row?.provider || copy("live.value.unknown_provider"));
    const model = String(row?.model || "—");
    const key = `${provider}::${model}`;
    const current = keyed.get(key) || { provider, model, total_tokens: 0 };
    const totalTokens = Number(row?.total_tokens ?? 0);
    current.total_tokens += Number.isFinite(totalTokens) ? totalTokens : 0;
    keyed.set(key, current);
  }

  return Array.from(keyed.values())
    .sort((left, right) => right.total_tokens - left.total_tokens)
    .slice(0, 4);
}

function summarizeRows(rows) {
  let totalTokens = 0;
  let totalCost = 0;
  let knownCostCount = 0;
  let estimated = false;

  for (const row of rows) {
    const numericTokens = Number(row?.total_tokens ?? 0);
    totalTokens += Number.isFinite(numericTokens) ? numericTokens : 0;

    const cost = sessionCostValue(row);
    if (cost != null) {
      totalCost += cost;
      knownCostCount += 1;
    }
    if (row?.cost_estimated || cost == null) estimated = true;
  }

  return {
    totalTokens,
    totalCost: knownCostCount > 0 ? totalCost : null,
    costEstimated: estimated,
    confidence: aggregateConfidence(rows),
    providerModels: aggregateProviderModels(rows),
  };
}

function updatedAtOf(row) {
  return row?.updated_at || row?.last_observed_at || row?.observed_at || row?.started_at || row?.ended_at || null;
}

function formatTimestamp(value) {
  if (!value) return copy("live.value.unknown_time");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function groupProjects(rows) {
  const projects = new Map();

  for (const row of rows) {
    const key = sessionKey(row);
    if (!key) continue;

    const normalized = { ...row, key };
    const repoRoot = repoRootOf(row);
    const projectKey = repoRoot || "__unknown_project__";
    const project = projects.get(projectKey) || {
      key: projectKey,
      repoRoot,
      sessions: [],
      branches: new Map(),
    };
    project.sessions.push(normalized);

    const branchKey = branchOf(row);
    const branch = project.branches.get(branchKey) || {
      key: `${projectKey}:${branchKey}`,
      branch: branchKey,
      sessions: [],
    };
    branch.sessions.push(normalized);
    project.branches.set(branchKey, branch);
    projects.set(projectKey, project);
  }

  return Array.from(projects.values())
    .map((project) => {
      const branchGroups = Array.from(project.branches.values())
        .map((branch) => {
          const sessions = branch.sessions.slice().sort(sortByRecent);
          const summary = summarizeRows(sessions);
          return {
            ...branch,
            sessions,
            ...summary,
            updatedAtLabel: formatTimestamp(updatedAtOf(sessions[0])),
          };
        })
        .sort((left, right) => sortByRecent(left.sessions[0], right.sessions[0]));

      const sessions = project.sessions.slice().sort(sortByRecent);
      return {
        ...project,
        sessions,
        branchGroups,
        ...summarizeRows(sessions),
        updatedAtLabel: formatTimestamp(updatedAtOf(sessions[0])),
      };
    })
    .sort((left, right) => sortByRecent(left.sessions[0], right.sessions[0]));
}

export function LiveProjectWorkbench({
  sessions = [],
  selectedKey = null,
  onSelectSession,
  streamStatus = "idle",
  streamError = null,
}) {
  const activeSessions = useMemo(() => (Array.isArray(sessions) ? sessions : []), [sessions]);
  const projects = useMemo(() => groupProjects(activeSessions), [activeSessions]);

  const counts = useMemo(() => {
    let branches = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let knownCostCount = 0;
    let estimatedCost = false;
    for (const project of projects) {
      branches += project.branchGroups.length;
      totalTokens += project.totalTokens;
      if (project.totalCost != null) {
        totalCost += project.totalCost;
        knownCostCount += 1;
      }
      if (project.costEstimated || project.totalCost == null) estimatedCost = true;
    }
    return {
      projectCount: projects.length,
      branchCount: branches,
      totalTokens,
      totalCost: knownCostCount > 0 ? totalCost : null,
      estimatedCost,
    };
  }, [projects]);

  if (!activeSessions.length) {
    return (
      <EmptyWorkbenchState
        connected={streamStatus === "connected"}
        streamError={streamError}
      />
    );
  }

  return (
    <div className="space-y-4">
      <MetricStrip
        items={[
          {
            key: "projects",
            label: copy("live.workbench.metrics.projects"),
            value: String(counts.projectCount),
            accent: "project",
          },
          {
            key: "branches",
            label: copy("live.workbench.metrics.branches"),
            value: String(counts.branchCount),
            accent: "branch",
          },
          {
            key: "tokens",
            label: copy("live.workbench.metrics.tokens"),
            value: counts.totalTokens.toLocaleString(),
            accent: "live",
          },
          {
            key: "cost",
            label: copy("live.workbench.metrics.cost"),
            value:
              counts.totalCost != null
                ? `${formatUsdCurrency(String(counts.totalCost))}${counts.estimatedCost ? ` ${copy("live.cost.estimated_suffix")}` : ""}`
                : "—",
            accent: "cost",
          },
        ]}
      />

      {streamError ? (
        <div className="rounded-lg border border-red-200/70 bg-red-500/[0.04] px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:text-red-300">
          {copy("live.workbench.stream_error", { error: streamError })}
        </div>
      ) : null}

      <div className="space-y-4">
        {projects.map((project) => (
          <Card key={project.key} bodyClassName="space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <ProjectIdentity
                repoRoot={project.repoRoot || copy("live.workbench.project.unknown_repo")}
              />
              <div className="text-right">
                <div className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("live.workbench.project.updated_label")}
                </div>
                <div className="text-sm text-oai-gray-700 dark:text-oai-gray-200">
                  {project.updatedAtLabel}
                </div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-4 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                      {copy("live.workbench.project.summary")}
                    </div>
                    <div className="mt-1 text-sm text-oai-gray-700 dark:text-oai-gray-200">
                      {copy("live.workbench.project.summary_counts", {
                        branches: project.branchGroups.length,
                        sessions: project.sessions.length,
                      })}
                    </div>
                  </div>
                  <div className="text-right">
                    <CostTokenPair
                      cost={project.totalCost}
                      tokens={project.totalTokens}
                      estimated={project.costEstimated}
                      className="justify-end"
                    />
                  </div>
                </div>
                <ProviderModelChips items={project.providerModels} />
              </div>

              <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-4 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
                <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("live.workbench.project.branch_costs")}
                </div>
                <MiniBarChart
                  ariaLabel={copy("live.workbench.project.branch_costs_aria", {
                    repo: project.repoRoot || copy("live.workbench.project.unknown_repo"),
                  })}
                  accent="branch"
                  rows={project.branchGroups.map((branchGroup) => ({
                    key: branchGroup.key,
                    label: branchGroup.branch,
                    value: branchGroup.totalCost ?? branchGroup.totalTokens,
                    valueLabel:
                      branchGroup.totalCost != null
                        ? `${branchGroup.costEstimated ? "~" : ""}${formatUsdCurrency(String(branchGroup.totalCost))}`
                        : copy("live.workbench.project.branch_costs_tokens_fallback", {
                          tokens: branchGroup.totalTokens,
                        }),
                  }))}
                />
              </div>
            </div>

            <div className="space-y-4">
              {project.branchGroups.map((branchGroup) => (
                <LiveBranchGroup
                  key={branchGroup.key}
                  branchGroup={branchGroup}
                  selectedKey={selectedKey}
                  onSelectSession={onSelectSession}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

function EmptyWorkbenchState({ connected, streamError }) {
  const title = connected
    ? copy("live.empty.connected_title")
    : copy("live.empty.title");
  const description = connected
    ? copy("live.empty.connected_subtitle")
    : copy("live.empty.subtitle");

  return (
    <div className="space-y-4">
      {streamError ? (
        <div className="rounded-lg border border-red-200/70 bg-red-500/[0.04] px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:text-red-300">
          {copy("live.workbench.stream_error", { error: streamError })}
        </div>
      ) : null}
      <Card>
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{title}</h2>
        <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{description}</p>
      </Card>
    </div>
  );
}
