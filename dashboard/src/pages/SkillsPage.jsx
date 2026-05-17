import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { Select } from "@base-ui/react/select";
import {
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { Button, Card, ConfirmModal, Input } from "../ui/openai/components";
import { ProviderIcon } from "../ui/matrix-a/components/ProviderIcon.jsx";
import { PageFrame } from "../components/PageFrame.jsx";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import {
  addSkillRepo,
  deleteLocalSkill,
  discoverSkills,
  getInstalledSkills,
  getSkillRepos,
  importLocalSkill,
  installSkill,
  removeSkillRepo,
  restoreSkill,
  searchSkills,
  setSkillTargets,
  uninstallSkill,
} from "../lib/skills-api";

const DEFAULT_TARGETS = ["claude", "codex"];
const SKILLS_PAGE_SIZE = 10;
const TARGET_ACTIVE_CLASSES = {
  claude: "bg-orange-500/10 ring-1 ring-orange-500/20 hover:bg-orange-500/20",
  codex: "bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20",
  gemini: "bg-sky-500/10 ring-1 ring-sky-500/20 hover:bg-sky-500/20",
  opencode: "bg-amber-500/10 ring-1 ring-amber-500/20 hover:bg-amber-500/20",
  hermes: "bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20",
};
const SOURCE_ALL = "all";
const SOURCE_SKILLSSH = "skillssh";
const EMPTY_SKILLS_PAGE = {
  skills: [],
  totalCount: 0,
  offset: 0,
  limit: SKILLS_PAGE_SIZE,
  emptyReason: "",
  loaded: false,
};
const EMPTY_INSTALLED_PAGE = {
  ...EMPTY_SKILLS_PAGE,
  targets: [],
  installedKeys: [],
  query: "",
};

function getSkillKey(skill) {
  return `${skill.repoOwner || "local"}/${skill.repoName || "local"}:${skill.directory}`;
}

function installBusyKey(skill) {
  return `install:${getSkillKey(skill)}`;
}

function removeBusyKey(skill) {
  return `remove:${skill.id || skill.directory}`;
}

function targetBusyKey(skillId, targetId) {
  return `target:${skillId}:${targetId}`;
}

function TargetToggleGroup({ skill, targets, busyKey, onToggleTarget }) {
  const activeTargets = new Set(skill.targets || []);
  return (
    <div className="flex flex-wrap gap-1">
      {targets.map((target) => {
        const checked = activeTargets.has(target.id);
        const busy = busyKey === targetBusyKey(skill.id, target.id);
        const tooltipKey = checked ? "skills.target.remove_title" : "skills.target.sync_title";
        return (
          <button
            key={target.id}
            type="button"
            aria-pressed={checked}
            aria-label={copy("skills.target.toggle_aria", { target: target.label })}
            title={copy(tooltipKey, { target: target.label })}
            disabled={busy}
            onClick={() => onToggleTarget(skill, target.id, !checked)}
            className={cn(
              "inline-flex h-8 w-8 items-center justify-center rounded-md transition disabled:cursor-wait disabled:opacity-70",
              checked
                ? TARGET_ACTIVE_CLASSES[target.id] || "bg-oai-gray-100 dark:bg-oai-gray-800"
                : "opacity-40 grayscale hover:bg-oai-gray-100 hover:opacity-100 hover:grayscale-0 dark:hover:bg-oai-gray-800",
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ProviderIcon provider={target.id} size={16} />
            )}
          </button>
        );
      })}
    </div>
  );
}

function SkillRow({ skill, targets, busyKey, onToggleTarget, onRemove }) {
  const removing = busyKey === removeBusyKey(skill);
  const sourceLabel =
    skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : null;
  const titleAttr = sourceLabel ? `${skill.directory} · ${sourceLabel}` : skill.directory;

  return (
    <div className="group grid gap-4 px-2 py-4 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
      <div className="min-w-0" title={titleAttr}>
        <h2 className="truncate text-sm font-semibold text-oai-black dark:text-white">
          {skill.name || skill.directory}
        </h2>
        {skill.description ? (
          <p className="mt-0.5 line-clamp-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {skill.description}
          </p>
        ) : null}
      </div>

      <TargetToggleGroup
        skill={skill}
        targets={targets}
        busyKey={busyKey}
        onToggleTarget={onToggleTarget}
      />

      <button
        type="button"
        aria-label={copy("skills.action.remove")}
        title={copy("skills.action.remove")}
        disabled={removing}
        onClick={() => onRemove(skill)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-oai-gray-400 opacity-0 transition duration-200 hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 focus:opacity-100 disabled:cursor-wait disabled:opacity-100 dark:hover:bg-red-950/30 dark:hover:text-red-300 lg:justify-self-end"
      >
        {removing ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Trash2 className="h-4 w-4" aria-hidden />
        )}
      </button>
    </div>
  );
}

function MySkillsView({ items, targets, busyKey, onToggleTarget, onRemove }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-2 pb-3 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy("skills.my.count", { count: items.length })}
      </div>
      <div className="min-h-0 flex-1 overflow-auto divide-y divide-oai-gray-200/70 pr-1 dark:divide-oai-gray-800/70">
        {items.map((skill) => (
          <SkillRow
            key={skill.id || skill.key}
            skill={skill}
            targets={targets}
            busyKey={busyKey}
            onToggleTarget={onToggleTarget}
            onRemove={onRemove}
          />
        ))}
      </div>
    </div>
  );
}

