import React, { useEffect, useMemo, useState } from "react";
import { Card, Input } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getBranchUsage } from "../lib/vibedeck-api";
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
    return rows.filter((row) => {
      const branchMatches = branchNeedle
        ? String(row?.branch || "").toLowerCase().includes(branchNeedle)
        : true;
      return branchMatches;
    });
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
      return { tokens: 0, cost: 0, sessions: 0, costUnknown: false };
    }
    return filteredRows.reduce(
      (acc, row) => {
        const knownCost = toKnownCost(row?.total_cost_usd);
        return {
          tokens: acc.tokens + toCount(row?.total_tokens),
          cost: acc.cost + (knownCost ?? 0),
          sessions: acc.sessions + toCount(row?.session_count),
          costUnknown: acc.costUnknown || knownCost == null,
        };
      },
      { tokens: 0, cost: 0, sessions: 0, costUnknown: false },
    );
  }, [filteredRows]);

  const appliedCount = filteredRows.length;
  const totalCount = rows.length;
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
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-oai-black/[0.03] px-3 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
              <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
                {copy("branches.total.tokens")}
              </div>
              <div className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
                {toDisplayNumber(totals.tokens)}
              </div>
            </div>
            <div className="rounded-md bg-oai-black/[0.03] px-3 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
              <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
                {copy("branches.total.cost")}
              </div>
              <div className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
                {totals.costUnknown ? copy("branches.value.unknown_cost") : formatUsdCurrency(String(totals.cost))}
              </div>
            </div>
            <div className="rounded-md bg-oai-black/[0.03] px-3 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
              <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
                {copy("branches.total.sessions")}
              </div>
              <div className="mt-1 text-sm font-semibold text-oai-black dark:text-white">
                {toDisplayNumber(totals.sessions)}
              </div>
            </div>
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
          <BranchUsageTable rows={filteredRows} onOpenSessions={setSelectedRow} emptyMessage={emptyMessage} />
        )}
      </div>

      <BranchSessionDrawer
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </main>
  );
}
