import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleDollarSign, Cpu, MessagesSquare } from "lucide-react";
import { Card, Input } from "../ui/openai/components";
import { copy } from "../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getBranchUsage } from "../lib/vibedeck-api";
import { readLastGood, writeLastGood } from "../lib/last-good-cache";
import { BranchUsageTable } from "../components/branches/BranchUsageTable";
import { BranchSessionDrawer } from "../components/branches/BranchSessionDrawer";
import { PageFrame } from "../components/PageFrame.jsx";

const BRANCHES_PAGE_SIZE = 10;
const BRANCH_SUMMARY_CACHE_KEY = "branches.summary.default";

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
    const repoRoot = repoOptionValue(repoEntry);
    const branches = Array.isArray(repoEntry?.branches) ? repoEntry.branches : [];
    return branches.map((branchEntry) => ({
      ...branchEntry,
      repo_root: repoRoot,
    }));
  });
}

function repoOptionValue(repoEntry) {
  return String(repoEntry?.repo_root || repoEntry?.project_ref || repoEntry?.project_key || "");
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
    return repoOptionValue(left).localeCompare(repoOptionValue(right));
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

function repoParentBasename(repoRoot) {
  const parts = repoPathSegments(repoRoot);
  return parts.length > 1 ? parts[parts.length - 2] : "";
}

const GENERIC_PROJECT_CONTEXT = new Set([
  "users",
  "downloads",
  "documents",
  "desktop",
  "projects",
  "project",
  "library",
  "cloudstorage",
  "onedrive",
  "tmp",
  "temp",
  "private",
  "var",
  "folders",
]);

function repoOptionTitle(repoEntry) {
  const values = [
    repoEntry?.repo_root,
    repoEntry?.project_ref,
    ...(Array.isArray(repoEntry?.workspace_paths) ? repoEntry.workspace_paths : []),
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return Array.from(new Set(values)).join("\n");
}

function usefulParentContext(repoRoot) {
  const parts = repoPathSegments(repoRoot);
  if (parts.length <= 1) return "";
  const parents = parts.slice(0, -1);

  if (parts[parts.length - 1] === "T" && parents.includes("folders")) return "temp";

  const immediate = parents[parents.length - 1] || "";
  const previous = parents[parents.length - 2] || "";
  const immediateLower = immediate.toLowerCase();

  if (immediate && !GENERIC_PROJECT_CONTEXT.has(immediateLower)) {
    if (immediate.length <= 3 && previous && !GENERIC_PROJECT_CONTEXT.has(previous.toLowerCase())) {
      return `${previous}/${immediate}`;
    }
    return immediate;
  }

  for (let index = parents.length - 2; index >= 0; index -= 1) {
    const part = parents[index];
    if (parents[index - 1]?.toLowerCase() === "users") continue;
    if (part && !GENERIC_PROJECT_CONTEXT.has(part.toLowerCase())) return part;
  }
  return "";
}

function buildRepoOptionLabels(repos) {
  const basenameCounts = new Map();
  const labels = new Map();
  const labelCounts = new Map();

  for (const repoEntry of repos || []) {
    const repoRoot = repoOptionValue(repoEntry);
    const basename = String(repoEntry?.project_key || repoBasename(repoRoot)).trim() || repoBasename(repoRoot);
    basenameCounts.set(basename, (basenameCounts.get(basename) || 0) + 1);
  }

  for (const repoEntry of repos || []) {
    const repoRoot = repoOptionValue(repoEntry);
    const basename = String(repoEntry?.project_key || repoBasename(repoRoot)).trim() || repoBasename(repoRoot);
    let label = basename;
    if (repoEntry?.workspace_family && repoEntry?.workspace_context && repoEntry?.archived) {
      label = `${basename} · ${repoEntry.workspace_context}`;
    } else if (basenameCounts.get(basename) > 1) {
      const parent = usefulParentContext(repoRoot);
      label = parent ? `${basename} · ${parent}` : basename;
    }
    const finalLabel = repoEntry?.archived ? `${label} (${copy("shared.badge.decommissioned")})` : label;
    labels.set(repoRoot, {
      baseLabel: label,
      label: repoEntry?.archived ? `${label} (${copy("shared.badge.decommissioned")})` : label,
      title: repoOptionTitle(repoEntry) || repoRoot || undefined,
      archived: Boolean(repoEntry?.archived),
      fallbackContext: repoParentBasename(repoRoot),
    });
    labelCounts.set(finalLabel, (labelCounts.get(finalLabel) || 0) + 1);
  }

  for (const [repoRoot, meta] of labels.entries()) {
    if ((labelCounts.get(meta.label) || 0) <= 1) continue;
    const fallback = String(meta.fallbackContext || "").trim();
    if (!fallback) continue;
    const nextBase = meta.baseLabel.includes(" · ") ? meta.baseLabel : `${meta.baseLabel} · ${fallback}`;
    labels.set(repoRoot, {
      ...meta,
      label: meta.archived ? `${nextBase} (${copy("shared.badge.decommissioned")})` : nextBase,
    });
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

function trackedBranchName(row) {
  const branchName = String(row?.attribution_branch || attributionBranchName(row?.branch)).trim();
  return branchName || String(row?.branch || "").trim();
}

function trackedBranchOptions(rows) {
  const options = [];
  const seen = new Set();
  for (const row of rows) {
    const branchName = trackedBranchName(row);
    if (!branchName || seen.has(branchName)) continue;
    seen.add(branchName);
    options.push(branchName);
  }
  return options;
}

function SummaryMetric({ icon: Icon, label, value }) {
  return (
    <div className="vd-subcard rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm px-5 py-4">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
        <span className="inline-flex h-6 w-6 items-center justify-center text-oai-brand-500 dark:text-oai-brand-300">
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

function SummaryMetricSkeleton() {
  return (
    <div className="vd-subcard rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm px-5 py-4">
      <div className="text-[11px] uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
        Loading branch totals...
      </div>
      <div className="shimmer mt-3 h-7 w-28 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
    </div>
  );
}

function BranchTableSkeleton() {
  return (
    <Card className="flex min-h-[260px] overflow-hidden shadow-sm" bodyClassName="!p-0 flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--glass-border)] px-5 py-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        Loading branch usage...
      </div>
      <div className="grid gap-3 p-5" aria-busy="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-4">
            <div className="shimmer h-8 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            <div className="shimmer h-8 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            <div className="shimmer h-8 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            <div className="shimmer h-8 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
          </div>
        ))}
      </div>
    </Card>
  );
}

function branchDetailCacheKey(row, sessionDate = "latest") {
  return `branches.detail.${String(row?.repo_root || "")}.${String(row?.branch || "")}.${String(sessionDate || "latest")}`;
}

export function BranchesPage() {
  const [payload, setPayload] = useState(() => readLastGood(BRANCH_SUMMARY_CACHE_KEY));
  const [loading, setLoading] = useState(() => !readLastGood(BRANCH_SUMMARY_CACHE_KEY));
  const [refreshing, setRefreshing] = useState(() => Boolean(readLastGood(BRANCH_SUMMARY_CACHE_KEY)));
  const [error, setError] = useState("");
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [sessionDetailsLoading, setSessionDetailsLoading] = useState(false);
  const [sessionDetailsError, setSessionDetailsError] = useState("");
  const [branchPage, setBranchPage] = useState(0);
  const sessionDetailsRequestRef = useRef(0);
  const payloadRef = useRef(payload);

  useEffect(() => {
    payloadRef.current = payload;
  }, [payload]);

  useEffect(() => {
    let cancelled = false;
    const hasCachedPayload = Boolean(payloadRef.current);
    setLoading(!hasCachedPayload);
    setRefreshing(hasCachedPayload);
    setError("");
    getBranchUsage({ includeSessions: false, includeArchived: true, limit: 100 })
      .then((result) => {
        if (cancelled) return;
        const nextPayload = result || null;
        setPayload(nextPayload);
        if (nextPayload) writeLastGood(BRANCH_SUMMARY_CACHE_KEY, nextPayload);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : copy("branches.error.fallback");
        setError(message);
        if (!payloadRef.current) setPayload(null);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const repos = useMemo(() => sortReposByLastSeen(payload?.repos || []), [payload]);
  const repoOptionLabels = useMemo(() => buildRepoOptionLabels(repos), [repos]);
  const effectiveSelectedRepo = useMemo(() => {
    if (repos.length === 0) return "";
    const hasCurrentSelection = repos.some((repoEntry) => repoOptionValue(repoEntry) === selectedRepo);
    return hasCurrentSelection ? selectedRepo : repoOptionValue(repos[0]);
  }, [repos, selectedRepo]);

  const selectedRepoEntry = useMemo(
    () => repos.find((repoEntry) => repoOptionValue(repoEntry) === effectiveSelectedRepo) || null,
    [repos, effectiveSelectedRepo],
  );

  const rows = useMemo(
    () => flattenRows(selectedRepoEntry ? [selectedRepoEntry] : []),
    [selectedRepoEntry],
  );

  const trackedBranches = useMemo(() => trackedBranchOptions(rows), [rows]);

  const effectiveSelectedBranch = useMemo(() => {
    if (trackedBranches.length === 0) return "";
    if (trackedBranches.includes(selectedBranch)) return selectedBranch;
    return trackedBranches[0];
  }, [trackedBranches, selectedBranch]);

  const filteredRows = useMemo(() => {
    const branchNeedle = branchFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const attributionBranch = trackedBranchName(row);
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

  function closeSessionDrawer() {
    sessionDetailsRequestRef.current += 1;
    setSelectedRow(null);
    setSessionDetailsLoading(false);
    setSessionDetailsError("");
  }

  function loadSessionDetails(row, sessionDate = "latest") {
    const baseRow = row || null;
    const requestedDate = sessionDate || "latest";
    const cachedDetail = readLastGood(branchDetailCacheKey(baseRow, requestedDate));
    if (cachedDetail) {
      setSelectedRow({ ...baseRow, ...cachedDetail });
      setSessionDetailsLoading(false);
      setSessionDetailsError("");
      return;
    }
    const requestId = sessionDetailsRequestRef.current + 1;
    sessionDetailsRequestRef.current = requestId;
    setSelectedRow(baseRow);
    setSessionDetailsLoading(true);
    setSessionDetailsError("");

    getBranchUsage({
      includeSessions: true,
      includeArchived: true,
      includeDateBuckets: true,
      sessionDate: requestedDate,
      limit: 100,
      repo: baseRow?.repo_root || undefined,
      branch: baseRow?.branch || undefined,
    })
      .then((result) => {
        if (sessionDetailsRequestRef.current !== requestId) return;
        const detailRows = flattenRows(result?.repos || []);
        const detailRow = detailRows.find(
          (candidate) =>
            String(candidate?.repo_root || "") === String(baseRow?.repo_root || "")
            && String(candidate?.branch || "") === String(baseRow?.branch || ""),
        );
        if (detailRow) writeLastGood(branchDetailCacheKey(baseRow, requestedDate), detailRow);
        setSelectedRow(detailRow ? { ...baseRow, ...detailRow } : baseRow);
      })
      .catch((cause) => {
        if (sessionDetailsRequestRef.current !== requestId) return;
        const message = cause instanceof Error ? cause.message : copy("branches.error.fallback");
        setSessionDetailsError(message);
        setSelectedRow(baseRow);
      })
      .finally(() => {
        if (sessionDetailsRequestRef.current === requestId) setSessionDetailsLoading(false);
      });
  }

  function openSessionDrawer(row) {
    loadSessionDetails(row, "latest");
  }

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
      <div className="grid min-h-0 gap-6">
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
                  className="vd-control h-10 w-full appearance-none rounded-md border border-oai-gray-300 bg-oai-white px-3 pr-10 text-sm text-oai-black transition-all duration-200 focus:border-oai-brand focus:outline-none focus:ring-2 focus:ring-oai-brand/20 disabled:cursor-not-allowed disabled:bg-oai-gray-50 disabled:text-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white dark:focus:border-oai-brand dark:disabled:bg-oai-gray-800 dark:disabled:text-oai-gray-400"
                  aria-label={copy("branches.project.select_label")}
                >
                  {repos.map((repoEntry) => {
                    const repoRoot = repoOptionValue(repoEntry);
                    const optionMeta = repoOptionLabels.get(repoRoot);
                    return (
                      <option key={repoRoot} value={repoRoot} title={optionMeta?.title || repoRoot || undefined}>
                        {optionMeta?.label || "—"}
                      </option>
                    );
                  })}
                </select>
                <ChevronDown
                  className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400 dark:text-oai-gray-500"
                  aria-hidden
                />
              </div>
              {selectedRepoEntry?.archived ? (
                <div className="mt-2">
                  <span className="vd-chip inline-flex items-center rounded-md border border-amber-300/60 bg-amber-50 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
                    {copy("shared.badge.decommissioned")}
                  </span>
                </div>
              ) : null}
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
                  disabled={trackedBranches.length <= 1}
                  className="vd-control h-10 w-full appearance-none rounded-md border border-oai-gray-300 bg-oai-white px-3 pr-10 text-sm text-oai-black transition-all duration-200 focus:border-oai-brand focus:outline-none focus:ring-2 focus:ring-oai-brand/20 disabled:cursor-not-allowed disabled:bg-oai-gray-50 disabled:text-oai-gray-400 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white dark:focus:border-oai-brand dark:disabled:bg-oai-gray-800 dark:disabled:text-oai-gray-400"
                  aria-label={copy("branches.branch.select_label")}
                >
                  {trackedBranches.map((branchName) => (
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
          {refreshing ? (
            <div className="mt-4 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
              Refreshing branch usage...
            </div>
          ) : null}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {loading && !payload ? (
              <>
                <SummaryMetricSkeleton />
                <SummaryMetricSkeleton />
                <SummaryMetricSkeleton />
              </>
            ) : (
              <>
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
              </>
            )}
          </div>
        </Card>

        {error ? (
          <Card>
            <p className="text-sm text-red-700 dark:text-red-300">{copy("branches.error", { error })}</p>
          </Card>
        ) : loading && !payload ? (
          <BranchTableSkeleton />
        ) : (
          <BranchUsageTable
            className="max-h-[calc(100dvh-300px)]"
            rows={pagedRows}
            onOpenSessions={openSessionDrawer}
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
        loading={sessionDetailsLoading}
        error={sessionDetailsError}
        onSelectDate={(sessionDate) => selectedRow && loadSessionDetails(selectedRow, sessionDate)}
        onClose={closeSessionDrawer}
      />
    </PageFrame>
  );
}
