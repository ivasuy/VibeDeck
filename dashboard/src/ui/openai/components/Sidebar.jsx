import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Activity,
  Cpu,
  Download,
  GitBranch,
  GitCompare,
  Home,
  Lightbulb,
  LayoutGrid,
  Puzzle,
  ReceiptText,
  Settings as SettingsIcon,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
  Search,
  CornerDownLeft,
} from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { useTheme } from "../../../hooks/useTheme.js";
import { useLocale } from "../../../hooks/useLocale.js";
import { shouldFetchGithubStars } from "../../matrix-a/util/should-fetch-github-stars.js";
import { GITHUB_REPO, GITHUB_REPO_API_URL, GITHUB_REPO_URL } from "../../../lib/public-links.js";
import { isNativeApp, isNativeEmbed } from "../../../lib/native-bridge.js";
import { getSyncStatus } from "../../../lib/vibedeck-api";
import { SlidePanel } from "../../foundation/SlidePanel.jsx";
import { HeaderThemeMenu } from "../../../components/RevampSurfaces.jsx";

const STORAGE_KEY = "tt.sidebarCollapsed";
const COMMAND_RECENTS_KEY = "vd-command-palette-recent";
const LG_BREAKPOINT = 1024;
const XL_BREAKPOINT = 1280;

export function getNavGroups() {
  return [
    {
      id: "live",
      label: "Live",
      items: [
        { id: "live", to: "/live", icon: Activity, label: "Live" },
        { id: "branches", to: "/branches", icon: GitBranch, label: copy("nav.branches") },
      ],
    },
    {
      id: "intelligence",
      label: "Intelligence",
      items: [
        { id: "optimize", to: "/optimize", icon: Lightbulb, label: copy("nav.optimize") },
        { id: "plan", to: "/plan", icon: ReceiptText, label: copy("nav.plan") },
        { id: "compare", to: "/compare", icon: GitCompare, label: copy("nav.compare") },
        { id: "models", to: "/models", icon: Cpu, label: copy("nav.models") },
      ],
    },
    {
      id: "analytics",
      label: "Analytics",
      items: [
        { id: "yield", to: "/yield", icon: TrendingUp, label: copy("nav.yield") },
        { id: "skills", to: "/skills", icon: Puzzle, label: copy("nav.skills") },
      ],
    },
    {
      id: "setup",
      label: "Setup",
      items: [
        { id: "widgets", to: "/widgets", icon: LayoutGrid, label: copy("nav.widgets") },
        { id: "export", to: "/export", icon: Download, label: copy("nav.export") },
        { id: "settings", to: "/settings", icon: SettingsIcon, label: copy("nav.settings") },
      ],
    },
  ];
}

export function getCommandPaletteCatalog() {
  const homeItem = {
    id: "nav:dashboard",
    group: "Commands",
    label: "Dashboard",
    detail: "Home",
    to: "/dashboard",
    icon: Home,
    keywords: ["dashboard", "home", "summary"],
  };
  const navItems = getNavGroups().flatMap((group) =>
    group.items.map((item) => ({
      id: `nav:${item.id}`,
      group: "Commands",
      label: item.label,
      detail: group.label,
      to: item.to,
      icon: item.icon,
      keywords: [item.id, item.label, group.label],
    })),
  );

  return [
    homeItem,
    ...navItems,
    {
      id: "provider:limits",
      group: "Providers",
      label: "Provider limits",
      detail: "Open live quota windows",
      to: "/live",
      icon: Activity,
      keywords: ["provider", "limits", "quota", "reset"],
    },
    {
      id: "provider:settings",
      group: "Providers",
      label: "Provider settings",
      detail: "Configure auto-detect and display",
      to: "/settings",
      icon: SettingsIcon,
      keywords: ["provider", "settings", "detect", "limits"],
    },
    {
      id: "session:active",
      group: "Sessions",
      label: "Active sessions",
      detail: "Open the live session list",
      to: "/live",
      icon: Activity,
      keywords: ["sessions", "live", "active", "running"],
    },
  ];
}

function readCommandRecents() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COMMAND_RECENTS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

