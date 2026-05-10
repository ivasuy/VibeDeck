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

export function BranchesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState(null);
  const [repoFilter, setRepoFilter] = useState("");
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

  const rows = useMemo(() => flattenRows(payload?.repos), [payload]);

  const filteredRows = useMemo(() => {
    const repoNeedle = repoFilter.trim().toLowerCase();
    const branchNeedle = branchFilter.trim().toLowerCase();
    return rows.filter((row) => {
      const repoMatches = repoNeedle
        ? String(row?.repo_root || "").toLowerCase().includes(repoNeedle)
        : true;
      const branchMatches = branchNeedle
        ? String(row?.branch || "").toLowerCase().includes(branchNeedle)
        : true;
      return repoMatches && branchMatches;
    });
  }, [rows, repoFilter, branchFilter]);

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
  const emptyMessage = totalCount === 0
    ? copy("branches.empty.no_repo_rows")
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
            <Input
              value={repoFilter}
              onChange={(event) => setRepoFilter(event.target.value)}
              placeholder={copy("branches.filter.repo.placeholder")}
              label={copy("branches.filter.repo.label")}
              aria-label={copy("branches.filter.repo.label")}
            />
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
