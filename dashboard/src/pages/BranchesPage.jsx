import React, { useEffect, useMemo, useState } from "react";
import { Card, Input } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getBranchUsage } from "../lib/vibedeck-api";
import { BranchCostBars } from "../components/branches/BranchCostBars";
import { BranchProjectSummary } from "../components/branches/BranchProjectSummary";
import { BranchUsageTable } from "../components/branches/BranchUsageTable";
import { BranchSessionDrawer } from "../components/branches/BranchSessionDrawer";

function toCount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function toKnownCost(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flattenRows(repos) {
  if (!Array.isArray(repos)) return [];
  return repos.flatMap((repoEntry) => {
    const repoRoot = String(repoEntry?.repo_root || "");
    const branches = Array.isArray(repoEntry?.branches) ? repoEntry.branches : [];
    return branches.map((branchEntry) => ({
      ...branchEntry,
      repo_root: repoRoot,
    }));
  });
}

function repoLastSeenAt(repoEntry) {
  const branches = Array.isArray(repoEntry?.branches) ? repoEntry.branches : [];
  return branches.reduce((latest, branchEntry) => {
    const timestamp = Date.parse(String(branchEntry?.last_seen_at || ""));
    if (Number.isNaN(timestamp)) return latest;
    return Math.max(latest, timestamp);
  }, 0);
}

function sortReposByLastSeen(repos) {
  if (!Array.isArray(repos)) return [];
  return [...repos].sort((left, right) => {
    const rightSeenAt = repoLastSeenAt(right);
    const leftSeenAt = repoLastSeenAt(left);
    if (rightSeenAt !== leftSeenAt) return rightSeenAt - leftSeenAt;
    return String(left?.repo_root || "").localeCompare(String(right?.repo_root || ""));
  });
}

function repoPathSegments(repoRoot) {
  const normalized = String(repoRoot || "").trim();
  return normalized ? normalized.split(/[\\/]/).filter(Boolean) : [];
}

function repoBasename(repoRoot) {
  const parts = repoPathSegments(repoRoot);
  return parts[parts.length - 1] || String(repoRoot || "").trim() || "—";
}

function buildRepoOptionLabels(repos) {
  const basenameCounts = new Map();
  const labels = new Map();

  for (const repoEntry of repos || []) {
    const repoRoot = String(repoEntry?.repo_root || "");
    const basename = repoBasename(repoRoot);
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  for (const repoEntry of repos || []) {
    const repoRoot = String(repoEntry?.repo_root || "");
    const basename = repoBasename(repoRoot);
    labels.set(repoRoot, basenameCounts.get(basename) > 1 ? repoRoot || "—" : basename);
  }

  return labels;
}

function formatSummaryCostLabel(totals) {
  if (totals.costUnknown) return copy("branches.value.unknown_cost");
  const formatted = formatUsdCurrency(String(totals.cost));
  return totals.costEstimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

function formatTimestamp(value) {
  if (!value) return copy("branches.value.unknown_time");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function aggregateConfidence(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => ({
      high: acc.high + toCount(row?.confidence?.high),
      medium: acc.medium + toCount(row?.confidence?.medium),
      low: acc.low + toCount(row?.confidence?.low),
      unattributed: acc.unattributed + toCount(row?.confidence?.unattributed),
    }),
    { high: 0, medium: 0, low: 0, unattributed: 0 },
  );
}

function aggregateProviderModels(rows) {
  const summary = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
    const providerByModel = new Map();
    for (const session of sessions) {
      const model = String(session?.model || "").trim();
      const provider = String(session?.provider || "").trim();
      if (model && provider && !providerByModel.has(model)) {
        providerByModel.set(model, provider);
      }
    }

    for (const modelEntry of Array.isArray(row?.models) ? row.models : []) {
      const model = String(modelEntry?.model || "").trim();
      if (!model) continue;
      const provider = providerByModel.get(model) || copy("live.value.unknown_provider");
      const key = `${provider}:${model}`;
      const existing = summary.get(key) || { provider, model, total_tokens: 0 };
      existing.total_tokens += toCount(modelEntry?.total_tokens);
      summary.set(key, existing);
    }
  }

  return [...summary.values()]
    .sort((left, right) => right.total_tokens - left.total_tokens)
    .slice(0, 6);
}

function sortRowsForLedger(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const rightCost = toKnownCost(right?.total_cost_usd);
    const leftCost = toKnownCost(left?.total_cost_usd);
    const rightValue = rightCost ?? toCount(right?.total_tokens);
    const leftValue = leftCost ?? toCount(left?.total_tokens);
    if (rightValue !== leftValue) return rightValue - leftValue;
    return String(left?.branch || "").localeCompare(String(right?.branch || ""));
  });
}