function writeCommandRecent(id) {
  if (typeof window === "undefined" || !id) return;
  try {
    const next = [id, ...readCommandRecents().filter((existing) => existing !== id)].slice(0, 5);
    window.localStorage.setItem(COMMAND_RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function readCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored !== null) return stored === "1";
    if (window.innerWidth >= LG_BREAKPOINT && window.innerWidth < XL_BREAKPOINT) return true;
    return false;
  } catch {
    return false;
  }
}

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readCollapsed);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
        }
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e) => {
      if (e.key === STORAGE_KEY) setCollapsed(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return { collapsed, toggle };
}

function isActive(pathname, to) {
  if (!pathname) return false;
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (to === "/dashboard") {
    return normalized === "/dashboard" || normalized === "/";
  }
  return normalized === to;
}

function SidebarBrand({ collapsed = false }) {
  const shouldReduceMotion = useReducedMotion();
  const icon = (
    <>
      <img src="/icon-light.svg" alt="" className="h-7 w-7 shrink-0 rounded-lg dark:hidden" />
      <img src="/icon.svg" alt="" className="hidden h-7 w-7 shrink-0 rounded-lg dark:block" />
    </>
  );

  return (
    <Link
      to="/dashboard"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg px-1.5 py-1 no-underline text-oai-black dark:text-oai-white transition-opacity hover:opacity-85",
        collapsed && "justify-center px-0",
      )}
      aria-label={copy("brand.name")}
    >
      {collapsed ? icon : null}
      <AnimatePresence mode="wait">
        {!collapsed && (
          <motion.span
            key="brand-text"
            initial={shouldReduceMotion ? {} : { opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={shouldReduceMotion ? {} : { opacity: 0, width: 0 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="flex min-w-0 overflow-hidden"
          >
            <img src="/wordmark.svg" alt="" className="h-7 w-auto max-w-[132px] dark:hidden" />
            <img src="/wordmark-dark.svg" alt="" className="hidden h-7 w-auto max-w-[132px] dark:block" />
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function NavGroupLabel({ label, collapsed, first }) {
  if (collapsed) {
    if (first) return null;
    return <div className="mx-2 my-2 h-px bg-oai-gray-200/70 dark:bg-oai-gray-800/70" aria-hidden />;
  }
  return (
    <div
      className={cn(
        "px-3 pb-1 text-[11px] uppercase tracking-[0.08em] text-oai-gray-500 dark:text-oai-gray-500 font-medium",
        first ? "pt-2" : "pt-4",
      )}
    >
      {label}
    </div>
  );
}

function NavItem({ item, collapsed, active, onClick }) {
  const Icon = item.icon;
  const shouldReduceMotion = useReducedMotion();
  return (
    <Link
      to={item.to}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] no-underline transition-colors duration-150",
        collapsed && "justify-center px-0 py-2",
        active
          ? "vd-sidebar-active font-semibold text-oai-black dark:text-white"
          : "text-oai-gray-600 dark:text-oai-gray-400 hover:bg-[var(--vd-tint)] hover:text-oai-black dark:hover:text-white",
      )}
    >
      {active && (
        <motion.div
          layoutId="nav-active-indicator"
          className="vd-sidebar-active-bg absolute inset-0 rounded-md bg-[var(--vd-tint)]"
          transition={shouldReduceMotion ? { duration: 0 } : {
            type: "spring",
            stiffness: 500,
            damping: 35,
          }}
          style={{ zIndex: -1 }}
        />
      )}
      {active && !collapsed ? (
        <span className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-full bg-[var(--brand-500)]" aria-hidden />
      ) : null}
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <Icon className="h-[15px] w-[15px]" aria-hidden />
      </span>
      <AnimatePresence mode="wait">
        {!collapsed && (
          <motion.span
            key="nav-label"
            initial={shouldReduceMotion ? {} : { opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: "auto" }}
            exit={shouldReduceMotion ? {} : { opacity: 0, width: 0 }}
            transition={{ duration: 0.15 }}
            className="whitespace-nowrap"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
    </Link>
  );
}

function IconButton({ as = "button", title, onClick, href, children, className: extraClassName, ...rest }) {
  const className = cn(
    "flex h-10 w-10 items-center justify-center rounded-lg text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
    extraClassName,
  );
  if (as === "a") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" title={title} aria-label={title} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className={className} {...rest}>
      {children}
    </button>
  );
}

function StarPill({ repo = GITHUB_REPO, glassChrome = false }) {
  const [stars, setStars] = useState(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!shouldFetchGithubStars({ prefersReducedMotion, screenshotCapture: false })) return;
    fetch(repo === GITHUB_REPO ? GITHUB_REPO_API_URL : `https://api.github.com/repos/${repo}`)
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.stargazers_count === "number") setStars(data.stargazers_count);
      })
      .catch(() => {});
  }, [repo]);

  return (
    <a
      href={repo === GITHUB_REPO ? GITHUB_REPO_URL : `https://github.com/${repo}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={stars !== null ? `${copy("nav.star")} (${stars})` : copy("nav.star")}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
        glassChrome
          ? "border border-gray-500/20 dark:border-gray-500/30 bg-gray-500/[0.04] dark:bg-gray-500/[0.06] backdrop-blur-[2px] text-oai-gray-700 dark:text-oai-gray-300 hover:bg-gray-500/10 dark:hover:bg-gray-500/12 hover:border-gray-500/30 dark:hover:border-gray-500/40 hover:text-oai-black dark:hover:text-white"
          : "border border-oai-gray-200 dark:border-oai-gray-700 text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-black dark:hover:text-white hover:border-oai-gray-300 dark:hover:border-oai-gray-600",
      )}
    >
      <svg height="12" viewBox="0 0 16 16" width="12" className="shrink-0 fill-current">
        <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
      </svg>
      <span>{copy("nav.star")}</span>
      {stars !== null && (
        <span className="text-[10px] text-oai-gray-500 dark:text-oai-gray-500 tabular-nums font-mono">
          {stars}
        </span>
      )}
    </a>
  );
}

const THEME_OPTIONS = [
  { value: "light", labelKey: "settings.appearance.theme.light", Icon: Sun },
  { value: "dark", labelKey: "settings.appearance.theme.dark", Icon: Moon },
  { value: "system", labelKey: "settings.appearance.theme.system", Icon: Monitor },
];

function ThemePill({ theme, resolvedTheme, onSetTheme, glassChrome = false }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        aria-label={copy("nav.theme")}
        aria-expanded={open}
        aria-haspopup="menu"
        title={copy("nav.theme")}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "vd-control inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500",
          glassChrome
            ? "border border-[var(--vd-border)] bg-[var(--vd-tint)] backdrop-blur-[2px] text-oai-brand-600 dark:text-oai-brand-300 hover:bg-oai-brand-50 dark:hover:bg-oai-brand-950/40 hover:border-oai-brand-300 dark:hover:border-oai-brand-500"
            : "border border-[var(--vd-border)] text-oai-brand-600 dark:text-oai-brand-300 hover:bg-oai-brand-50 dark:hover:bg-oai-brand-950/40 hover:text-oai-brand-700 dark:hover:text-oai-brand-200 hover:border-oai-brand-300 dark:hover:border-oai-brand-500",
        )}
      >
        <ActiveIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={shouldReduceMotion ? {} : { opacity: 0, scale: 0.95, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? {} : { opacity: 0, scale: 0.95, y: 4 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="vd-popover absolute bottom-full left-0 mb-2 z-50 min-w-[140px] py-1 rounded-lg border border-[var(--vd-border)] bg-[var(--vd-popover-bg)] shadow-[var(--vd-shadow)]"
          >
            {THEME_OPTIONS.map(({ value, labelKey, Icon }) => {
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="menuitem"
                  onClick={() => { onSetTheme(value); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "text-oai-brand-700 dark:text-oai-brand-300 bg-oai-brand-100 dark:bg-oai-brand-950/60"
                      : "text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-brand-50 dark:hover:bg-oai-brand-950/35 hover:text-oai-brand-700 dark:hover:text-oai-brand-300",
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{copy(labelKey)}</span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function latestSyncTimestamp(status) {
  const candidates = [
    status?.canonical_db_updated_at,
    status?.last_parse_at,
    status?.queue_updated_at,
    status?.project_queue_updated_at,
  ];
  let latest = 0;
  for (const value of candidates) {
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed) && parsed > latest) latest = parsed;
  }
  return latest || null;
}

function relativeSyncAge(timestamp) {
  if (!timestamp) return "";
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function useSidebarServerHealth() {
  const [state, setState] = useState({ status: "checking", payload: null });

  useEffect(() => {
    let active = true;
    let timer = null;

    const refresh = async () => {
      try {
        const payload = await getSyncStatus();
        if (!active) return;
        const latest = latestSyncTimestamp(payload);
        const stale = latest ? Date.now() - latest > 30 * 60 * 1000 : false;
        setState({
          status: stale ? "stale" : "healthy",
          payload,
          latest,
        });
      } catch {
        if (!active) return;
        setState({ status: "offline", payload: null, latest: null });
      }
    };

    refresh();
    timer = window.setInterval(refresh, 30000);
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return state;
}

function SidebarUtilityCard({ collapsed }) {
  const health = useSidebarServerHealth();
  const statusCopy = {
    checking: {
      eyebrow: "Server",
      title: "Checking",
      detail: "Reading local sync status",
      filled: 2,
    },
    healthy: {
      eyebrow: "Server",
      title: "Healthy",
      detail: health.latest ? `Updated ${relativeSyncAge(health.latest)}` : "Local bridge responding",
      filled: 6,
    },
    stale: {
      eyebrow: "Server",
      title: "Stale",
      detail: health.latest ? `Last sync ${relativeSyncAge(health.latest)}` : "Refresh recommended",
      filled: 4,
    },
    offline: {
      eyebrow: "Server",
      title: "Offline",
      detail: "Open VibeDeck to reconnect",
      filled: 1,
    },
  };
  const current = statusCopy[health.status] || statusCopy.checking;
  const sessionCount = Number(health.payload?.session_count);
  const indexedCopy = Number.isFinite(sessionCount)
    ? `${sessionCount.toLocaleString()} sessions indexed`
    : current.detail;

  if (collapsed) {
    return (
      <Link
        to="/widgets"
        aria-label="Open macOS app and widget setup"
        title="Open macOS app and widget setup"
        className="mx-2 mb-2 flex h-10 items-center justify-center rounded-lg bg-[var(--brand-950)] text-white no-underline transition-colors hover:bg-[var(--brand-900)]"
      >
        <Download className="h-4 w-4" aria-hidden />
      </Link>
    );
  }

  return (
    <div className="mx-3 mb-3 rounded-xl border border-white/10 bg-[var(--brand-950)] p-3 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/60">
            {current.eyebrow}
          </p>
          <p className="mt-1 text-sm font-semibold leading-5">
            {current.title}
          </p>
          <p className="mt-0.5 truncate text-[11px] leading-4 text-white/60" title={indexedCopy}>
            {indexedCopy}
          </p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/10">
          <Monitor className="h-4 w-4" aria-hidden />
        </span>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {Array.from({ length: 6 }).map((_, index) => (
          <span
            key={index}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              index < current.filled ? "bg-white/85" : "bg-white/20",
            )}
          />
        ))}
      </div>
      <Link
        to="/widgets"
        className="mt-3 inline-flex h-8 w-full items-center justify-center rounded-full bg-white px-3 text-xs font-semibold text-[var(--brand-950)] no-underline transition-colors hover:bg-[var(--brand-50)]"
      >
        macOS setup
      </Link>
    </div>
  );
}

function SidebarBody({ collapsed, onToggleCollapsed, onItemClick, showCloseButton = false, onClose, glassChrome = false }) {
  const location = useLocation();
  const pathname = location?.pathname || "/";
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { resolvedLocale } = useLocale();
  const navGroups = useMemo(() => getNavGroups(), [resolvedLocale]);

  return (
    <>
      <div className={cn("px-2 pt-2 pb-2", collapsed && "flex justify-center")}>
        {showCloseButton ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
              <SidebarBrand />
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy("nav.close_menu")}
              title={copy("nav.close_menu")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-oai-gray-500 dark:text-oai-gray-500 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-gray-900 dark:hover:text-oai-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
            >
              <X className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            </button>
          </div>
        ) : (
          <SidebarBrand collapsed={collapsed} />
        )}
      </div>

      <nav
        aria-label={copy("nav.nav_label")}
        className="flex-1 px-2 pb-2 flex flex-col overflow-y-auto"
      >
        {navGroups.map((group, groupIdx) => (
          <div key={group.id} className="flex flex-col">
            <NavGroupLabel label={group.label} collapsed={collapsed} first={groupIdx === 0} />
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavItem
                  key={item.id}
                  item={item}
                  collapsed={collapsed}
                  active={isActive(pathname, item.to)}
                  onClick={onItemClick}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <SidebarUtilityCard collapsed={collapsed} />

      <div
        className={cn(
          "flex items-center px-2 py-3",
          collapsed ? "flex-col justify-center gap-2" : "justify-between gap-2",
        )}
      >
        <ThemePill theme={theme} resolvedTheme={resolvedTheme} onSetTheme={setTheme} glassChrome={glassChrome} />
        <div className="flex items-center gap-1.5">
          {!collapsed && <StarPill glassChrome={glassChrome} />}
          {!showCloseButton && (
            <button
              type="button"
              onClick={onToggleCollapsed}
              aria-label={collapsed ? copy("nav.expand") : copy("nav.collapse")}
              title={collapsed ? copy("nav.expand") : copy("nav.collapse")}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-oai-gray-500 dark:text-oai-gray-500 hover:bg-oai-gray-200/60 dark:hover:bg-oai-gray-800 hover:text-oai-gray-900 dark:hover:text-oai-gray-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              ) : (
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function Sidebar({ collapsed, onToggleCollapsed }) {
  const nativeGlass = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isNativeEmbed() || isNativeApp();
  }, []);
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.aside
      aria-label={copy("nav.aside_label")}
      animate={{ width: collapsed ? 72 : 240 }}
      transition={shouldReduceMotion ? { duration: 0 } : {
        type: "spring",
        stiffness: 400,
        damping: 34,
      }}
      className="hidden lg:flex flex-col shrink-0 h-full min-h-0"
    >
      <SidebarBody collapsed={collapsed} onToggleCollapsed={onToggleCollapsed} glassChrome={nativeGlass} />
    </motion.aside>
  );
}

function MobileDrawer({ open, onClose }) {
  return (
    <SlidePanel
      open={open}
      onClose={onClose}
      side="left"
      width="w-[260px] max-w-[80vw]"
      className="vd-drawer border-r border-[var(--vd-border)]"
    >
      <SidebarBody
        collapsed={false}
        showCloseButton
        onClose={onClose}
        onItemClick={onClose}
      />
    </SlidePanel>
  );
}

function MobileTopBar({ onOpenDrawer }) {
  return (
    <div className="lg:hidden flex items-center justify-between gap-2 px-3 h-14 border-b border-[var(--glass-border)]">
      <IconButton title={copy("nav.menu")} onClick={onOpenDrawer}>
        <Menu className="h-5 w-5" aria-hidden />
      </IconButton>
      <Link
        to="/dashboard"
        className="flex items-center gap-2 no-underline hover:opacity-80 transition-opacity"
        aria-label={copy("brand.name")}
      >
        <img src="/icon-light.svg" alt="" className="h-6 w-6 shrink-0 rounded-lg dark:hidden" />
        <img src="/icon.svg" alt="" className="hidden h-6 w-6 shrink-0 rounded-lg dark:block" />
        <img src="/wordmark.svg" alt="" className="h-5 w-auto max-w-[108px] dark:hidden" />
        <img src="/wordmark-dark.svg" alt="" className="hidden h-5 w-auto max-w-[108px] dark:block" />
      </Link>
      <div className="flex w-10 shrink-0 justify-end">
        <HeaderThemeMenu />
      </div>
    </div>
  );
}

function CommandPalette() {
  const navigate = useNavigate();
  const shouldReduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recentIds, setRecentIds] = useState(readCommandRecents);
  const inputRef = useRef(null);
  const lastFocusedRef = useRef(null);
  const catalog = useMemo(() => getCommandPaletteCatalog(), []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? catalog.filter((item) =>
          [item.label, item.detail, ...(item.keywords || [])]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : catalog;

    if (q) return base.slice(0, 10);

    const recentItems = recentIds
      .map((id) => catalog.find((item) => item.id === id))
      .filter(Boolean);
    const rest = catalog.filter((item) => !recentIds.includes(item.id));
    return [...recentItems, ...rest].slice(0, 12);
  }, [catalog, query, recentIds]);

  const grouped = useMemo(() => {
    const groups = [];
    const seen = new Map();
    for (const item of filtered) {
      const group = recentIds.includes(item.id) && !query.trim() ? "Recent" : item.group;
      if (!seen.has(group)) {
        seen.set(group, { label: group, items: [] });
        groups.push(seen.get(group));
      }
      seen.get(group).items.push(item);
    }
    return groups;
  }, [filtered, query, recentIds]);

  const flatItems = useMemo(() => grouped.flatMap((group) => group.items), [grouped]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
    requestAnimationFrame(() => {
      if (lastFocusedRef.current && typeof lastFocusedRef.current.focus === "function") {
        lastFocusedRef.current.focus();
      }
    });
  }, []);

  const openPalette = useCallback(() => {
    lastFocusedRef.current = document.activeElement;
    setOpen(true);
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const runItem = useCallback((item) => {
    if (!item) return;
    writeCommandRecent(item.id);
    setRecentIds(readCommandRecents());
    navigate(item.to);
    close();
  }, [close, navigate]);

  useEffect(() => {
    const onKeyDown = (event) => {
      const isCommandK = event.key?.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      if (isCommandK) {
        event.preventDefault();
        if (open) close();
        else openPalette();
        return;
      }
      if (!open) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, Math.max(flatItems.length - 1, 0)));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        runItem(flatItems[activeIndex]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex, close, flatItems, open, openPalette, runItem]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const active = document.getElementById(`command-palette-item-${activeIndex}`);
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh] backdrop-blur-[3px]"
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: shouldReduceMotion ? 0.08 : 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          role="presentation"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="vd-popover flex max-h-[480px] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-[var(--vd-border)] bg-[var(--vd-popover-bg)] shadow-[var(--vd-shadow)]"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
            transition={shouldReduceMotion ? { duration: 0.08 } : {
              type: "spring",
              stiffness: 320,
              damping: 28,
              mass: 0.6,
            }}
          >
            <div className="flex h-14 items-center gap-3 border-b border-[var(--vd-border)] px-4">
              <Search className="h-4 w-4 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-full flex-1 bg-transparent text-[18px] font-medium text-oai-black outline-none placeholder:text-oai-gray-400 dark:text-white dark:placeholder:text-oai-gray-600"
                placeholder="Search sessions, commands, providers..."
                aria-activedescendant={flatItems[activeIndex] ? `command-palette-item-${activeIndex}` : undefined}
                aria-controls="command-palette-results"
              />
              <kbd className="hidden rounded border border-[var(--vd-border)] bg-[var(--vd-tint)] px-1.5 py-0.5 font-mono text-[11px] text-oai-gray-500 dark:text-oai-gray-400 sm:inline">
                esc
              </kbd>
            </div>
            <div id="command-palette-results" className="min-h-0 flex-1 overflow-y-auto p-2">
              {grouped.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  No matching commands.
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.label} className="py-1">
                    <div className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-oai-gray-500 dark:text-oai-gray-500">
                      {group.label}
                    </div>
                    <div className="space-y-1">
                      {group.items.map((item) => {
                        const index = flatItems.indexOf(item);
                        const Icon = item.icon;
                        const active = index === activeIndex;
                        return (
                          <button
                            key={item.id}
                            id={`command-palette-item-${index}`}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => runItem(item)}
                            className={cn(
                              "flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left transition-colors",
                              active
                                ? "bg-[var(--vd-tint)] text-oai-black dark:text-white"
                                : "text-oai-gray-700 hover:bg-[var(--vd-tint)] dark:text-oai-gray-200",
                            )}
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)]">
                              <Icon className="h-3.5 w-3.5" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">{item.label}</span>
                              <span className="block truncate text-caption text-oai-gray-500 dark:text-oai-gray-400">
                                {item.detail}
                              </span>
                            </span>
                            {active ? <CornerDownLeft className="h-3.5 w-3.5 text-oai-gray-400" aria-hidden /> : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AppLayout({ children }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  const nativeEmbed = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isNativeEmbed() || isNativeApp();
  }, []);

  return (
    <div
      className={cn(
        "fixed inset-0 flex flex-col text-oai-black dark:text-oai-white font-oai overflow-hidden",
        nativeEmbed ? "bg-transparent" : "bg-oai-gray-100 dark:bg-oai-gray-950",
      )}
    >
      {nativeEmbed && (
        <div
          className="h-7 shrink-0"
          style={{ WebkitAppRegion: "drag" }}
          aria-hidden
        />
      )}
      <div className="flex-1 min-h-0 flex">
        <Sidebar collapsed={collapsed} onToggleCollapsed={toggle} />
        <MobileDrawer open={drawerOpen} onClose={closeDrawer} />
        <div className="flex-1 min-w-0 min-h-0 p-2 lg:pl-0 lg:pr-3 lg:pb-3 flex flex-col">
          <div
            className={cn(
              "vd-card flex-1 min-h-0 flex flex-col bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] border border-[var(--glass-border)] overflow-hidden",
              nativeEmbed ? "tt-native-main-card" : "rounded-2xl",
            )}
          >
            <MobileTopBar onOpenDrawer={openDrawer} />
            <div className="flex-1 min-h-0 overflow-y-auto">
              {children}
            </div>
          </div>
        </div>
      </div>
      <CommandPalette />
    </div>
  );
}
