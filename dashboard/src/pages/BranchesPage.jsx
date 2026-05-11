import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, CircleDollarSign, Cpu, MessagesSquare } from "lucide-react";
import { Card, Input } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getBranchUsage } from "../lib/vibedeck-api";
import { BranchUsageTable } from "../components/branches/BranchUsageTable";
import { BranchSessionDrawer } from "../components/branches/BranchSessionDrawer";
import { PageFrame } from "../components/PageFrame.jsx";

const BRANCHES_PAGE_SIZE = 10;

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

function attributionBranchName(value) {
  return String(value || "").replace(/~\d+$/, "");
}

function formatSummaryCostLabel(totals) {
  if (totals.costUnknown) return copy("branches.value.unknown_cost");
  return formatUsdCurrency(String(totals.cost));
}

function SummaryMetric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm px-5 py-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        <span className="inline-flex h-6 w-6 items-center justify-center text-oai-gray-500 dark:text-oai-gray-300">
          <Icon className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span>{label}</span>
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums text-oai-black dark:text-white">
        {value}
      </div>
    </div>
  );
}

export function BranchesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [branchPage, setBranchPage] = useState(0);

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

  const gitBranches = useMemo(() => {
    return Array.isArray(selectedRepoEntry?.git_branches)
      ? selectedRepoEntry.git_branches.map((branchName) => String(branchName || "").trim()).filter(Boolean)
      : [];
  }, [selectedRepoEntry]);

  const attributionBranchCounts = useMemo(() => {
    const counts = new Map();
    for (const row of rows) {
      const branchName = String(row?.attribution_branch || attributionBranchName(row?.branch));
      if (!branchName) continue;
      counts.set(branchName, (counts.get(branchName) || 0) + 1);
    }
    return counts;
  }, [rows]);

  const effectiveSelectedBranch = useMemo(() => {
    if (gitBranches.length === 0) return "";
    if (gitBranches.includes(selectedBranch)) return selectedBranch;
    return gitBranches.find((branchName) => attributionBranchCounts.has(branchName)) || gitBranches[0];
  }, [attributionBranchCounts, gitBranches, selectedBranch]);

  const filteredRows = useMemo(() => {
    const branchNeedle = branchFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const attributionBranch = String(row?.attribution_branch || attributionBranchName(row?.branch));
      const selectedBranchMatches = effectiveSelectedBranch
        ? attributionBranch === effectiveSelectedBranch
        : true;
      const branchMatches = branchNeedle
        ? String(row?.branch || "").toLowerCase().includes(branchNeedle)
        : true;
      return selectedBranchMatches && branchMatches;
    });
  }, [rows, branchFilter, effectiveSelectedBranch]);

  useEffect(() => {
    setBranchPage(0);
  }, [effectiveSelectedRepo, effectiveSelectedBranch, branchFilter]);

  useEffect(() => {
    setSelectedBranch("");
  }, [effectiveSelectedRepo]);

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
  const pageCount = Math.ceil(appliedCount / BRANCHES_PAGE_SIZE);
  const boundedPage = pageCount > 0 ? Math.min(branchPage, pageCount - 1) : 0;
  const pagedRows = filteredRows.slice(
    boundedPage * BRANCHES_PAGE_SIZE,
    boundedPage * BRANCHES_PAGE_SIZE + BRANCHES_PAGE_SIZE,
  );
  const emptyMessage = repos.length === 0
    ? copy("branches.empty.no_repo_rows")
    : totalCount === 0
      ? copy("branches.project.empty")
      : copy("branches.empty");

  return (
    <PageFrame maxWidth="max-w-[1760px]" hideHeader>
      <div className="grid min-h-0 gap-5 overflow-hidden">
        <Card bodyClassName="p-6">
          <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="w-full">
              <label
                htmlFor="branches-project-select"
                className="mb-1.5 block text-sm font-medium text-oai-gray-700 transition-colors duration-200 dark:text-oai-gray-300"
              >
                {copy("branches.project.select_label")}
              </label>
              <div className="relative">
                <select
                  id="branches-project-select"
                  value={effectiveSelectedRepo}
                  onChange={(event) => setSelectedRepo(event.target.value)}
                  disabled={repos.length === 0}
                  className="h-10 w-full appearance-none rounded-md border border-oai-gray-300 bg-oai-white px-3 pr-10 text-sm text-oai-black transition-all duration-200 focus:border-oai-brand focus:outline-none focus:ring-2 focus:ring-oai-brand/20 disabled:cursor-not-allowed disabled:bg-oai-gray-50 disabled:text-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white dark:focus:border-oai-brand dark:disabled:bg-oai-gray-800 dark:disabled:text-oai-gray-400"
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
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400 dark:text-oai-gray-500"
                  aria-hidden
                />
              </div>
            </div>
            <div className="w-full">
              <label
                htmlFor="branches-branch-select"
                className="mb-1.5 block text-sm font-medium text-oai-gray-700 transition-colors duration-200 dark:text-oai-gray-300"
              >
                {copy("branches.branch.select_label")}
              </label>
              <div className="relative">
                <select
                  id="branches-branch-select"
                  value={effectiveSelectedBranch}
                  onChange={(event) => setSelectedBranch(event.target.value)}
                  disabled={gitBranches.length === 0}
                  className="h-10 w-full appearance-none rounded-md border border-oai-gray-300 bg-oai-white px-3 pr-10 text-sm text-oai-black transition-all duration-200 focus:border-oai-brand focus:outline-none focus:ring-2 focus:ring-oai-brand/20 disabled:cursor-not-allowed disabled:bg-oai-gray-50 disabled:text-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white dark:focus:border-oai-brand dark:disabled:bg-oai-gray-800 dark:disabled:text-oai-gray-400"
                  aria-label={copy("branches.branch.select_label")}
                >
                  {gitBranches.map((branchName) => (
                    <option key={branchName} value={branchName}>
                      {branchName}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400 dark:text-oai-gray-500"
                  aria-hidden
                />
              </div>
            </div>
            <Input
              value={branchFilter}
              onChange={(event) => setBranchFilter(event.target.value)}
              placeholder={copy("branches.filter.branch.placeholder")}
              label={copy("branches.filter.branch.label")}
              aria-label={copy("branches.filter.branch.label")}
            />
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <SummaryMetric
              icon={Cpu}
              label={copy("branches.total.tokens")}
              value={toDisplayNumber(totals.tokens)}
            />
            <SummaryMetric
              icon={CircleDollarSign}
              label={copy("branches.total.cost")}
              value={formatSummaryCostLabel(totals)}
            />
            <SummaryMetric
              icon={MessagesSquare}
              label={copy("branches.total.sessions")}
              value={toDisplayNumber(totals.sessions)}
            />
          </div>
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
          <BranchUsageTable
            className="max-h-[calc(100dvh-300px)]"
            rows={pagedRows}
            onOpenSessions={setSelectedRow}
            emptyMessage={emptyMessage}
            page={boundedPage}
            pageCount={pageCount}
            pageSize={BRANCHES_PAGE_SIZE}
            totalRows={appliedCount}
            onPageChange={setBranchPage}
          />
        )}
      </div>

      <BranchSessionDrawer
        row={selectedRow}
        onClose={() => setSelectedRow(null)}
      />
    </PageFrame>
  );
}
