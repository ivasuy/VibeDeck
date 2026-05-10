import React, { useEffect, useMemo, useState } from "react";
import { Select } from "@base-ui/react/select";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import { copy } from "../../../lib/copy";
import { formatCompactNumber, toDisplayNumber, toFiniteNumber } from "../../../lib/format";
import { shouldFetchGithubStars } from "../util/should-fetch-github-stars.js";
import {
  ProjectUsageBreakdown,
  formatProjectUsageCostLabel,
  resolveProjectUsageCostValue,
} from "./ProjectUsageBreakdown.jsx";

const LIMIT_OPTIONS = [3, 6, 10];
const REPO_META_CACHE = new Map();

function splitRepoKey(value) {
  if (typeof value !== "string") return { owner: "", repo: "" };
  const [owner, repo] = value.split("/");
  return { owner: owner || "", repo: repo || "" };
}

function normalizeStars(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.round(value));
}

function normalizeRepoName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\.git$/i, "");
}

function parseGithubRepoId(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("git@github.com:")) {
    return normalizeRepoName(trimmed.slice("git@github.com:".length));
  }

  try {
    const url = new URL(trimmed);
    if (url.hostname !== "github.com") return "";
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return "";
    return normalizeRepoName(`${parts[0]}/${parts[1]}`);
  } catch {
    return "";
  }
}

function parseRepoKey(value) {
  if (typeof value !== "string") return "";
  const parts = value.trim().split("/").filter(Boolean);
  if (parts.length !== 2) return "";
  return normalizeRepoName(`${parts[0]}/${parts[1]}`);
}

function formatLastUsed(value) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function resolveProjectIdentity(entry, placeholder) {
  const projectKey = typeof entry?.project_key === "string" ? entry.project_key : "";
  const projectRef = typeof entry?.project_ref === "string" ? entry.project_ref : "";
  const githubRepoFromRef = parseGithubRepoId(projectRef);
  const fallbackGithubRepo = projectRef ? "" : parseRepoKey(projectKey);
  const githubRepoId = githubRepoFromRef || fallbackGithubRepo;
  const keyRepoId = parseRepoKey(projectKey);
  const displayRepoId = githubRepoId || keyRepoId;
  const { owner, repo } = splitRepoKey(displayRepoId);

  return {
    displayName: repo || projectKey || placeholder,
    githubRepoId,
    owner,
    repo,
    href: projectRef || (githubRepoId ? `https://github.com/${githubRepoId}` : "#"),
  };
}

function resolveTokens(entry) {
  if (!entry) return null;
  const total = entry.total_tokens ?? null;
  const billable = entry.billable_total_tokens ?? null;
  const billableValue = toFiniteNumber(billable);
  const totalValue = toFiniteNumber(total);
  if (billableValue === 0 && totalValue != null && totalValue > 0) {
    return total;
  }
  return billable ?? total ?? null;
}

function resolveProjectCost(entry) {
  return resolveProjectUsageCostValue(entry);
}

function resolveTopModel(entry) {
  const topModel = Array.isArray(entry?.top_models) ? entry.top_models[0] : null;
  if (!topModel) return null;
  const model = String(topModel?.model || "").trim();
  if (!model) return null;
  const provider = String(topModel?.provider || "").trim();
  return provider ? `${model} · ${provider}` : model;
}

function resolveRepoMeta(repoId) {
  if (!repoId) return null;
  return REPO_META_CACHE.get(repoId) || null;
}

function cacheRepoMeta(repoId, meta) {
  if (!repoId || !meta) return;
  REPO_META_CACHE.set(repoId, meta);
}