function PaginationControls({ page, pageCount, total, onPageChange }) {
  if (!Number.isFinite(pageCount) || pageCount <= 1) return null;
  const currentPage = Math.min(Math.max(0, page), pageCount - 1);
  const start = currentPage * SKILLS_PAGE_SIZE + 1;
  const end = Math.min(total, (currentPage + 1) * SKILLS_PAGE_SIZE);

  return (
    <div className="mt-3 flex shrink-0 flex-col gap-2 border-t border-oai-gray-200 pt-3 text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400 sm:flex-row sm:items-center sm:justify-between">
      <div>
        {start}-{end} of {total}
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          {copy("details.pagination.prev")}
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          {currentPage + 1} / {pageCount}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={currentPage + 1 >= pageCount}
          onClick={() => onPageChange(currentPage + 1)}
        >
          {copy("details.pagination.next")}
        </Button>
      </div>
    </div>
  );
}

const BROWSE_CARD_STYLE = {
  contentVisibility: "auto",
  containIntrinsicSize: "0 240px",
};

const BrowseCard = React.memo(function BrowseCard({ skill, installed, installing, allTargets, defaultTargets, onInstall }) {
  const [selectedTargets, setSelectedTargets] = useState(() =>
    (defaultTargets || []).filter((id) => allTargets.some((t) => t.id === id)),
  );

  const toggleTarget = (id) => {
    setSelectedTargets((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );
  };

  const sourceLabel = skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : null;
  const installsLabel = skill.installs != null
    ? copy("skills.card.installs", { count: Number(skill.installs || 0).toLocaleString() })
    : null;
  const meta = [sourceLabel, installsLabel].filter(Boolean).join(" · ");
  const targetSummary = selectedTargets.length
    ? selectedTargets
        .map((id) => allTargets.find((t) => t.id === id)?.label || id)
        .join(", ")
    : copy("skills.action.choose_targets");

  return (
    <Card
      className="h-full rounded-lg"
      bodyClassName="flex h-full flex-col !p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {skill.readmeUrl ? (
            <a
              href={skill.readmeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex max-w-full items-center gap-1 truncate text-base font-semibold text-oai-black hover:underline dark:text-white"
              title={skill.readmeUrl}
            >
              <span className="truncate">{skill.name || skill.directory}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-oai-gray-400 opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
            </a>
          ) : (
            <h2 className="truncate text-base font-semibold text-oai-black dark:text-white">
              {skill.name || skill.directory}
            </h2>
          )}
          {meta ? (
            <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">{meta}</div>
          ) : null}
        </div>
        {installed ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-oai-black/[0.06] px-2 py-1 text-xs font-medium text-oai-gray-700 ring-1 ring-oai-black/10 dark:bg-white/[0.08] dark:text-oai-gray-200 dark:ring-white/10">
            <Check className="h-3 w-3" aria-hidden />
            {copy("skills.card.installed")}
          </span>
        ) : null}
      </div>

      {skill.description ? (
        <p className="mt-3 line-clamp-2 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
          {skill.description}
        </p>
      ) : null}

      <div className="mt-auto pt-4">
        {installed ? (
          <div className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-oai-black/[0.04] text-sm font-medium text-oai-gray-700 ring-1 ring-inset ring-oai-black/[0.08] dark:bg-white/[0.05] dark:text-oai-gray-200 dark:ring-white/[0.08]">
            <Check className="h-3.5 w-3.5" aria-hidden />
            {copy("skills.card.installed")}
          </div>
        ) : (
          <div className="flex">
            <Button
              type="button"
              size="sm"
              onClick={() => onInstall(skill, selectedTargets)}
              disabled={installing || selectedTargets.length === 0}
              className="flex-1 !rounded-r-none"
              title={targetSummary}
            >
              {installing ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden />
              )}
              {selectedTargets.length > 1
                ? copy("skills.action.install_to", { count: selectedTargets.length })
                : copy("skills.action.install")}
            </Button>
            <Popover.Root>
              <Popover.Trigger
                disabled={installing}
                aria-label={copy("skills.action.choose_targets")}
                title={targetSummary}
                className="inline-flex h-8 items-center justify-center rounded-r-md border-l border-white/20 bg-oai-brand px-2 text-white transition-colors hover:bg-oai-brand-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-oai-brand-950/30 dark:bg-oai-brand-400 dark:text-oai-brand-950 dark:hover:bg-oai-brand-300"
              >
                <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner sideOffset={6} side="bottom" align="end" className="!z-[80]">
                  <Popover.Popup className="vd-popover min-w-[200px] rounded-lg border p-1.5">
                    <div className="px-2 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                      {copy("skills.target.menu_label")}
                    </div>
                    {allTargets.map((target) => {
                      const checked = selectedTargets.includes(target.id);
                      return (
                        <button
                          key={target.id}
                          type="button"
                          onClick={() => toggleTarget(target.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm",
                            checked
                              ? "vd-tab-active"
                              : "vd-tab",
                          )}
                        >
                          <ProviderIcon
                            provider={target.id}
                            size={16}
                            className={checked ? "" : "grayscale opacity-40"}
                          />
                          <span className="flex-1 text-left">{target.label}</span>
                          {checked ? (
                            <Check className="h-3.5 w-3.5 text-oai-brand-500 dark:text-oai-brand-300" aria-hidden />
                          ) : null}
                        </button>
                      );
                    })}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </div>
        )}
      </div>
    </Card>
  );
});

