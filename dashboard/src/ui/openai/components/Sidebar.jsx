import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  Activity,
  BarChart3,
  GitBranch,
  GitGraph,
  LayoutGrid,
  Puzzle,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
  Menu,
  X,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { copy } from "../../../lib/copy";
import { cn } from "../../../lib/cn";
import { useTheme } from "../../../hooks/useTheme.js";
import { useLocale } from "../../../hooks/useLocale.js";
import { shouldFetchGithubStars } from "../../matrix-a/util/should-fetch-github-stars.js";
import { GITHUB_REPO, GITHUB_REPO_API_URL, GITHUB_REPO_URL } from "../../../lib/public-links.js";
import { isNativeApp, isNativeEmbed } from "../../../lib/native-bridge.js";
import { SlidePanel } from "../../foundation/SlidePanel.jsx";

const STORAGE_KEY = "tt.sidebarCollapsed";
const LG_BREAKPOINT = 1024;
const XL_BREAKPOINT = 1280;

function getNavGroups() {
  return [
    {
      id: "work",
      label: copy("nav.group.general"),
      items: [
        { id: "live", to: "/dashboard", icon: Activity, label: copy("nav.live") },
        { id: "usage", to: "/usage", icon: BarChart3, label: copy("nav.usage") },
        { id: "branches", to: "/branches", icon: GitBranch, label: copy("nav.branches") },
      ],
    },
    {
      id: "control",
      label: copy("nav.group.tools"),
      items: [
        { id: "entire", to: "/entire", icon: GitGraph, label: copy("nav.entire") },
        { id: "skills", to: "/skills", icon: Puzzle, label: copy("nav.skills") },
      ],
    },
    {
      id: "system",
      label: copy("nav.group.account"),
      items: [
        { id: "widgets", to: "/widgets", icon: LayoutGrid, label: copy("nav.widgets") },
        { id: "settings", to: "/settings", icon: SettingsIcon, label: copy("nav.settings") },
      ],
    },
  ];
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
        "px-3 pb-1 text-[10px] uppercase tracking-wider text-oai-gray-500 dark:text-oai-gray-500 font-mono",
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
          ? "vd-sidebar-active font-medium"
          : "text-oai-gray-600 dark:text-oai-gray-400 hover:bg-oai-brand-50/70 hover:text-oai-brand dark:hover:bg-oai-brand-950/35 dark:hover:text-oai-brand-300",
      )}
    >
      {active && (
        <motion.div
          layoutId="nav-active-indicator"
          className="vd-sidebar-active-bg absolute inset-0 rounded-md bg-oai-gray-200/70 dark:bg-oai-gray-800"
          transition={shouldReduceMotion ? { duration: 0 } : {
            type: "spring",
            stiffness: 500,
            damping: 35,
          }}
          style={{ zIndex: -1 }}
        />
      )}
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
            className="truncate overflow-hidden whitespace-nowrap"
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
            className="vd-popover absolute bottom-full left-0 mb-2 z-50 min-w-[140px] py-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-glass"
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
      animate={{ width: collapsed ? 72 : 220 }}
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
      className="vd-drawer bg-[var(--glass-bg)] backdrop-blur-[24px] border-r border-[var(--glass-border)] shadow-2xl"
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
      <div className="w-10 shrink-0" aria-hidden />
    </div>
  );
}

export function AppLayout({ children }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openDrawer = useCallback(() => setDrawerOpen(true), []);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  const normalizedPath = (location?.pathname || "/").replace(/\/+$/, "") || "/";
  const fixedWorkbench = normalizedPath === "/entire";

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
              !nativeEmbed && "shadow-glass",
            )}
          >
            <MobileTopBar onOpenDrawer={openDrawer} />
            <div className={cn("flex-1 min-h-0", fixedWorkbench ? "overflow-hidden" : "overflow-y-auto")}>
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