function useGithubRepoMeta(repoId) {
  const [state, setState] = useState(() => resolveRepoMeta(repoId) || null);

  useEffect(() => {
    if (!repoId) return;
    const cached = resolveRepoMeta(repoId);
    if (cached) {
      setState(cached);
      return;
    }

    if (typeof window === "undefined") return;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const screenshotCapture =
      typeof document !== "undefined" &&
      (document.documentElement?.classList.contains("screenshot-capture") ||
        document.body?.classList.contains("screenshot-capture"));
    if (!shouldFetchGithubStars({ prefersReducedMotion, screenshotCapture })) {
      return;
    }

    let active = true;
    fetch(`https://api.github.com/repos/${repoId}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        const meta = {
          stars: normalizeStars(data?.stargazers_count),
          avatarUrl: typeof data?.owner?.avatar_url === "string" ? data.owner.avatar_url : null,
        };
        cacheRepoMeta(repoId, meta);
        setState(meta);
      })
      .catch(() => {
        if (!active) return;
        const meta = { stars: null, avatarUrl: null };
        cacheRepoMeta(repoId, meta);
        setState(meta);
      });

    return () => {
      active = false;
    };
  }, [repoId]);

  return state;
}

export function ProjectUsagePanel({
  entries = [],
  limit = 3,
  onLimitChange,
  loading = false,
  error = null,
  className = "",
}) {
  const placeholder = copy("shared.placeholder.short");
  const tokensLabel = copy("dashboard.projects.tokens_label");
  const starsLabel = copy("dashboard.projects.stars_label");
  const emptyLabel = copy("dashboard.projects.empty");
  const limitLabel = copy("dashboard.projects.limit_label");
  const limitAria = copy("dashboard.projects.limit_aria");
  const optionLabels = {
    3: copy("dashboard.projects.limit_top_3"),
    6: copy("dashboard.projects.limit_top_6"),
    10: copy("dashboard.projects.limit_top_10"),
  };
  const resolvedLimit = LIMIT_OPTIONS.includes(limit) ? limit : LIMIT_OPTIONS[0];
  const displayEntries = useMemo(
    () => (Array.isArray(entries) ? entries.slice(0, Math.max(1, limit)) : []),
    [entries, limit],
  );
  const [expandedKey, setExpandedKey] = useState(null);

  const tokenFormatOptions = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
    decimals: 1,
  };

  useEffect(() => {
    const keys = new Set(
      displayEntries.map((entry) => `${entry?.project_key || "repo"}-${entry?.project_ref || ""}`),
    );
    if (!expandedKey || keys.has(expandedKey)) return;
    setExpandedKey(null);
  }, [displayEntries, expandedKey]);

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
          {copy("dashboard.projects.title")}
        </h3>
        <Select.Root
          value={resolvedLimit}
          items={LIMIT_OPTIONS.map((value) => ({
            value,
            label: optionLabels[value],
          }))}
          onValueChange={(value) => {
            if (typeof onLimitChange === "function" && value != null) {
              onLimitChange(value);
            }
          }}
        >
          <Select.Trigger
            aria-label={limitAria}
            className="px-2 py-1 text-xs text-oai-gray-600 dark:text-oai-gray-300 bg-white dark:bg-oai-gray-900 border border-oai-gray-200 dark:border-oai-gray-700 rounded hover:border-oai-gray-300 dark:hover:border-oai-gray-600"
          >
            <Select.Value />
          </Select.Trigger>
          <Select.Portal>
            <Select.Positioner align="end" side="bottom" sideOffset={4} className="z-50">
              <Select.Popup className="w-32 border border-oai-gray-200 dark:border-oai-gray-700 bg-white dark:bg-oai-gray-900 rounded-lg shadow-lg">
                <Select.List aria-label={limitAria} role="listbox">
                  {LIMIT_OPTIONS.map((value) => (
                    <Select.Item
                      key={value}
                      value={value}
                      className={({ selected }) =>
                        `w-full text-left px-3 py-2 text-xs ${
                          selected
                            ? "bg-oai-gray-100 dark:bg-oai-gray-800 text-oai-black dark:text-oai-white"
                            : "text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
                        }`
                      }
                    >
                      <Select.ItemText>{optionLabels[value]}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>

      {displayEntries.length === 0 ? (
        <div className="text-sm text-oai-gray-400 dark:text-oai-gray-400">{emptyLabel}</div>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
          {displayEntries.map((entry) => (
            <ProjectUsageCard
              key={`${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
              entryKey={`${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
              entry={entry}
              placeholder={placeholder}
              tokensLabel={tokensLabel}
              starsLabel={starsLabel}
              tokenFormatOptions={tokenFormatOptions}
              expanded={expandedKey === `${entry?.project_key || "repo"}-${entry?.project_ref || ""}`}
              onToggleExpand={(entryKey) =>
                setExpandedKey((current) => (current === entryKey ? null : entryKey))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectUsageCard({
  entryKey,
  entry,
  placeholder,
  tokensLabel,
  starsLabel,
  tokenFormatOptions,
  expanded = false,
  onToggleExpand,
}) {
  const {
    displayName,
    githubRepoId,
    owner,
    href,
  } = resolveProjectIdentity(entry, placeholder);
  const meta = useGithubRepoMeta(githubRepoId);
  const avatarUrl =
    meta?.avatarUrl || (owner && githubRepoId ? `https://github.com/${owner}.png?size=80` : "");
  const starsRaw = meta?.stars;
  const starsFull =
    starsRaw == null ? placeholder : toDisplayNumber(starsRaw);
  const starsCompact =
    starsRaw == null
      ? placeholder
      : formatCompactNumber(starsRaw, tokenFormatOptions);
  const tokensRaw = resolveTokens(entry);
  const tokensFull =
    tokensRaw == null ? placeholder : toDisplayNumber(tokensRaw);
  const tokensCompact =
    tokensRaw == null
      ? placeholder
      : formatCompactNumber(tokensRaw, tokenFormatOptions);
  const lastUsed = formatLastUsed(entry?.last_seen_at);
  const totalCost = formatProjectUsageCostLabel(resolveProjectCost(entry), entry?.cost_estimated === true);
  const topModelHint = resolveTopModel(entry);
  const githubAria = copy("dashboard.projects.github_link_aria", { project: displayName });
  const providers = Array.isArray(entry?.providers) ? entry.providers : [];
  const showExternalLink = Boolean(href && href !== "#");
  const buttonAriaLabel = expanded
    ? copy("dashboard.projects.collapse_project", { project: displayName })
    : copy("dashboard.projects.expand_project", { project: displayName });

  return (
    <div className="overflow-hidden rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-700 dark:bg-oai-gray-900">
      <div className="flex items-stretch">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={buttonAriaLabel}
          onClick={() => onToggleExpand?.(entryKey)}
          className="flex flex-1 items-center gap-3 p-4 text-left transition-colors hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/70"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-10 w-10 rounded bg-oai-gray-100 object-cover dark:bg-oai-gray-800" />
          ) : (
            <div className="h-10 w-10 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-oai-black dark:text-oai-white">
                  {displayName}
                </div>
                {lastUsed ? (
                  <div className="mt-0.5 truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("dashboard.projects.last_used", { time: lastUsed })}
                  </div>
                ) : null}
              </div>
              <div className="shrink-0 text-right">
                <div className="text-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                  {totalCost}
                </div>
                {topModelHint ? (
                  <div className="mt-0.5 max-w-[160px] truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                    {topModelHint}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-oai-gray-400 dark:text-oai-gray-400">
              <span title={`${starsLabel}: ${starsFull}`}>★ {starsCompact}</span>
              <span title={`${tokensLabel}: ${tokensFull}`}>{tokensCompact}</span>
              {topModelHint ? (
                <span className="truncate text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("dashboard.projects.top_model_label")}: {topModelHint}
                </span>
              ) : null}
            </div>
          </div>
          <div className="shrink-0 text-oai-gray-400 dark:text-oai-gray-500" aria-hidden="true">
            {expanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
          </div>
        </button>

        {showExternalLink ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={githubAria}
            className="flex w-11 items-center justify-center border-l border-oai-gray-200 text-oai-gray-400 transition-colors hover:bg-oai-gray-50 hover:text-oai-black dark:border-oai-gray-700 dark:text-oai-gray-500 dark:hover:bg-oai-gray-800/70 dark:hover:text-oai-white"
          >
            <ExternalLink className="h-4 w-4" aria-hidden />
          </a>
        ) : null}
      </div>

      {expanded ? <ProjectUsageBreakdown providers={providers} /> : null}
    </div>
  );
}