function RepoManager({ repos, repoInput, onRepoInput, busyKey, onAdd, onRemove, onClose }) {
  return (
    <div className="rounded-lg border border-oai-gray-200 bg-white p-3 dark:border-oai-gray-800 dark:bg-oai-gray-950">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-oai-black dark:text-white">
            {copy("skills.repo.title")}
          </div>
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("skills.repo.subtitle")}
          </div>
        </div>
        {onClose ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="shrink-0"
          >
            {copy("skills.repo.done")}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={repoInput}
          onChange={(event) => onRepoInput(event.target.value)}
          placeholder={copy("skills.repo.placeholder")}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="secondary"
          size="md"
          onClick={onAdd}
          disabled={busyKey === "repo:add"}
          className="shrink-0 whitespace-nowrap"
        >
          {busyKey === "repo:add" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {busyKey === "repo:add" ? copy("skills.repo.adding") : copy("skills.repo.add")}
        </Button>
      </div>
      {repos.length ? (
        <div className="mt-3 divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
          {repos.map((repo) => {
            const removing = busyKey === `repo:${repo.owner}/${repo.name}`;
            return (
              <div key={`${repo.owner}/${repo.name}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-oai-black dark:text-white">
                    {repo.owner}/{repo.name}
                  </div>
                  <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{repo.branch}</div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  onClick={() => onRemove(repo)}
                  className="shrink-0"
                >
                  {removing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  <span className="sr-only">{copy("skills.repo.remove")}</span>
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function readTabFromUrl() {
  if (typeof window === "undefined") return "my";
  const params = new URLSearchParams(window.location.search);
  return params.get("tab") === "browse" ? "browse" : "my";
}

export function SkillsPage() {
  const [tab, setTab] = useState(readTabFromUrl);
  const [installedData, setInstalledData] = useState(EMPTY_INSTALLED_PAGE);
  const [discoverData, setDiscoverData] = useState({ ...EMPTY_SKILLS_PAGE, source: SOURCE_ALL, query: "" });
  const [searchData, setSearchData] = useState({ ...EMPTY_SKILLS_PAGE, query: "" });
  const [repos, setRepos] = useState([]);
  const [source, setSource] = useState(SOURCE_ALL);
  const [query, setQuery] = useState("");
  const [activeSkillsShQuery, setActiveSkillsShQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [myQuery, setMyQuery] = useState("");
  const [debouncedMyQuery, setDebouncedMyQuery] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [myLoading, setMyLoading] = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState(null);
  const [toast, setToast] = useState(null); // { message, undo, key }
  const [myPage, setMyPage] = useState(0);
  const [browsePage, setBrowsePage] = useState(0);
  const installedRequestRef = useRef(0);
  const discoverRequestRef = useRef(0);
  const skillsShRequestRef = useRef(0);

  const installedKeys = useMemo(() => {
    const keys = new Set();
    for (const key of installedData.installedKeys || []) {
      keys.add(String(key).toLowerCase());
    }
    for (const skill of installedData.skills || []) {
      keys.add(getSkillKey(skill).toLowerCase());
      if (skill.repoOwner && skill.repoName) {
        keys.add(`${skill.repoOwner}/${skill.repoName}:${skill.sourceDirectory || skill.directory}`.toLowerCase());
      }
      // Directory-name fallback so unmanaged installs (no repoOwner recorded
      // — e.g. CLI-installed skills physically placed under ~/.claude/skills/)
      // still match browse entries from skills.sh or GitHub by skill folder name.
      const tail = String(skill.directory || "").split(/[\\/]/).pop().toLowerCase();
      if (tail) keys.add(`dir:${tail}`);
    }
    return keys;
  }, [installedData.installedKeys, installedData.skills]);

  const loadInstalledPage = useCallback(async ({ page = 0, q = "" } = {}) => {
    const queryText = String(q || "").trim();
    const requestId = installedRequestRef.current + 1;
    installedRequestRef.current = requestId;
    setMyLoading(true);
    try {
      const data = await getInstalledSkills({
        offset: page * SKILLS_PAGE_SIZE,
        limit: SKILLS_PAGE_SIZE,
        q: queryText,
      });
      if (requestId !== installedRequestRef.current) return;
      setInstalledData({
        skills: data.skills || [],
        targets: data.targets || [],
        totalCount: Number(data.totalCount ?? (data.skills || []).length),
        offset: Number(data.offset ?? page * SKILLS_PAGE_SIZE),
        limit: Number(data.limit ?? SKILLS_PAGE_SIZE),
        installedKeys: data.installedKeys || [],
        query: queryText,
        loaded: true,
      });
    } catch (err) {
      if (requestId === installedRequestRef.current) throw err;
    } finally {
      if (requestId === installedRequestRef.current) setMyLoading(false);
    }
  }, []);

  const loadRepos = useCallback(async () => {
    const data = await getSkillRepos();
    setRepos(data.repos || []);
  }, []);

  const loadDiscoverPage = useCallback(async ({ force = false, page = 0, q = "", sourceValue = SOURCE_ALL } = {}) => {
    const queryText = String(q || "").trim();
    const resolvedSource = sourceValue || SOURCE_ALL;
    const requestId = discoverRequestRef.current + 1;
    discoverRequestRef.current = requestId;
    setBrowseLoading(true);
    try {
      const data = await discoverSkills({
        force,
        offset: page * SKILLS_PAGE_SIZE,
        limit: SKILLS_PAGE_SIZE,
        source: resolvedSource,
        q: queryText,
      });
      if (requestId !== discoverRequestRef.current) return;
      setDiscoverData({
        skills: data.skills || [],
        totalCount: Number(data.totalCount ?? (data.skills || []).length),
        offset: Number(data.offset ?? page * SKILLS_PAGE_SIZE),
        limit: Number(data.limit ?? SKILLS_PAGE_SIZE),
        source: resolvedSource,
        query: queryText,
        emptyReason: data.emptyReason || "",
        loaded: true,
      });
    } catch (err) {
      if (requestId === discoverRequestRef.current) throw err;
    } finally {
      if (requestId === discoverRequestRef.current) setBrowseLoading(false);
    }
  }, []);

  const loadSkillsShSearchPage = useCallback(async ({ page = 0, q = "" } = {}) => {
    const queryText = String(q || "").trim();
    if (queryText.length < 2) {
      setSearchData({ ...EMPTY_SKILLS_PAGE, query: queryText });
      return;
    }
    const requestId = skillsShRequestRef.current + 1;
    skillsShRequestRef.current = requestId;
    setBrowseLoading(true);
    try {
      const data = await searchSkills(queryText, page * SKILLS_PAGE_SIZE, SKILLS_PAGE_SIZE);
      if (requestId !== skillsShRequestRef.current) return;
      setSearchData({
        skills: data.skills || [],
        totalCount: Number(data.totalCount ?? (data.skills || []).length),
        offset: Number(data.offset ?? page * SKILLS_PAGE_SIZE),
        limit: Number(data.limit ?? SKILLS_PAGE_SIZE),
        query: queryText,
        loaded: true,
      });
    } catch (err) {
      if (requestId === skillsShRequestRef.current) throw err;
    } finally {
      if (requestId === skillsShRequestRef.current) setBrowseLoading(false);
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadInstalledPage({ page: 0, q: "" }), loadRepos()]);
    } catch (err) {
      setError(err?.message || copy("skills.error.generic"));
    } finally {
      setLoading(false);
    }
  }, [loadInstalledPage, loadRepos]);

  const handleRefresh = useCallback(async () => {
    await loadInitial();
    if (tab === "browse" && source !== SOURCE_SKILLSSH) {
      loadDiscoverPage({
        force: true,
        page: browsePage,
        q: debouncedQuery,
        sourceValue: source,
      }).catch((err) =>
        setError(err?.message || copy("skills.error.generic")),
      );
    }
  }, [browsePage, debouncedQuery, loadDiscoverPage, loadInitial, source, tab]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (tab !== "my") return;
    if (loading) return;
    const queryText = debouncedMyQuery.trim();
    const requestedOffset = myPage * SKILLS_PAGE_SIZE;
    if (
      installedData.loaded &&
      installedData.offset === requestedOffset &&
      (installedData.query || "") === queryText
    ) {
      return;
    }
    loadInstalledPage({ page: myPage, q: queryText }).catch((err) =>
      setError(err?.message || copy("skills.error.generic")),
    );
  }, [debouncedMyQuery, installedData.offset, installedData.query, loadInstalledPage, loading, myPage, tab]);

  useEffect(() => {
    if (tab !== "browse") return;
    if (source === SOURCE_SKILLSSH) return;
    const queryText = debouncedQuery.trim();
    const requestedOffset = browsePage * SKILLS_PAGE_SIZE;
    if (
      discoverData.loaded &&
      discoverData.offset === requestedOffset &&
      discoverData.source === source &&
      (discoverData.query || "") === queryText
    ) {
      return;
    }
    loadDiscoverPage({ page: browsePage, q: queryText, sourceValue: source }).catch((err) =>
      setError(err?.message || copy("skills.error.generic")),
    );
  }, [browsePage, debouncedQuery, discoverData.offset, discoverData.query, discoverData.source, loadDiscoverPage, source, tab]);

  useEffect(() => {
    if (tab !== "browse") return;
    if (source !== SOURCE_SKILLSSH) return;
    const queryText = activeSkillsShQuery.trim();
    if (queryText.length < 2) return;
    const requestedOffset = browsePage * SKILLS_PAGE_SIZE;
    if (browsePage === 0 && (searchData.query || "") !== queryText) return;
    if (searchData.loaded && searchData.offset === requestedOffset && (searchData.query || "") === queryText) {
      return;
    }
    loadSkillsShSearchPage({ page: browsePage, q: queryText }).catch((err) =>
      setError(err?.message || copy("skills.error.generic")),
    );
  }, [activeSkillsShQuery, browsePage, loadSkillsShSearchPage, searchData.offset, searchData.query, source, tab]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast((current) => (current?.key === toast.key ? null : current)), toast.ttlMs || 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMyQuery(myQuery), 200);
    return () => clearTimeout(timer);
  }, [myQuery]);

  useEffect(() => {
    setMyPage(0);
  }, [debouncedMyQuery, tab]);

  useEffect(() => {
    setBrowsePage(0);
  }, [debouncedQuery, source, tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const current = params.get("tab");
    if (tab === "my") {
      if (!current) return;
      params.delete("tab");
    } else {
      if (current === tab) return;
      params.set("tab", tab);
    }
    const search = params.toString();
    const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", next);
  }, [tab]);

  const runMutation = async (key, task) => {
    setBusyKey(key);
    setError("");
    try {
      await task();
      await loadInstalledPage({ page: myPage, q: debouncedMyQuery });
    } catch (err) {
      setError(err?.message || copy("skills.error.generic"));
    } finally {
      setBusyKey("");
    }
  };

  const handleInstall = (skill, targets) => {
    const finalTargets = (targets && targets.length ? targets : DEFAULT_TARGETS).filter(
      (id) => (installedData.targets || []).some((t) => t.id === id),
    );
    runMutation(installBusyKey(skill), async () => {
      await installSkill(skill, finalTargets);
      const labels = finalTargets
        .map((id) => (installedData.targets || []).find((t) => t.id === id)?.label || id)
        .join(", ");
      setToast({
        key: `${Date.now()}:install:${getSkillKey(skill)}`,
        message: copy("skills.toast.installed", {
          name: skill.name || skill.directory,
          targets: labels || copy("skills.target.none"),
        }),
        ttlMs: 4000,
      });
    });
  };

  const handleRemove = (skill) => {
    setPendingRemove(skill);
  };

  const confirmRemove = () => {
    const skill = pendingRemove;
    if (!skill) return;
    setPendingRemove(null);
    runMutation(removeBusyKey(skill), async () => {
      let result = null;
      if (skill.managed) {
        result = await uninstallSkill(skill.id);
      } else {
        await deleteLocalSkill(skill.directory, skill.targets || []);
      }
      const canUndo = Boolean(result?.trashed && skill.managed && skill.id);
      setToast({
        key: `${Date.now()}:${skill.id || skill.directory}`,
        message: copy("skills.toast.removed", { name: skill.name || skill.directory }),
        undo: canUndo
          ? async () => {
              try {
                await restoreSkill(skill.id);
                await loadInstalledPage({ page: myPage, q: debouncedMyQuery });
                setToast(null);
              } catch (err) {
                setError(err?.message || copy("skills.error.generic"));
              }
            }
          : null,
        ttlMs: 5000,
      });
    });
  };

  const handleToggleTarget = (skill, targetId, enabled) =>
    runMutation(targetBusyKey(skill.id, targetId), async () => {
      const next = new Set(skill.targets || []);
      if (enabled) next.add(targetId);
      else next.delete(targetId);
      if (skill.managed) {
        await setSkillTargets(skill.id, Array.from(next));
      } else {
        // Unmanaged → promote to managed via importLocalSkill so toggling any
        // target updates registry + SSOT uniformly.
        await importLocalSkill(skill.directory, Array.from(next));
      }
    });

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setBusyKey("search");
    setError("");
    try {
      setBrowsePage(0);
      setActiveSkillsShQuery(trimmed);
      await loadSkillsShSearchPage({ page: 0, q: trimmed });
    } catch (err) {
      setError(err?.message || copy("skills.error.generic"));
    } finally {
      setBusyKey("");
    }
  };

  const handleAddRepo = async () => {
    const raw = repoInput.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    const [owner, name] = raw.split("/");
    if (!owner || !name) {
      setError(copy("skills.repo.invalid"));
      return;
    }
    setBusyKey("repo:add");
    setError("");
    try {
      const result = await addSkillRepo({ owner, name, branch: "main", enabled: true });
      const repo = result?.repo || { owner, name, branch: "main" };
      const repoKey = `${repo.owner}/${repo.name}`;
      setRepoInput("");
      await loadRepos();
      setManageOpen(false);
      setSource(repoKey);
      setQuery("");
      setDebouncedQuery("");
      setActiveSkillsShQuery("");
      setBrowsePage(0);
      setDiscoverData({ ...EMPTY_SKILLS_PAGE, source: repoKey, query: "" });
      await loadDiscoverPage({ force: true, page: 0, q: "", sourceValue: repoKey });
    } catch (err) {
      setError(err?.message || copy("skills.error.generic"));
    } finally {
      setBusyKey("");
    }
  };

  const handleRemoveRepo = async (repo) => {
    const repoKey = `${repo.owner}/${repo.name}`;
    setBusyKey(`repo:${repoKey}`);
    setError("");
    try {
      await removeSkillRepo(repo.owner, repo.name);
      await loadRepos();
      const nextSource = source === repoKey ? SOURCE_ALL : source;
      if (nextSource !== source) {
        setSource(nextSource);
        setBrowsePage(0);
        setDiscoverData({ ...EMPTY_SKILLS_PAGE, source: nextSource, query: debouncedQuery.trim() });
      }
      await loadDiscoverPage({
        force: true,
        page: nextSource === source ? browsePage : 0,
        q: debouncedQuery,
        sourceValue: nextSource,
      });
    } catch (err) {
      setError(err?.message || copy("skills.error.generic"));
    } finally {
      setBusyKey("");
    }
  };

  const targets = installedData.targets || [];
  const mySkills = installedData.skills || [];
  const myQueryText = debouncedMyQuery.trim();
  const myDataMatches =
    installedData.loaded &&
    installedData.offset === myPage * SKILLS_PAGE_SIZE &&
    (installedData.query || "") === myQueryText;
  const myTotal = myDataMatches ? Number(installedData.totalCount ?? mySkills.length) : 0;
  const myPageCount = Math.max(1, Math.ceil(myTotal / SKILLS_PAGE_SIZE));
  const boundedMyPage = Math.min(myPage, myPageCount - 1);
  const pagedMySkills = myDataMatches ? mySkills : [];

  const browseItems = useMemo(() => {
    const page = source === SOURCE_SKILLSSH ? searchData : discoverData;
    return (page.skills || []).map((skill) => {
      const fullKey = getSkillKey(skill).toLowerCase();
      const tail = String(skill.directory || "").split(/[\\/]/).pop().toLowerCase();
      const dirKey = tail ? `dir:${tail}` : "";
      return {
        ...skill,
        installed: installedKeys.has(fullKey) || (dirKey && installedKeys.has(dirKey)),
      };
    });
  }, [discoverData, installedKeys, searchData, source]);

  const activeBrowseData = source === SOURCE_SKILLSSH ? searchData : discoverData;
  const browseQueryText = source === SOURCE_SKILLSSH ? activeSkillsShQuery.trim() : debouncedQuery.trim();
  const browseDataMatches =
    activeBrowseData.loaded &&
    activeBrowseData.offset === browsePage * SKILLS_PAGE_SIZE &&
    (activeBrowseData.query || "") === browseQueryText &&
    (source === SOURCE_SKILLSSH || activeBrowseData.source === source);
  const visibleBrowseItems = browseDataMatches ? browseItems : [];
  const browseTotal = Number(activeBrowseData.totalCount ?? browseItems.length);
  const browsePageCount = Math.max(1, Math.ceil(browseTotal / SKILLS_PAGE_SIZE));
  const boundedBrowsePage = Math.min(browsePage, browsePageCount - 1);
  const pagedBrowseItems = visibleBrowseItems;

  const loadingNode = (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-oai-gray-400" aria-hidden />
    </div>
  );
  const browseLoadingNode = (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-oai-gray-400" aria-hidden />
      <p className="max-w-md text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy("skills.browse.loading_hint")}
      </p>
    </div>
  );
  const emptyNode = (message, action = null) => (
    <div className="flex min-h-[220px] flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-oai-gray-200 px-4 py-8 text-center text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
      <p>{message}</p>
      {action}
    </div>
  );

  let contentNode;
  if (loading) {
    contentNode = loadingNode;
  } else if (tab === "my") {
    const myIsFetchingPage = myLoading || !myDataMatches;
    contentNode = myTotal > 0 || myQueryText || myIsFetchingPage ? (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {myIsFetchingPage && !pagedMySkills.length ? (
          browseLoadingNode
        ) : pagedMySkills.length ? (
          <>
            <MySkillsView
              items={pagedMySkills}
              targets={targets}
              busyKey={busyKey}
              onToggleTarget={handleToggleTarget}
              onRemove={handleRemove}
            />
            <PaginationControls
              page={boundedMyPage}
              pageCount={myPageCount}
              total={myTotal}
              onPageChange={setMyPage}
            />
          </>
        ) : (
          emptyNode(copy("skills.empty.search"))
        )}
      </div>
    ) : (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-oai-gray-200 px-4 py-8 text-center dark:border-oai-gray-800">
        {targets.length > 0 ? (
          <div className="relative h-11 w-80 overflow-hidden" aria-hidden>
            {/* Blurred icons — masked to mid-edge transition zones (skips center) */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent 8%, black 20%, black 32%, transparent 44%, transparent 56%, black 68%, black 80%, transparent 92%)",
                WebkitMaskImage:
                  "linear-gradient(to right, transparent 8%, black 20%, black 32%, transparent 44%, transparent 56%, black 68%, black 80%, transparent 92%)",
              }}
            >
              <div
                className="absolute inset-y-0 left-0 flex w-max items-center animate-marquee-x"
                style={{ filter: "blur(2.5px)" }}
              >
                {[...targets, ...targets].map((target, i) => (
                  <span key={`b-${i}`} className="shrink-0 px-3">
                    <ProviderIcon provider={target.id} size={30} />
                  </span>
                ))}
              </div>
            </div>
            {/* Clear icons — masked to center */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                maskImage:
                  "linear-gradient(to right, transparent 28%, black 42%, black 58%, transparent 72%)",
                WebkitMaskImage:
                  "linear-gradient(to right, transparent 28%, black 42%, black 58%, transparent 72%)",
              }}
            >
              <div className="absolute inset-y-0 left-0 flex w-max items-center animate-marquee-x">
                {[...targets, ...targets].map((target, i) => (
                  <span key={`c-${i}`} className="shrink-0 px-3">
                    <ProviderIcon provider={target.id} size={30} />
                  </span>
                ))}
              </div>
            </div>
            {/* Background color fade — left edge */}
            <div
              className="pointer-events-none absolute inset-y-0 left-0 w-20 bg-gradient-to-r from-oai-white to-transparent dark:from-oai-gray-900"
            />
            {/* Background color fade — right edge */}
            <div
              className="pointer-events-none absolute inset-y-0 right-0 w-20 bg-gradient-to-l from-oai-white to-transparent dark:from-oai-gray-900"
            />
          </div>
        ) : null}
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {copy("skills.empty.my")}
        </p>
        <Button type="button" size="sm" onClick={() => setTab("browse")}>
          {copy("skills.empty.my_cta")}
        </Button>
      </div>
    );
  } else {
    // Browse
    const isSkillsSh = source === SOURCE_SKILLSSH;
    const noSources = repos.length === 0 && !isSkillsSh;

    let resultNode;
    if (noSources) {
      resultNode = (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-oai-gray-200 p-6 text-center dark:border-oai-gray-800">
          <p className="text-sm text-oai-gray-600 dark:text-oai-gray-300">
            {copy("skills.browse.empty_sources")}
          </p>
        </div>
      );
    } else if (isSkillsSh && activeSkillsShQuery.trim().length < 2) {
      resultNode = (
        <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-oai-gray-200 px-4 py-6 text-center text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
          {copy("skills.browse.hint_skillssh")}
        </div>
      );
    } else if (browseLoading && !browseDataMatches) {
      resultNode = browseLoadingNode;
    } else if (visibleBrowseItems.length) {
      resultNode = (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pagedBrowseItems.map((skill) => (
            <div key={skill.id || skill.key} style={BROWSE_CARD_STYLE}>
              <BrowseCard
                skill={skill}
                installed={Boolean(skill.installed)}
                installing={busyKey === installBusyKey(skill)}
                allTargets={targets}
                defaultTargets={DEFAULT_TARGETS}
                onInstall={handleInstall}
              />
            </div>
          ))}
        </div>
      );
    } else if (isSkillsSh) {
      resultNode = emptyNode(copy("skills.empty.search"));
    } else if (source !== SOURCE_ALL && activeBrowseData.emptyReason === "no_skill_files") {
      resultNode = emptyNode(copy("skills.empty.repo_no_skills", { repo: source }));
    } else if (browseQueryText) {
      resultNode = emptyNode(copy("skills.empty.search"));
    } else {
      resultNode = emptyNode(copy("skills.empty.browse"));
    }

    const manageNode = noSources || manageOpen ? (
      <div className="mb-3 shrink-0">
        <RepoManager
          repos={repos}
          repoInput={repoInput}
          onRepoInput={setRepoInput}
          busyKey={busyKey}
          onAdd={handleAddRepo}
          onRemove={handleRemoveRepo}
          onClose={noSources ? null : () => setManageOpen(false)}
        />
      </div>
    ) : null;

    contentNode = (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {manageNode}
        <div className="min-h-0 flex-1 overflow-auto pr-1">{resultNode}</div>
        {browseTotal > 0 ? (
          <PaginationControls
            page={boundedBrowsePage}
            pageCount={browsePageCount}
            total={browseTotal}
            onPageChange={setBrowsePage}
          />
        ) : null}
      </div>
    );
  }

  return (
    <PageFrame
      title={copy("skills.page.title")}
      compact
      maxWidth="max-w-[1760px]"
      actions={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleRefresh}
          disabled={loading || browseLoading}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", (loading || browseLoading) && "animate-spin")} aria-hidden />
          {copy("skills.action.refresh")}
        </Button>
      }
    >
      <div className="flex h-[calc(100dvh-96px)] min-h-0 flex-col gap-5 overflow-hidden">
          <div className="flex shrink-0 gap-6 border-b border-[var(--vd-border)]">
            {[
              ["my", copy("skills.tab.my")],
              ["browse", copy("skills.tab.browse")],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "-mb-px border-b-2 pb-2 text-sm font-medium transition-colors",
                  tab === value
                    ? "border-oai-brand text-oai-brand dark:border-oai-brand-300 dark:text-oai-brand-300"
                    : "border-transparent text-oai-gray-500 hover:text-oai-brand dark:text-oai-gray-400 dark:hover:text-oai-brand-300",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {error ? (
            <div className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {tab === "my" && !loading ? (
            <div className="shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400" aria-hidden />
                <Input
                  value={myQuery}
                  onChange={(event) => setMyQuery(event.target.value)}
                  placeholder={copy("skills.my.search_placeholder")}
                  className="pl-9 !border-[var(--vd-border-strong)] focus:!border-oai-brand focus:!ring-oai-brand/25"
                />
              </div>
            </div>
          ) : null}

          {tab === "browse" ? (
            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
              <div
                role="tablist"
                aria-label={copy("skills.source.label")}
                className="inline-flex h-10 shrink-0 items-center rounded-md border border-[var(--vd-border)] bg-[var(--vd-tint)] p-1"
              >
                {[
                  ["repo", copy("skills.mode.repo")],
                  ["skillssh", copy("skills.mode.skillssh")],
                ].map(([value, label]) => {
                  const active = (value === "skillssh") === (source === SOURCE_SKILLSSH);
                  return (
                    <button
                      key={value}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => {
                        if (value === "skillssh") setSource(SOURCE_SKILLSSH);
                        else if (source === SOURCE_SKILLSSH) setSource(SOURCE_ALL);
                      }}
                      className={cn(
                        "rounded px-3 py-1 text-sm font-medium transition-colors",
                        active
                          ? "vd-tab-active bg-oai-gray-100 text-oai-black dark:bg-oai-gray-700 dark:text-white"
                          : "vd-tab text-oai-gray-500 hover:text-oai-gray-800 dark:text-oai-gray-400 dark:hover:text-oai-gray-200",
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {source !== SOURCE_SKILLSSH ? (
                <Select.Root value={source} onValueChange={setSource}>
                  <Select.Trigger
                    aria-label={copy("skills.source.label")}
                    className="vd-control inline-flex h-10 w-44 shrink-0 items-center justify-between gap-2 rounded-md border border-oai-gray-200 bg-oai-white px-3 text-sm text-oai-black focus:outline-none data-[popup-open]:border-oai-gray-300 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-white dark:data-[popup-open]:border-oai-gray-700"
                  >
                    <Select.Value>
                      {(value) => (value === SOURCE_ALL ? copy("skills.source.all") : value)}
                    </Select.Value>
                    <Select.Icon className="text-oai-gray-400">
                      <ChevronDown className="h-4 w-4" aria-hidden />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[60]">
                      <Select.Popup className="vd-popover min-w-[var(--anchor-width)] overflow-hidden rounded-md border border-oai-gray-200 bg-white p-1 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.18)] outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0 dark:border-oai-gray-800 dark:bg-oai-gray-950 dark:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]">
                        <Select.Item
                          value={SOURCE_ALL}
                          className="flex cursor-default select-none items-center justify-between gap-2 rounded px-3 py-1.5 text-sm text-oai-black outline-none data-[highlighted]:bg-oai-brand-50 dark:text-white dark:data-[highlighted]:bg-oai-brand-950/50"
                        >
                          <Select.ItemText>{copy("skills.source.all")}</Select.ItemText>
                          <Select.ItemIndicator>
                            <Check className="h-3.5 w-3.5" aria-hidden />
                          </Select.ItemIndicator>
                        </Select.Item>
                        {repos.map((repo) => {
                          const value = `${repo.owner}/${repo.name}`;
                          return (
                            <Select.Item
                              key={value}
                              value={value}
                              className="flex cursor-default select-none items-center justify-between gap-2 rounded px-3 py-1.5 text-sm text-oai-black outline-none data-[highlighted]:bg-oai-brand-50 dark:text-white dark:data-[highlighted]:bg-oai-brand-950/50"
                            >
                              <Select.ItemText>{value}</Select.ItemText>
                              <Select.ItemIndicator>
                                <Check className="h-3.5 w-3.5" aria-hidden />
                              </Select.ItemIndicator>
                            </Select.Item>
                          );
                        })}
                      </Select.Popup>
                    </Select.Positioner>
                  </Select.Portal>
                </Select.Root>
              ) : null}
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400" aria-hidden />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && source === SOURCE_SKILLSSH) handleSearch();
                  }}
                  placeholder={
                    source === SOURCE_SKILLSSH
                      ? copy("skills.browse.placeholder_skillssh")
                      : source === SOURCE_ALL
                        ? copy("skills.browse.placeholder_all")
                        : copy("skills.browse.placeholder_repo", { repo: source })
                  }
                  className="pl-9 !border-[var(--vd-border-strong)] focus:!border-oai-brand focus:!ring-oai-brand/25"
                />
              </div>
              {source === SOURCE_SKILLSSH ? (
                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={query.trim().length < 2 || busyKey === "search"}
                  className="focus:!ring-oai-brand/30"
                >
                  {busyKey === "search" ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Search className="mr-1.5 h-4 w-4" aria-hidden />
                  )}
                  {copy("skills.action.search")}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setManageOpen((prev) => !prev)}
                  aria-expanded={manageOpen}
                  className="!h-10 shrink-0 whitespace-nowrap !border-[var(--vd-border-strong)] hover:!border-oai-brand hover:!text-oai-brand dark:hover:!text-oai-brand-300 focus:!ring-oai-brand/30"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {copy("skills.browse.manage_sources")}
                  <span className="vd-chip ml-1.5 rounded bg-oai-gray-100 px-1.5 py-0.5 text-xs font-medium text-oai-gray-600 dark:bg-oai-gray-800 dark:text-oai-gray-300">
                    {repos.length}
                  </span>
                </Button>
              )}
            </div>
          ) : null}

          <Card className="min-h-0 flex-1 overflow-hidden" bodyClassName="flex h-full min-h-0 flex-col">
            {contentNode}
          </Card>
      </div>

      <ConfirmModal
        open={Boolean(pendingRemove)}
        title={copy("skills.confirm.remove_title", {
          name: pendingRemove?.name || pendingRemove?.directory || "",
        })}
        description={
          pendingRemove
            ? pendingRemove.managed
              ? copy("skills.confirm.remove_managed")
              : copy("skills.confirm.remove_local")
            : ""
        }
        confirmLabel={copy("skills.action.remove")}
        cancelLabel={copy("shared.action.cancel")}
        destructive
        busy={busyKey === removeBusyKey(pendingRemove || {})}
        onCancel={() => setPendingRemove(null)}
        onConfirm={confirmRemove}
      />

      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-md items-center gap-3 rounded-full bg-oai-black px-4 py-2 text-sm text-white shadow-lg dark:bg-white dark:text-oai-black">
            <span>{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                onClick={toast.undo}
                className="rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide hover:bg-white/10 dark:hover:bg-oai-black/10"
              >
                {copy("shared.action.undo")}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </PageFrame>
  );
}
