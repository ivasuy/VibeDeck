import React, { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronDown, Download, Monitor } from "lucide-react";
import { copy } from "../lib/copy";
import { cn } from "../lib/cn";
import { isNativeEmbed, nativeAction } from "../lib/native-bridge.js";
import { GITHUB_RELEASES_URL } from "../lib/public-links.js";
import { useNativeSettings } from "../hooks/use-native-settings.js";
import {
  FALLBACK_MENU_BAR_ITEMS,
  normalizeMenuBarItems,
} from "../lib/menu-bar-display.js";
import { ToggleSwitch } from "../components/settings/Controls.jsx";
import { FadeIn, StaggerContainer, StaggerItem } from "../ui/foundation/FadeIn.jsx";

/* ---------- SVG widget illustrations ----------
 * Hand-drawn previews of the real macOS widgets. Pure SVG so they stay
 * crisp at any scale and don't require shipping PNGs.
 *
 * Hardcoded strings ("TODAY", "203.2M", "claude-opus-4-6", etc.)
 * intentionally bypass copy.csv — they mirror the literal Swift string
 * constants in Widget/Widgets/*.swift which ship English-only
 * in the native app. Keeping them inline makes the preview read as a
 * faithful screenshot.
 */

const WIDGET_W = 264;
const WIDGET_H = 124;
const ROUNDED_FONT = "ui-rounded, -apple-system, system-ui";

// Source accent palette — mirrors WidgetTheme.sourceColor in
// VibeDeckMac/VibeDeckWidget/Views/WidgetTheme.swift.
const SOURCE_COLORS = {
  claude: "#6E72C9",
  codex: "#4E529C",
  cursor: "#656BB5",
  gemini: "#818CF8",
};

// Limit bar fill — mirrors WidgetTheme.limitBarColor
function limitBarFill(fraction) {
  if (fraction >= 0.9) return "#E64D4D"; // red
  if (fraction >= 0.7) return "#D9A633"; // amber
  return "#33B866";                      // green
}

const PROVIDER_LOGOS = {
  claude: "/brand-logos/claude-code.svg",
  codex: "/brand-logos/codex.svg",
  cursor: "/brand-logos/cursor.svg",
  gemini: "/brand-logos/gemini.svg",
  kimi: "/brand-logos/kimi.svg",
  kiro: "/brand-logos/kiro.svg",
  copilot: "/brand-logos/copilot.svg",
  antigravity: "/brand-logos/antigravity.svg",
};

const MONO_LOGOS = new Set([
  "/brand-logos/cursor.svg",
  "/brand-logos/kimi.svg",
  "/brand-logos/kiro.svg",
  "/brand-logos/copilot.svg",
]);

const SUMMARY_TREND = [36, 42, 38, 57, 61, 52, 69, 65, 74, 70, 81, 79, 88, 86];

const TOP_MODELS_MOCK = [
  { source: "codex", name: "gpt-5.5", tokens: "738.8M", share: 34.8 },
  { source: "codex", name: "gpt-5.4", tokens: "384.0M", share: 18.1 },
  { source: "claude", name: "claude-opus-4-7", tokens: "163.7M", share: 7.7 },
  { source: "gemini", name: "gemini-2.5-pro", tokens: "141.2M", share: 6.6 },
];

const USAGE_LIMITS_MOCK = [
  { source: "claude", label: "Claude · 7d", reset: "in 1d", pct: 71 },
  { source: "claude", label: "Claude · 5h", reset: "in 4h 28m", pct: 42 },
  { source: "cursor", label: "Cursor", reset: "in 25d", pct: 55 },
  { source: "gemini", label: "Gemini", reset: "in 1d", pct: 32 },
];