export function BranchesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    getBranchUsage({ includeSessions: true, limit: 100 })
      .then((result) => {
        if (cancelled) return;
        setPayload(result || null);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : copy("branches.error.fallback");
        setError(message);
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const repos = useMemo(() => sortReposByLastSeen(payload?.repos || []), [payload]);
  const repoOptionLabels = useMemo(() => buildRepoOptionLabels(repos), [repos]);
  const effectiveSelectedRepo = useMemo(() => {
    if (repos.length === 0) return "";
    const hasCurrentSelection = repos.some((repoEntry) => String(repoEntry?.repo_root || "") === selectedRepo);
    return hasCurrentSelection ? selectedRepo : String(repos[0]?.repo_root || "");
  }, [repos, selectedRepo]);

  const selectedRepoEntry = useMemo(
    () => repos.find((repoEntry) => String(repoEntry?.repo_root || "") === effectiveSelectedRepo) || null,
    [repos, effectiveSelectedRepo],
  );

  const rows = useMemo(
    () => flattenRows(selectedRepoEntry ? [selectedRepoEntry] : []),
    [selectedRepoEntry],
  );

  const filteredRows = useMemo(() => {
    const branchNeedle = branchFilter.trim().toLowerCase();
    const matchingRows = rows.filter((row) => {
      const branchMatches = branchNeedle
        ? String(row?.branch || "").toLowerCase().includes(branchNeedle)
        : true;
      return branchMatches;
    });
    return sortRowsForLedger(matchingRows);
  }, [rows, branchFilter]);

  useEffect(() => {
    if (!selectedRow) return;
    const rowStillVisible = filteredRows.some(
      (row) =>
        String(row?.repo_root || "") === String(selectedRow?.repo_root || "")
        && String(row?.branch || "") === String(selectedRow?.branch || ""),
    );
    if (!rowStillVisible) setSelectedRow(null);
  }, [filteredRows, selectedRow]);

  const totals = useMemo(() => {
    if (!filteredRows.length) {
      return { tokens: 0, cost: 0, sessions: 0, costUnknown: false, costEstimated: false };
    }
    return filteredRows.reduce(
      (acc, row) => {
        const knownCost = toKnownCost(row?.total_cost_usd);
        return {
          tokens: acc.tokens + toCount(row?.total_tokens),
          cost: acc.cost + (knownCost ?? 0),
          sessions: acc.sessions + toCount(row?.session_count),
          costUnknown: acc.costUnknown || knownCost == null,
          costEstimated: acc.costEstimated || row?.cost_estimated === true,
        };
      },
      { tokens: 0, cost: 0, sessions: 0, costUnknown: false, costEstimated: false },
    );
  }, [filteredRows]);

  const appliedCount = filteredRows.length;
  const totalCount = rows.length;
  const summaryConfidence = useMemo(() => aggregateConfidence(filteredRows), [filteredRows]);
  const providerModels = useMemo(() => aggregateProviderModels(filteredRows), [filteredRows]);
  const lastSeenLabel = useMemo(() => {
    const latestSeenAt = filteredRows.reduce((latest, row) => {
      const timestamp = Date.parse(String(row?.last_seen_at || ""));
      return Number.isNaN(timestamp) ? latest : Math.max(latest, timestamp);
    }, 0);
    return latestSeenAt ? formatTimestamp(new Date(latestSeenAt).toISOString()) : copy("branches.value.unknown_time");
  }, [filteredRows]);
  const emptyMessage = repos.length === 0
    ? copy("branches.empty.no_repo_rows")
    : totalCount === 0
      ? copy("branches.project.empty")
      : copy("branches.empty");

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
      <header className="mb-4 min-w-0">
        <h1 className="text-xl font-semibold text-oai-black dark:text-white">{copy("branches.title")}</h1>
        <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.subtitle")}</p>
      </header>

      <div className="grid gap-4">
        <Card>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
            <div className="w-full">
              <label
                htmlFor="branches-project-select"
                className="mb-1.5 block text-sm font-medium text-oai-gray-700 transition-colors duration-200 dark:text-oai-gray-300"
              >
                {copy("branches.project.select_label")}
              </label>
              <select
                id="branches-project-select"
                value={effectiveSelectedRepo}
                onChange={(event) => setSelectedRepo(event.target.value)}
                disabled={repos.length === 0}
                className="h-10 w-full rounded-md border border-oai-gray-300 bg-oai-white px-3 text-sm text-oai-black transition-all duration-200 focus:border-oai-brand focus:outline-none focus:ring-1 focus:ring-oai-brand/30 disabled:cursor-not-allowed disabled:bg-oai-gray-50 disabled:text-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white dark:focus:border-oai-brand dark:disabled:bg-oai-gray-800 dark:disabled:text-oai-gray-400"
                aria-label={copy("branches.project.select_label")}
              >
                {repos.map((repoEntry) => {
                  const repoRoot = String(repoEntry?.repo_root || "");
                  return (
                    <option key={repoRoot} value={repoRoot} title={repoRoot || undefined}>
                      {repoOptionLabels.get(repoRoot) || "—"}
                    </option>
                  );
                })}
              </select>
            </div>
            <Input
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              placeholder={copy("branches.filter.branch.placeholder")}
              label={copy("branches.filter.branch.label")}
              aria-label={copy("branches.filter.branch.label")}
            />
          </div>
          <p className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("branches.filter.summary", { count: appliedCount, total: totalCount })}
          </p>
        </Card>

        {error ? (
          <Card>
            <p className="text-sm text-red-700 dark:text-red-300">{copy("branches.error", { error })}</p>
          </Card>
        ) : loading ? (
          <Card>
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.loading")}</p>
          </Card>
        ) : (
          <>
            <BranchProjectSummary
              repoRoot={effectiveSelectedRepo}
              branchCount={appliedCount}
              totals={totals}
              providerModels={providerModels}
              confidence={summaryConfidence}
              lastSeenLabel={lastSeenLabel}
            />
            <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
              <BranchCostBars repoRoot={effectiveSelectedRepo} rows={filteredRows} />
              <BranchUsageTable
                rows={filteredRows}
                onOpenSessions={setSelectedRow}
                emptyMessage={emptyMessage}
              />
            </div>
          </>
        )}
      </div>

      <BranchSessionDrawer
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </main>
  );
}
