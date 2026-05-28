import React from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Monitor, Moon, Sun, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "../lib/cn";
import { pageBodyTransition, reducedPageBodyTransition } from "../lib/motion";
import { ThemeContext } from "../ui/foundation/ThemeProvider.jsx";

const HEADER_THEME_OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function Surface({ children, className = "", accent = false, style }) {
  return (
    <section
      className={cn(
        "rounded-xl border p-5 shadow-none",
        accent
          ? "border-transparent text-white"
          : "border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm",
        className,
      )}
      style={style}
    >
      {children}
    </section>
  );
}

export function PageShell({ title, subtitle, actions, children, maxWidth = "max-w-[1280px]" }) {
  const shouldReduceMotion = useReducedMotion();
  const bodyMotion = shouldReduceMotion ? reducedPageBodyTransition : pageBodyTransition;

  return (
    <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
      <div className={cn("mx-auto px-4 sm:px-6 lg:px-8", maxWidth)}>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-h1 font-semibold text-oai-black dark:text-white">{title}</h1>
            {subtitle ? (
              <p className="mt-1 max-w-3xl text-sm leading-6 text-oai-gray-500 dark:text-oai-gray-400">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions ? actions : null}
            <HeaderThemeMenu />
          </div>
        </header>
        <motion.div
          initial={bodyMotion.initial}
          animate={bodyMotion.animate}
        >
          {children}
        </motion.div>
      </div>
    </main>
  );
}

export function HeaderThemeMenu() {
  const themeContext = React.useContext(ThemeContext);
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const triggerRef = React.useRef(null);
  const optionRefs = React.useRef([]);
  const shouldReduceMotion = useReducedMotion();
  const { theme = "system", setTheme = () => {}, resolvedTheme = "light" } = themeContext || {};
  const ActiveIcon = resolvedTheme === "dark" ? Moon : Sun;

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const activeIndex = Math.max(0, HEADER_THEME_OPTIONS.findIndex((option) => option.value === theme));
    const id = requestAnimationFrame(() => optionRefs.current[activeIndex]?.focus());
    return () => cancelAnimationFrame(id);
  }, [open, theme]);

  if (!themeContext) return null;

  function focusOption(index) {
    const count = HEADER_THEME_OPTIONS.length;
    const nextIndex = ((index % count) + count) % count;
    optionRefs.current[nextIndex]?.focus();
  }

  function onMenuKeyDown(event) {
    const currentIndex = optionRefs.current.findIndex((node) => node === document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      focusOption((currentIndex >= 0 ? currentIndex : 0) + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusOption((currentIndex >= 0 ? currentIndex : 0) - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(HEADER_THEME_OPTIONS.length - 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="menu"
        title="User menu"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-2.5 text-sm font-medium text-oai-gray-600 transition-colors hover:bg-[var(--vd-tint)] hover:text-oai-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-gray-300 dark:hover:text-white"
      >
        <UserRound className="h-4 w-4" aria-hidden />
        <ActiveIcon className="h-3.5 w-3.5 text-[var(--brand-600)] dark:text-[var(--brand-300)]" aria-hidden />
      </button>
      {open ? (
        <motion.div
          role="menu"
          onKeyDown={onMenuKeyDown}
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0.05 } : { type: "spring", mass: 0.7, stiffness: 340, damping: 30 }}
          className="vd-popover absolute right-0 top-full z-50 mt-2 w-[248px] rounded-xl border border-[var(--vd-border)] bg-[var(--vd-popover-bg)] p-3 shadow-[var(--vd-shadow)]"
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-label uppercase text-oai-gray-500 dark:text-oai-gray-400">Appearance</span>
            <span className="text-caption text-oai-gray-500 dark:text-oai-gray-400">{resolvedTheme}</span>
          </div>
          <div className="grid grid-cols-3 rounded-lg border border-[var(--vd-border)] bg-[var(--vd-control-bg)] p-1" aria-label="Theme">
            {HEADER_THEME_OPTIONS.map(({ value, label, Icon }) => {
              const active = theme === value;
              const optionIndex = HEADER_THEME_OPTIONS.findIndex((option) => option.value === value);
              return (
                <button
                  key={value}
                  ref={(node) => {
                    optionRefs.current[optionIndex] = node;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    setTheme(value);
                    setOpen(false);
                  }}
                  className={cn(
                    "inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[var(--brand-600)] text-white dark:bg-[var(--brand-500)]"
                      : "text-oai-gray-600 hover:bg-[var(--vd-tint)] hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-white",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}

export function SectionHeader({ title, action, className = "" }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="text-label uppercase text-oai-gray-500 dark:text-oai-gray-400">{title}</h2>
      {action}
    </div>
  );
}

function parseTimestamp(value) {
  if (!value) return null;
  const ts = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function formatAge(ms) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const seconds = Math.floor(safeMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function resolveFreshnessState({ timestamp, live = false, stale = false, error = false, now = Date.now() } = {}) {
  if (error || stale) return { tone: "stale", label: "STALE", ariaLabel: "Data is stale" };
  const ts = parseTimestamp(timestamp);
  if (!ts) {
    return live
      ? { tone: "live", label: "LIVE", ariaLabel: "Data is live" }
      : { tone: "muted", label: "Waiting", ariaLabel: "Data freshness is waiting for a timestamp" };
  }
  const ageMs = now - ts;
  if (live && ageMs < 30000) return { tone: "live", label: "LIVE", ariaLabel: "Data is live" };
  if (ageMs > 30 * 60 * 1000) return { tone: "stale", label: "STALE", ariaLabel: `Data is stale; last updated ${formatAge(ageMs)}` };
  const label = formatAge(ageMs);
  return { tone: "muted", label, ariaLabel: `Data last updated ${label}` };
}

export function FreshnessBadge({ timestamp, live = false, stale = false, error = false, className = "" }) {
  const state = resolveFreshnessState({ timestamp, live, stale, error });
  const dotClass = state.tone === "live"
    ? "bg-[var(--brand-500)] motion-safe:animate-pulse"
    : state.tone === "stale"
      ? "bg-[var(--oai-warning)]"
      : "bg-oai-gray-400 dark:bg-oai-gray-500";
  const textClass = state.tone === "live"
    ? "text-[var(--brand-700)] dark:text-[var(--brand-300)]"
    : state.tone === "stale"
      ? "text-amber-700 dark:text-amber-300"
      : "text-oai-gray-500 dark:text-oai-gray-400";

  return (
    <span
      className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md text-caption font-semibold uppercase", textClass, className)}
      aria-label={state.ariaLabel}
      title={state.ariaLabel}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} aria-hidden />
      {state.label}
    </span>
  );
}

export function KpiCard({ label, value, detail, accent = false, children }) {
  return (
    <Surface
      accent={accent}
      style={accent ? { background: "var(--brand-600)" } : undefined}
      className={accent ? "" : ""}
    >
      <p className={cn("text-label uppercase", accent ? "text-white/70" : "text-oai-gray-500 dark:text-oai-gray-400")}>
        {label}
      </p>
      <p className={cn("mt-3 text-h2 font-semibold tabular-nums", accent ? "text-white" : "text-oai-black dark:text-white")}>
        {value}
      </p>
      {detail ? (
        <p className={cn("mt-1 text-sm", accent ? "text-white/75" : "text-oai-gray-500 dark:text-oai-gray-400")}>
          {detail}
        </p>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </Surface>
  );
}

export function SkeletonBlock({ className = "" }) {
  return (
    <div
      aria-hidden="true"
      className={cn("shimmer rounded-md", className)}
    />
  );
}

export function SkeletonKpiGrid({ count = 3 }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Loading metrics">
      {Array.from({ length: count }).map((_, index) => (
        <Surface key={index}>
          <SkeletonBlock className="h-3 w-24 rounded" />
          <SkeletonBlock className="mt-4 h-9 w-32" />
          <SkeletonBlock className="mt-3 h-3 w-40 rounded" />
        </Surface>
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 4, className = "" }) {
  return (
    <div className={cn("divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70", className)} aria-label="Loading rows">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_120px_160px] sm:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <SkeletonBlock className="h-4 w-4 rounded-sm" />
            <div className="min-w-0 flex-1">
              <SkeletonBlock className="h-3 w-2/3 rounded" />
              <SkeletonBlock className="mt-2 h-2.5 w-1/3 rounded" />
            </div>
          </div>
          <SkeletonBlock className="h-2 rounded-full" />
          <SkeletonBlock className="h-3 w-24 justify-self-start rounded sm:justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }) {
  return (
    <Surface className="text-center">
      <h2 className="text-h3 font-semibold text-oai-black dark:text-white">{title}</h2>
      {body ? <p className="mx-auto mt-2 max-w-xl text-sm text-oai-gray-500 dark:text-oai-gray-400">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </Surface>
  );
}

export function SimpleBar({ value, max = 100, className = "", semantic = false }) {
  const numeric = Number(value);
  const percent = Number.isFinite(numeric) && max > 0 ? Math.max(0, Math.min(100, (numeric / max) * 100)) : 0;
  let fill = "var(--brand-500)";
  if (semantic) {
    fill = percent >= 90 ? "var(--oai-error)" : percent >= 70 ? "var(--oai-warning)" : "var(--oai-success)";
  }
  return (
    <div className={cn("h-2 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800", className)}>
      <div className="h-full rounded-full" style={{ width: `${percent}%`, background: fill }} />
    </div>
  );
}

export function TextLink({ to, children }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 text-sm font-medium text-[var(--brand-700)] no-underline dark:text-[var(--brand-300)]">
      {children}
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
    </Link>
  );
}