// Deterministic heatmap cells — 26 weeks × 7 days, matching the native
// systemMedium heatmap width. Each cell is a native-like level 0...4.
const HEATMAP_CELLS = (() => {
  const weeks = 26;
  const days = 7;
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < days; d++) {
      const n = Math.sin((w + 1) * 12.9898 + (d + 1) * 78.233 + 17) * 43758.5453;
      const bucket = Math.floor(Math.abs(n - Math.floor(n)) * 5);
      cells.push({ w, d, level: Math.max(0, Math.min(4, bucket)) });
    }
  }
  return cells;
})();

const HEATMAP_LEVELS_LIGHT = [
  "rgba(128,128,128,0.10)",
  "rgba(91,95,199,0.25)",
  "rgba(91,95,199,0.50)",
  "rgba(91,95,199,0.75)",
  "#5B5FC7",
];

const HEATMAP_LEVELS_DARK = [
  "rgba(128,128,128,0.16)",
  "rgba(91,95,199,0.25)",
  "rgba(91,95,199,0.50)",
  "rgba(91,95,199,0.75)",
  "#5B5FC7",
];

function ProviderLogo({ source, alt, size = 13, className = "" }) {
  const src = PROVIDER_LOGOS[source];
  if (!src) return null;
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={cn(
        "shrink-0 object-contain",
        MONO_LOGOS.has(src) ? "dark:invert" : "",
        className,
      )}
      style={{ width: size, height: size }}
      draggable="false"
    />
  );
}

function WidgetCanvas({ children, className = "" }) {
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden p-[13px] text-[#171821] dark:text-white",
        "[background:linear-gradient(135deg,#f6f7fd_0%,#eff1fb_100%)]",
        "dark:[background:linear-gradient(135deg,#1e1f28_0%,#262734_100%)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function HeroBlock({ label, value, subline }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-oai-gray-500 dark:text-oai-gray-400">
        {label}
      </div>
      <div
        className="mt-1 text-[23px] font-bold leading-none text-[#171821] dark:text-white"
        style={{ fontFamily: ROUNDED_FONT }}
      >
        {value}
      </div>
      <div
        className="mt-1 text-[10px] font-semibold leading-none text-oai-gray-500 dark:text-oai-gray-400"
        style={{ fontFamily: ROUNDED_FONT }}
      >
        {subline}
      </div>
    </div>
  );
}

/**
 * PreviewShell — renders a widget tile at the real macOS systemMedium
 * aspect ratio (~2.13:1). `size="lg"` is the hero (up to 560px wide),
 * `size="sm"` is a secondary catalog tile (up to 264px wide). Both scale
 * down responsively on narrow viewports using CSS aspect-ratio.
 *
 * `rounded-[22/32px]` is an intentional deviation from the design system's
 * token radii: it mimics the macOS continuous-corner widget radius so the
 * preview reads as an Apple widget rather than a generic card.
 */
function PreviewShell({ size = "sm", children }) {
  const isHero = size === "lg";
  const maxWidth = isHero ? 560 : 264;
  const radius = isHero ? 32 : 22;
  return (
    <div
      className={cn(
        "flex w-full items-center justify-center rounded-xl bg-oai-gray-100 dark:bg-oai-gray-950/60",
        isHero ? "py-10 sm:py-14 px-6" : "py-6 px-4",
      )}
    >
      <div
        className="overflow-hidden bg-white dark:bg-oai-gray-800 shadow-oai-md dark:shadow-[0_2px_4px_rgba(0,0,0,0.4),0_8px_24px_rgba(0,0,0,0.5)]"
        style={{
          width: "100%",
          maxWidth,
          aspectRatio: `${WIDGET_W} / ${WIDGET_H}`,
          borderRadius: radius,
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SummaryWidgetPreview({ size = "sm" }) {
  return (
    <PreviewShell size={size}>
      <WidgetCanvas>
        <div className="flex h-full flex-col justify-between">
          <div className="flex items-start gap-3 pt-[1px]">
            <HeroBlock label="TODAY" value="203.2M" subline="$129.56  ±0%" />
            <HeroBlock label="7 DAYS" value="880.9M" subline="$673.61" />
          </div>
          <div className="h-8 overflow-hidden">
            <svg viewBox="0 0 238 32" className="h-full w-full" aria-hidden="true">
              <defs>
                <linearGradient id={`summary-spark-${size}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#5B5FC7" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#5B5FC7" stopOpacity="0.03" />
                </linearGradient>
              </defs>
              <path
                d="M0 32 L0 26 C9 22 18 24 27 20 C36 17 45 19 54 15 C63 12 72 14 81 10 C90 8 99 11 108 7 C117 5 126 8 135 6 C144 4 153 6 162 3 C171 2 180 4 189 2 C198 1 207 3 216 2 C225 1 232 2 238 1 L238 32 Z"
                fill={`url(#summary-spark-${size})`}
              />
              <polyline
                points={SUMMARY_TREND.map((value, index) => `${(238 / (SUMMARY_TREND.length - 1)) * index},${32 - value * 0.35}`).join(" ")}
                fill="none"
                stroke="#5B5FC7"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      </WidgetCanvas>
    </PreviewShell>
  );
}

function HeatmapWidgetPreview() {
  return (
    <PreviewShell>
      <WidgetCanvas>
        <div className="flex h-full flex-col justify-between">
          <div className="mt-[-2px] mb-[4px] flex flex-1 items-start justify-center">
            <svg viewBox="0 0 226 60" className="h-full w-full" aria-hidden="true">
              <g className="dark:hidden">
                {HEATMAP_CELLS.map((c) => (
                  <rect
                    key={`light-${c.w}-${c.d}`}
                    x={c.w * 8.76}
                    y={c.d * 8.62}
                    width="6.8"
                    height="6.8"
                    rx="1.1"
                    fill={HEATMAP_LEVELS_LIGHT[c.level]}
                  />
                ))}
              </g>
              <g className="hidden dark:inline">
                {HEATMAP_CELLS.map((c) => (
                  <rect
                    key={`dark-${c.w}-${c.d}`}
                    x={c.w * 8.76}
                    y={c.d * 8.62}
                    width="6.8"
                    height="6.8"
                    rx="1.1"
                    fill={HEATMAP_LEVELS_DARK[c.level]}
                  />
                ))}
              </g>
            </svg>
          </div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span
              className="text-[13px] font-bold leading-none text-[#171821] dark:text-white"
              style={{ fontFamily: ROUNDED_FONT }}
            >
              10.3B
            </span>
            <span className="text-[10px] leading-none text-oai-gray-500 dark:text-oai-gray-400">
              tokens · 202 active days
            </span>
          </div>
        </div>
      </WidgetCanvas>
    </PreviewShell>
  );
}

function TopModelsWidgetPreview() {
  return (
    <PreviewShell>
      <WidgetCanvas>
        <div className="flex h-full flex-col justify-between py-[2px]">
          {TOP_MODELS_MOCK.map((model) => (
            <div key={model.name} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <ProviderLogo source={model.source} alt={`${model.source === "claude" ? "Claude" : model.source === "codex" ? "Codex" : model.source === "cursor" ? "Cursor" : "Gemini"} logo`} size={9} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[#171821] dark:text-white">
                  {model.name}
                </span>
                <span
                  className="text-[10px] font-semibold text-oai-gray-500 dark:text-oai-gray-400"
                  style={{ fontFamily: ROUNDED_FONT }}
                >
                  {model.tokens}
                </span>
                <span
                  className="w-8 text-right text-[9px] font-semibold text-oai-gray-400 dark:text-oai-gray-500"
                  style={{ fontFamily: ROUNDED_FONT }}
                >
                  {Math.round(model.share)}%
                </span>
              </div>
              <div className="h-[5px] rounded-full bg-black/8 dark:bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${model.share}%`,
                    minWidth: model.share > 0 ? 4 : 0,
                    backgroundColor: SOURCE_COLORS[model.source],
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </WidgetCanvas>
    </PreviewShell>
  );
}

function UsageLimitsWidgetPreview() {
  return (
    <PreviewShell>
      <WidgetCanvas>
        <div className="flex h-full flex-col justify-between py-[2px]">
          {USAGE_LIMITS_MOCK.map((limit) => (
            <div key={limit.label} className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5">
                <ProviderLogo source={limit.source} alt={`${limit.source === "claude" ? "Claude" : limit.source === "codex" ? "Codex" : limit.source === "cursor" ? "Cursor" : "Gemini"} logo`} size={9} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-medium text-[#171821] dark:text-white">
                  {limit.label}
                </span>
                <span
                  className="text-[9px] text-oai-gray-500 dark:text-oai-gray-400"
                  style={{ fontFamily: ROUNDED_FONT }}
                >
                  {limit.reset}
                </span>
                <span
                  className="w-8 text-right text-[10px] font-semibold text-[#171821] dark:text-white"
                  style={{ fontFamily: ROUNDED_FONT }}
                >
                  {limit.pct}%
                </span>
              </div>
              <div className="h-[5px] rounded-full bg-black/8 dark:bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${limit.pct}%`,
                    minWidth: limit.pct > 0 ? 4 : 0,
                    backgroundColor: limitBarFill(limit.pct / 100),
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </WidgetCanvas>
    </PreviewShell>
  );
}

/* ---------- Menu bar display configurator ---------- */

function previewValueFor(item) {
  switch (item.category) {
    case "cost":
      return "$8.42";
    case "limits":
      return "62%";
    default:
      return item.id === "last7dTokens" ? "1.8B" : "203M";
  }
}

function metricLabel(id, fallback) {
  switch (id) {
    case "todayTokens":
      return copy("menubar.metric.today_tokens");
    case "todayCost":
      return copy("menubar.metric.today_cost");
    case "last7dTokens":
      return copy("menubar.metric.last_7d_tokens");
    case "totalTokens":
      return copy("menubar.metric.total_tokens");
    case "totalCost":
      return copy("menubar.metric.total_cost");
    case "claude5h":
      return copy("menubar.metric.claude_5h");
    case "claude7d":
      return copy("menubar.metric.claude_7d");
    case "codex5h":
      return copy("menubar.metric.codex_5h");
    case "codex7d":
      return copy("menubar.metric.codex_7d");
    default:
      return fallback;
  }
}

function fillTwoSlots(ids, availableItems) {
  const allowed = new Set(availableItems.map((item) => item.id));
  const filled = ids.filter((id) => allowed.has(id));
  for (const item of availableItems) {
    if (filled.length >= 2) break;
    if (!filled.includes(item.id)) filled.push(item.id);
  }
  return filled.slice(0, 2);
}

/**
 * Compact menu-bar segment mock — sized to the same proportions as a real
 * macOS status item so the preview reads as "this is what your menu bar
 * will look like" rather than "this is a control surface".
 *
 * Dark pill on a neutral wallpaper-style backdrop. When `showStats` is off,
 * only the icon is shown (matches the native fallback behavior).
 */
function MenuBarPreview({ slotConfigs, showStats }) {
  return (
    <div className="flex justify-center rounded-xl bg-gradient-to-b from-oai-gray-100 to-oai-gray-200 px-6 py-8 dark:from-oai-gray-950/80 dark:to-oai-gray-900/80">
      <div
        className="inline-flex items-stretch rounded-md shadow-[0_1px_3px_rgba(0,0,0,0.18)] ring-1 ring-black/10 dark:ring-white/10 px-3"
        style={{ background: "linear-gradient(180deg, #2c2c2e 0%, #1c1c1e 100%)" }}
      >
        {/* Icon column: asymmetric padding (more left, less right) brings the
            character close to the first metric since there's no separator
            between them. Character is sized to read like a real macOS
            menu-bar glyph rather than a hero illustration. */}
        <div className="flex items-center pl-2 pr-1 py-2.5">
          <img
            src="/clawd/mini/idle-tight.svg"
            alt=""
            aria-hidden="true"
            className="block shrink-0"
            style={{ height: 22, width: "auto" }}
            draggable="false"
          />
        </div>
        {showStats
          ? slotConfigs.map(({ slot, item }, idx) => (
              <React.Fragment key={slot}>
                {idx > 0 ? (
                  <span className="my-1 w-px bg-white/20" aria-hidden="true" />
                ) : null}
                <div className={cn(
                  "flex min-w-[52px] flex-col items-center justify-center py-1.5",
                  // First metric column hugs closer to the icon (no separator
                  // there); subsequent columns get even padding around the divider.
                  idx === 0 ? "pl-1 pr-2" : "px-2",
                )}>
                  <span className="text-[13px] font-semibold leading-none tabular-nums text-white">
                    {item?.previewValue || "--"}
                  </span>
                  <span className="mt-[2px] text-[6px] font-semibold uppercase leading-none text-white/75">
                    {item?.shortLabel || "Metric"}
                  </span>
                </div>
              </React.Fragment>
            ))
          : null}
      </div>
    </div>
  );
}

function MenuBarSlotSelect({ slot, value, options, disabled, onChange }) {
  const slotLabel = slot === 0 ? copy("menubar.slot.primary") : copy("menubar.slot.secondary");
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-oai-gray-500 dark:text-oai-gray-400">
        {slotLabel}
      </span>
      <div className="relative">
        <select
          value={value}
          disabled={disabled}
          aria-label={slotLabel}
          onChange={(event) => onChange(slot, event.target.value)}
          className={cn(
            "w-full appearance-none rounded-lg border border-oai-gray-200 bg-white px-3 py-2 pr-9 text-sm font-medium text-oai-black transition-colors hover:border-oai-gray-300 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-white dark:hover:border-oai-gray-700",
            disabled && "cursor-not-allowed opacity-50 hover:border-oai-gray-200 dark:hover:border-oai-gray-800",
          )}
        >
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.displayLabel}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-oai-gray-400"
          aria-hidden="true"
        />
      </div>
    </label>
  );
}

function MenuBarToggleRow({ label, hint, checked, disabled, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-oai-black dark:text-white">{label}</p>
        {hint ? (
          <p className="mt-0.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">{hint}</p>
        ) : null}
      </div>
      <ToggleSwitch checked={checked} disabled={disabled} onChange={onChange} ariaLabel={label} />
    </div>
  );
}

function MenuBarDisplayCard() {
  const { available, settings, setSetting } = useNativeSettings();

  const availableItems = useMemo(() => {
    const nativeItems = Array.isArray(settings?.menuBarAvailableItems)
      ? settings.menuBarAvailableItems
      : FALLBACK_MENU_BAR_ITEMS;
    return nativeItems.map((item) => ({
      ...item,
      displayLabel: metricLabel(item.id, item.label),
      previewValue: previewValueFor(item),
    }));
  }, [settings?.menuBarAvailableItems]);

  const maxItems = Number(settings?.menuBarMaxItems) || 2;
  const selectedIds = useMemo(
    () => normalizeMenuBarItems(settings?.menuBarItems, availableItems, maxItems),
    [availableItems, maxItems, settings?.menuBarItems],
  );
  const slotIds = useMemo(() => fillTwoSlots(selectedIds, availableItems), [availableItems, selectedIds]);
  const showStats = settings?.showStats !== false;

  const saveSelection = (ids) => {
    setSetting("menuBarItems", normalizeMenuBarItems(ids, availableItems, maxItems));
  };

  const changeSlot = (slot, id) => {
    const next = [...slotIds];
    const otherSlot = slot === 0 ? 1 : 0;
    if (next[otherSlot] === id) return;
    next[slot] = id;
    saveSelection(next);
  };

  const slotConfigs = [0, 1].map((slot) => {
    const currentValue = slotIds[slot] || availableItems[slot]?.id || "";
    const otherSlot = slot === 0 ? 1 : 0;
    const otherValue = slotIds[otherSlot];
    const options = availableItems.filter(
      (candidate) => candidate.id === currentValue || candidate.id !== otherValue,
    );
    const item = availableItems.find((candidate) => candidate.id === currentValue);
    return { slot, currentValue, options, item };
  });

  const animatedIcon = settings?.animatedIcon !== false;

  return (
    <article className="vd-card rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm p-5 transition-colors duration-200 sm:p-6">
      <MenuBarPreview slotConfigs={slotConfigs} showStats={showStats} />

      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {slotConfigs.map(({ slot, currentValue, options }) => (
          <MenuBarSlotSelect
            key={slot}
            slot={slot}
            value={currentValue}
            options={options}
            disabled={!available || !showStats}
            onChange={changeSlot}
          />
        ))}
      </div>

      <div className="mt-5 divide-y divide-oai-gray-100 border-t border-oai-gray-100 dark:divide-oai-gray-800 dark:border-oai-gray-800">
        <MenuBarToggleRow
          label={copy("settings.menubar.showStats")}
          hint={available ? copy("settings.menubar.showStatsHint") : copy("menubar.native_only")}
          checked={showStats}
          disabled={!available}
          onChange={() => setSetting("showStats", !showStats)}
        />
        <MenuBarToggleRow
          label={copy("settings.menubar.animatedIcon")}
          hint={copy("settings.menubar.animatedIconHint")}
          checked={animatedIcon}
          disabled={!available}
          onChange={() => setSetting("animatedIcon", !animatedIcon)}
        />
      </div>
    </article>
  );
}

/* ---------- Header CTA — adaptive by platform ----------
 * native  → inside the menu bar app's WKWebView (bridge currently available)
 * mac-web → browser on macOS (can download the native app)
 * other   → non-macOS browser (widgets unsupported)
 *
 * NOTE: we use `isNativeEmbed()` here (checks `window.webkit.messageHandlers
 * .nativeBridge` directly) instead of `isNativeApp()` (which reads a sticky
 * localStorage flag). The sticky flag persists after the native app launched
 * the dashboard once, so later opening `localhost:5173` in a regular browser
 * would incorrectly report native mode — clicks would then fire a bridge
 * message into the void. isNativeEmbed is the honest "right now" test.
 */
function useClientPlatform() {
  const [platform, setPlatform] = useState("loading");
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isNativeEmbed()) {
      setPlatform("native");
      return;
    }
    const ua = (navigator.userAgent || "").toLowerCase();
    const isMac = /mac/.test(ua) && !/iphone|ipad/.test(ua);
    setPlatform(isMac ? "mac-web" : "other");
  }, []);
  return platform;
}

function HeaderCta() {
  const platform = useClientPlatform();

  // Reserve space so the layout doesn't jump once detection resolves.
  if (platform === "loading") {
    return <div className="h-10 w-40" aria-hidden="true" />;
  }

  if (platform === "native") {
    return (
      <button
        type="button"
        onClick={() => nativeAction("openWidgetGallery")}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-oai-brand px-4 text-sm font-medium text-white shadow-[0_10px_24px_rgba(91,95,199,0.22)] transition-colors hover:bg-oai-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:bg-oai-brand-400 dark:text-oai-brand-950 dark:hover:bg-oai-brand-300"
      >
        {copy("widgets.cta.open_gallery")}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </button>
    );
  }

  if (platform === "mac-web") {
    return (
      <a
        href={GITHUB_RELEASES_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-oai-brand px-4 text-sm font-medium text-white no-underline shadow-[0_10px_24px_rgba(91,95,199,0.22)] transition-colors hover:bg-oai-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:bg-oai-brand-400 dark:text-oai-brand-950 dark:hover:bg-oai-brand-300"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {copy("widgets.cta.download")}
      </a>
    );
  }

  // Non-macOS — widgets aren't available, tell the user gently.
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-4 text-sm font-medium text-oai-gray-500 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:text-oai-gray-400">
      <Monitor className="h-4 w-4" aria-hidden="true" />
      {copy("widgets.cta.macos_only")}
    </span>
  );
}

/* ---------- Secondary catalog data ---------- */

const SECONDARY_WIDGETS = [
  { id: "summary",  Preview: SummaryWidgetPreview,      nameKey: "widgets.summary.name",   descKey: "widgets.summary.description" },
  { id: "heatmap",   Preview: HeatmapWidgetPreview,    nameKey: "widgets.heatmap.name",   descKey: "widgets.heatmap.description" },
  { id: "topModels", Preview: TopModelsWidgetPreview,  nameKey: "widgets.topModels.name", descKey: "widgets.topModels.description" },
  { id: "limits",    Preview: UsageLimitsWidgetPreview, nameKey: "widgets.limits.name",   descKey: "widgets.limits.description" },
];

function WidgetCatalogCard({ Preview, nameKey, descKey }) {
  return (
    <article className="vd-card flex h-full flex-col rounded-xl border border-oai-gray-200 bg-white p-4 transition-colors duration-200 dark:border-oai-gray-800 dark:bg-oai-gray-900 sm:p-5">
      <Preview />
      <div className="mt-4">
        <h3 className="text-[15px] font-semibold text-oai-black dark:text-white">
          {copy(nameKey)}
        </h3>
        <p className="mt-1.5 text-sm leading-relaxed text-oai-gray-500 dark:text-oai-gray-400">
          {copy(descKey)}
        </p>
      </div>
    </article>
  );
}

/* ---------- Page ---------- */

function SectionTitle({ titleKey }) {
  return (
    <h2 className="mb-4 text-xl font-semibold tracking-tight text-oai-black dark:text-white sm:mb-5 sm:text-2xl">
      {copy(titleKey)}
    </h2>
  );
}

export function WidgetsPage() {
  return (
    <div className="flex flex-col flex-1 text-oai-black dark:text-oai-white font-oai antialiased">
      <main className="flex-1 pt-8 sm:pt-10 pb-12 sm:pb-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {/* Page header — H1 + adaptive CTA. No page subtitle (the two H2
              sections speak for themselves; subtitles only added title noise). */}
          <FadeIn y={12}>
            <header className="mb-10 flex items-start justify-between gap-4 sm:mb-12">
              <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                {copy("widgets.page.title")}
              </h1>
              <div className="shrink-0">
                <HeaderCta />
              </div>
            </header>
          </FadeIn>

          {/* Menu Bar — own section, dedicated card */}
          <FadeIn y={12} delay={0.06}>
            <section aria-label={copy("widgets.menubar.section.title")} className="mb-12 sm:mb-14">
              <SectionTitle titleKey="widgets.menubar.section.title" />
              <MenuBarDisplayCard />
            </section>
          </FadeIn>

          {/* Desktop Widgets gallery */}
          <section aria-label={copy("widgets.gallery.section.title")}>
            <SectionTitle titleKey="widgets.gallery.section.title" />
            <StaggerContainer staggerDelay={0.08} initialDelay={0.04}>
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
                {SECONDARY_WIDGETS.map(({ id, Preview, nameKey, descKey }) => (
                  <StaggerItem key={id}>
                    <WidgetCatalogCard Preview={Preview} nameKey={nameKey} descKey={descKey} />
                  </StaggerItem>
                ))}
              </div>
            </StaggerContainer>
          </section>
        </div>
      </main>
    </div>
  );
}
