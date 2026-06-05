# VibeDeck Design System

Single source of truth for the **Dashboard (web)**, **macOS app**, and **macOS Widgets**.
Color is locked to the logo. Surface-level revamp covers every API surface introduced
through 1.0.4 (Optimize, Plan, Live actionable panels, expanded provider breadth, analytics surfaces).

> Implementation grounding:
> - Web tokens live in `dashboard/src/styles.css` (`:root` + `:root.dark`)
> - macOS app tokens live in `VibeDeckMac/VibeDeckMac/Utilities/Colors.swift`
> - Widget tokens live in `VibeDeckMac/VibeDeckWidget/Views/WidgetTheme.swift`
> - All three must stay in lockstep with this file. If you change a token here, change it in all three.

---

## 1. Product context

- **What it is:** Local-first cost and provenance dashboard for AI coding agents.
- **Who it's for:** Solo developers and small teams running multiple AI coding tools (Claude Code, Codex, Cursor, Gemini, Kimi, Kiro, Copilot, Antigravity, Cline, Droid, Qwen, Opencode, Openclaw, Everycode).
- **Space:** Developer productivity / observability. Adjacent to Posthog, Linear, Raycast — but local, not hosted.
- **Project type:** Desktop-first product. **macOS app is the premier surface.** Dashboard (web) is the deep-dive surface. Widgets are the glanceable surface. CLI is the power-user surface.
- **Tone:** Quiet, engineered, trustworthy. Not flashy. Numbers do the talking.

---

## 2. Aesthetic direction

**Quiet Engineering.**

The product watches every AI tool burning tokens in the background. The UI should feel
like a flight instrument panel — calm, dense where it needs to be, sparse where it doesn't,
and never excited about its own existence. The data is the show. Chrome is the stage.

- **Decoration level:** minimal. Typography, hairline borders, and a single indigo accent carry everything. No gradients in chrome (the logo container is the only gradient surface in the entire system). No drop shadows beyond a single soft elevation. No icon-in-colored-circle decorations. No purple/violet glow effects.
- **Density:** comfortable on the dashboard, compact on macOS, dense on widgets.
- **Mood:** A sealed lab notebook. You open it, the numbers are right where you left them, and you trust them.

**Three deliberate departures from category norms** (this is where VibeDeck gets its own face):

1. **Indigo over the usual SaaS purple-violet gradient.** Every observability product trends toward purple gradients on hero CTAs. We use a flat desaturated indigo (`#5b5fc7`) and only ever solid fills. The logo's three-plane stack is the only gradient surface.
2. **Outfit for display, not Inter.** Every developer tool ships Inter. Outfit's geometric softness keeps the numbers readable while signalling "this isn't another grafana clone."
3. **OKLCH neutrals with a `264` blue-violet hue.** Greys are warm-toward-indigo, not warm-toward-brown or cool-toward-cyan. Every surface in the product carries a 1-2% indigo tint, so when the accent appears it lands in family.

---

## 3. Color — locked to logo

The logo is non-negotiable. These three plane fills define the entire indigo scale:

| Logo plane | Hex | Token name (web) | Token name (Swift) | Role |
|------------|-----|------------------|--------------------|------|
| Top plane | `#a5b4fc` | `--brand-300` | `WidgetTheme.brandLight` | Light surfaces, dark-mode accent text |
| Middle plane | `#818cf8` | `--brand-400` | `WidgetTheme.brand` (light) | Hover, secondary accent |
| Bottom plane | `#6366f1` | `--brand-500` | `Colors.brandPrimary` | Primary indigo |
| Container top | `#1e1b4b` | `--brand-950` | n/a | Logo background only |
| Container bottom | `#2a2566` | n/a | n/a | Logo background only |

### Primary palette (use this, not the legacy mappings)

```
brand-50   #f5f5ff   surface tint (light), unselected nav hover
brand-100  #ededff   table head, kbd, code background (light)
brand-200  #d4d4ff   border on tinted cards
brand-300  #a5b4fc   accent text on dark, dim chart bars
brand-400  #818cf8   focus ring, hover, secondary accent
brand-500  #6366f1   primary indigo (CTAs, active nav, links)
brand-600  #5b5fc7   primary indigo on dark, default body accent
brand-700  #4f46a8   pressed state, strong borders
brand-800  #3b3686   text accent on light
brand-900  #312e6a   deepest text accent
brand-950  #1e1b4b   logo container, dark-mode hero gradient anchor
```

### Semantic colors (use sparingly — the data carries meaning, not color)

| Role | Light | Dark | When to use |
|------|-------|------|-------------|
| Success | `#22c55e` | `#4ade80` | Provider healthy, limits OK, sync succeeded |
| Warning | `#f59e0b` | `#fbbf24` | Approaching provider limit (70-90%), attribution low confidence |
| Danger | `#ef4444` | `#f87171` | Over limit, sync failed, repair failed |
| Info | `#5b5fc7` | `#818cf8` | **= primary indigo.** Reuse the brand, do not introduce a second blue. |

### Neutrals (OKLCH with `264` hue — keep the indigo undertone)

Already defined in `dashboard/src/styles.css`. Do not introduce hex greys outside this scale.
On macOS, mirror the OKLCH values as `Color(.sRGB, ...)` in `Colors.swift`.

### Provider accents (live in `WidgetTheme.sourceColor` and dashboard `SOURCE_COLORS`)

All twelve provider colors are tuned to the indigo family — none are off-hue greens, oranges, or reds. Keep them that way. New providers added later should hue-sample from `oklch(60% 0.15 264)` ± 30° hue and ± 10% lightness. **Never use a provider's brand color directly.** If a vendor's marketing site uses neon yellow, we still tint them indigo on our surfaces. Their logo (used as a mark in lists) keeps brand color; their fills, bars, and dots stay in our family.

### Dark mode strategy

- Tokens swap, not invert. The `:root.dark` block in `styles.css` is the reference contract.
- Accent shifts up the scale: light mode uses `--brand-500/600`, dark mode uses `--brand-400/300`.
- Surface tint stays present (`rgba(129, 140, 248, 0.09)`) so dark surfaces don't drift to flat grey.
- Glass bg in dark: `rgba(20, 20, 28, 0.75)` with 20px blur. Glass border: `rgba(255, 255, 255, 0.08)`.

---

## 4. Typography

| Role | Family | Loaded from | Notes |
|------|--------|-------------|-------|
| Display (hero, page H1, big numbers) | **Outfit** | Bunny Fonts CDN | 700/600/500. Tracking `-0.01em` at large sizes. |
| Body, UI, labels | **Plus Jakarta Sans** | Bunny Fonts CDN | 400/500/600/700. Replaces every prior use of Inter/DM Sans. |
| Numeric data (tables, charts, widget counters) | **Plus Jakarta Sans** with `font-variant-numeric: tabular-nums` | (same) | Always tabular. Money/tokens never reflow column width. |
| Mono (code, paths, hashes, kbd) | **JetBrains Mono** | `@fontsource/geist-mono` is loaded but unused → **remove `@fontsource/geist-mono` from `dashboard/package.json`**, use JetBrains Mono everywhere |

**Scale (web — defined in `styles.css`):**
- `--text-hero` 48px — only marketing/onboarding heroes
- `--text-h1` 36px — page titles
- `--text-h2` 28px — section headings
- `--text-h3` 22px — card titles
- `--text-h4` 18px — subsection
- `--text-body` 16px — default
- `--text-body-sm` 14px — dense tables, secondary text
- `--text-caption` 12px — timestamps, footnotes
- `--text-label` 11px — uppercase chips, axis labels

**Scale (macOS app — SwiftUI):** match Apple's defaults (`.largeTitle`, `.title`, `.title2`, `.title3`, `.headline`, `.body`, `.callout`, `.caption`). Override only the display font via `.fontDesign(.rounded)` for hero numbers in `SummaryCardsView`.

**Scale (widgets):** use `WidgetFormat.compact` for numbers, `.system(.title, design: .rounded)` for hero values, `.system(.caption2, design: .default)` for labels. Widget extension has a tight binary budget — do not import additional font files.

**Banned:** Inter, Roboto, DM Sans (replaced), Geist (loaded but unused), system-ui for body (only as ultimate fallback).

---

## 5. Spacing & layout

**Base unit:** 4px. The web app uses Tailwind's 4px scale, macOS uses SwiftUI's default 4pt spacing.

**Density tiers:**
- **Dashboard:** comfortable. 16-24px gutters between cards. 12px internal card padding minimum.
- **macOS app:** compact. 8-12px gutters. Window opens at 1100×720, content fits without scroll on the home tab.
- **Widgets:** dense. Small widget = 158×158, Medium = 338×158, Large = 338×354. Every pixel costs.

**Grid:**
- Dashboard max content width: `1280px`. Above that, content centers; the background extends.
- Dashboard sidebar: `240px` (left nav, when present). Collapses below `1024px`.
- macOS app uses a sidebar + content split (NavigationSplitView), sidebar `220pt` fixed.

**Border radius (hierarchical — do not mix levels):**
- `sm` 4px — chips, badges, inline kbd
- `md` 8px — buttons, inputs, small cards
- `lg` 12px — primary cards, panels
- `xl` 16px — page-level containers, modals
- `2xl` 24px — widget surfaces (matches macOS widget chrome)
- `full` 9999px — avatar dots only

**Elevation:** one shadow token, used sparingly.
```
--vd-shadow: 0 1px 2px rgba(49, 46, 106, 0.04), 0 14px 38px rgba(49, 46, 106, 0.07);
```
Cards do not have shadows by default. Apply elevation only when a surface is detached (modal, drawer, dropdown).

---

## 6. Motion

**Approach:** minimal-functional. Motion exists to explain state change, not to entertain.

| Token | Duration | Easing | Use |
|-------|----------|--------|-----|
| `micro` | 80ms | `ease-out` | Hover lifts, focus rings |
| `short` | 180ms | `ease-out` | Tab switches, drawer slide-in entry, accordion |
| `medium` | 320ms | `cubic-bezier(0.32, 0.72, 0, 1)` | Page transitions, modal open |
| `long` | 600ms | `cubic-bezier(0.32, 0.72, 0, 1)` | Onboarding sequence only |

Use `motion` (already in `package.json`) for orchestrated entrances on hero cards. Never animate numbers ticking up — the data is real, not a slot machine.

**`prefers-reduced-motion: reduce` cuts every duration to ≤50ms and disables transform-based entrances.** This is a hard rule. Check `FadeIn.jsx` already respects this; new components must too.

---

## 7. Component rules

### Cards & panels (web)

```jsx
className="rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm shadow-none"
```

- All cards use the glass tokens. **Never hardcode `bg-white dark:bg-oai-gray-900`** on a card container — see memory `project_palette_rework.md`.
- Side drawers are the exception: solid `bg-white dark:bg-[#0f0f14]`, never glass.
- Indigo-tinted "highlighted" cards (e.g., live session active): add `var(--vd-tint)` as a layer, keep the glass border.

### Buttons (web)

| Variant | Light | Dark |
|---------|-------|------|
| Primary | `bg-brand-600 text-white hover:bg-brand-700` | `bg-brand-500 text-white hover:bg-brand-400` (NOT white background — see memory) |
| Secondary | `bg-brand-50 text-brand-800 border-brand-200 hover:bg-brand-100` | `bg-[var(--vd-tint)] text-brand-300 border-[var(--vd-border)]` |
| Ghost | `text-brand-700 hover:bg-brand-50` | `text-brand-300 hover:bg-[var(--vd-tint)]` |
| Danger | `bg-[var(--oai-error)] text-white` | same, with dark error token |

All buttons: `rounded-md`, `font-medium`, `text-sm`, `px-3 py-1.5`, focus ring `var(--vd-ring)`.

### Buttons (macOS)

Use `.buttonStyle(.borderedProminent)` with `.tint(Colors.brandPrimary)` for primary actions. Match `Colors.brandPrimary` to web `--brand-600` in light mode, `--brand-500` in dark mode.

### Tables (web)

- Header row: `bg-[var(--vd-table-head-bg)]`, `text-[var(--text-label)]`, uppercase, `tracking-wide`, indigo tint.
- Body rows: alternating zero — no zebra. Hover row: `bg-[var(--vd-tint)]`.
- Numeric columns: `font-variant-numeric: tabular-nums`, right-aligned, `font-mono` only if the values are hashes/IDs (not money/tokens).
- Sticky first column on overflow, sticky header always.

### Charts (web)

- One indigo accent per chart minimum, plus neutrals. Stacked charts use the brand scale from `--brand-300` (lightest) → `--brand-700` (darkest), not a rainbow.
- Provider breakdown charts use `SOURCE_COLORS` from `WidgetsPage.jsx` (mirrors `WidgetTheme.sourceColor`). Twelve providers max per stack; everything else collapses to "Other" in `--oai-gray-400`.
- Grid lines: `var(--oai-gray-200)` light, `var(--oai-gray-300)` dark, never darker.
- Axis labels: `text-label` (11px), `text-[var(--oai-gray-500)]`.

### Form controls (web)

- Inputs: `rounded-md border-[var(--vd-border)] bg-[var(--vd-control-bg)] focus:border-brand-500 focus:ring-2 focus:ring-[var(--vd-ring)]`
- Toggle: see `components/settings/Controls.jsx`. Off track: `var(--oai-gray-300)`. On track: `var(--brand-500)`. Thumb: white.
- Select: Base UI from `@base-ui/react`. Popover bg: `var(--vd-popover-bg)`. Hover item: `var(--vd-tint)`. Selected: `var(--brand-500)` left bar.

### Live signals & status

- **Pulsing dot for "live now":** `--brand-500` 8px circle with `box-shadow: 0 0 0 0 var(--brand-500)` keyframe out to `8px transparent`. Period: 1.6s. Used on `LiveOperationsPanel`, `LiveSessionList`, macOS menubar icon.
- **Confidence badge** (`ConfidenceBadge.jsx`): three states.
  - High: `bg-brand-50 text-brand-700 border-brand-200`
  - Medium: `bg-amber-50 text-amber-800 border-amber-200`
  - Low: `bg-red-50 text-red-800 border-red-200`
  Match dark variants by swapping to `--vd-tint` family for backgrounds.

---

## 8. Surface 1 — Dashboard (web)

### What changed (since the last palette rework)

New pages introduced through 1.0.4 that the revamp must cleanly express:

- `OptimizePage.jsx` — Phase 5 optimize scanner output. Surfaces savings opportunities per provider, model, and session.
- `PlanPage.jsx` — Phase 5 currency forecast. Subscription vs PAYG breakeven, projected monthly spend.
- `LivePage.jsx` (revamped) — now actionable: `BranchOverridePanel`, `AttributionHealthCard`, `LiveProviderLimitsGrid`, `LiveWorkstreamDrawer`.
- `ComparePage.jsx`, `ModelsPage.jsx`, `YieldPage.jsx`, `SkillsPage.jsx` — analytics & deep-history surfaces.
- `BranchesPage.jsx` — branch attribution.
- `WidgetsPage.jsx` — macOS widget previews and configuration.

> **Excluded from this design:** `EntirePage.jsx` and its supporting components (`CheckpointFileInspector`, `EntireCommandCenter`, `RecentReposPane`, `CheckpointTimeline`, etc.) are commented out in code (UI, setup, and backend). Treat them as **not shipping in this revamp**. Do not link to `/entire`. Do not surface checkpoint inspector UI anywhere. If a future iteration brings them back, design specs will be added then.

### Information architecture

The dashboard has too many pages for a flat nav. **Group into four lanes** in the left sidebar:

```
LIVE          (the "now" lane)
  ├─ Live          → LivePage
  └─ Branches      → BranchesPage

INTELLIGENCE  (the "decide" lane — Phase 5 surfaces live here)
  ├─ Optimize      → OptimizePage
  ├─ Plan          → PlanPage
  ├─ Compare       → ComparePage
  └─ Models        → ModelsPage

ANALYTICS     (the "look back" lane)
  ├─ Yield         → YieldPage
  └─ Skills        → SkillsPage

SETUP
  ├─ Widgets       → WidgetsPage
  ├─ Export        → ExportPage
  └─ Settings      → SettingsPage
```

The Dashboard page (`DashboardPage.jsx`) is the landing route — it's a synthesis surface, not a lane. It shows the top-of-funnel: today's spend, active sessions, top three providers, latest checkpoint, and a single "needs your attention" card (e.g., approaching provider limit).

### Page-level patterns

Every page follows this skeleton:

```
┌─────────────────────────────────────────────────┐
│  [H1 Page title]              [period picker]   │  ← Page header
│  Subtitle / one-line context  [actions]         │
├─────────────────────────────────────────────────┤
│  [Hero card — single biggest number]            │  ← Optional, only on dashboard/optimize/plan
├─────────────────────────────────────────────────┤
│  [Card grid — 2 or 3 col, responsive]           │
│  [Card]  [Card]  [Card]                         │
├─────────────────────────────────────────────────┤
│  [Wide panel — table, chart, or timeline]       │
└─────────────────────────────────────────────────┘
```

**Page header rule:** `text-h1` Outfit, `font-semibold`, color `var(--oai-black)`. Period picker right-aligned with `text-sm`. Never two H1s on the same page.

### LivePage revamp specifics

The hardest page. Currently dense; needs hierarchy.

- Top row: `LiveWorkbenchOverview` (full width, 4 stat cards: active sessions, today's tokens, today's cost, attribution coverage %).
- Middle: two-column split. Left = `LiveSessionList` (sortable, 60% width). Right = `AttributionHealthCard` + `LiveProviderLimitsGrid` stacked.
- Bottom: `LiveOperationsPanel` (wide table of recent operations) with `LiveBranchSignalMap` collapsible above it.
- `BranchOverridePanel` is a slide-in drawer (right side, 480px), triggered from session row. Solid background — see memory rule.
- `ConfidenceBadge` appears inline next to attribution numbers, never alone.

### OptimizePage specifics

This page sells the value of running VibeDeck. Lead with the savings number.

- Hero: "**You can save $X/mo**" in `text-hero` Outfit, brand-700 (light) / brand-300 (dark). Below it: one-line breakdown ("$X cache, $Y model swap, $Z subscription").
- Three cards: cache hit opportunities, model swap suggestions, subscription vs PAYG analysis (linked to PlanPage).
- Each opportunity card: indigo left border (`border-l-4 border-brand-500`), expanding to show the specific sessions and recommended action.

### PlanPage specifics

- Hero: forecast chart, 30-60-90 day projection. Single indigo line, dashed extension into forecast region. Subscription tier thresholds as horizontal `--brand-200` lines.
- Below: two cards. "Current subscription efficiency" and "PAYG equivalent cost." Whichever wins gets a `bg-brand-50 border-brand-200` highlight.

---

## 9. Surface 2 — macOS app

### What changed

- New tabs: `OptimizePlanTabsView.swift`, analytics tab group (Compare / Models / Yield / Skills).
- `DashboardView` now wraps `SummaryCardsView`, `UsageTrendChart`, `TopModelsView`, `UsageLimitsView`, `ActivityHeatmapView`, `ClawdCompanionView`.
- Server offline state: `ServerOfflineView.swift`. New error path that needs design love.
- `LimitsSettingsView.swift` is the only modal sheet in the app.

### Window & navigation

- **Window:** `NSWindow` at 1100×720, min 960×640. Background uses `.windowBackground` material so it respects macOS appearance.
- **Navigation:** `NavigationSplitView` with three columns collapsing to two on narrow widths.
  - Sidebar (220pt fixed): four sections matching the dashboard lanes (Live, Intelligence, Analytics, Setup). Section headers `Color.secondary`, items `Color.primary`, selected `Colors.brandPrimary`.
  - Detail: the active surface.
- **Title bar:** `.titlebarAppearsTransparent`. Inline title only. No toolbar icons except a single sync-status indicator (right side) and period picker (right side).

### Component patterns

- **Cards (`SharedComponents.swift`):**
  ```swift
  RoundedRectangle(cornerRadius: 12)
    .fill(.regularMaterial)
    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Colors.cardBorder, lineWidth: 0.5))
  ```
  Material gives the SwiftUI-native vibrancy. Border is `Colors.brandPrimary.opacity(0.18)` in light, `.opacity(0.24)` in dark.

- **Hero numbers:** `.font(.system(size: 44, weight: .semibold, design: .rounded))`. Color `Colors.brandPrimary` on dark mode, `Color.primary` on light (let the accent live in supporting elements).

- **Charts:** SwiftUI `Charts` package. Single accent color = `Colors.brandPrimary`. Multi-series uses the same `WidgetTheme.modelDot` palette so widgets and app stay coherent.

- **`ServerOfflineView`:** centered, single illustration (the three-plane logo mark in `Color.secondary.opacity(0.3)`), `text-h2` headline "VibeDeck server is offline," one-line subtitle, primary button "Restart server" (calls embedded server lifecycle), secondary button "Open dashboard in browser" (disabled until reachable). **Do not show stack traces.** Logs go in `~/Library/Application Support/VibeDeck/logs/`.

- **`LimitsSettingsView` sheet:** 480×640 modal, two-column form (label left, control right), `.formStyle(.grouped)`, primary action bottom-right.

### Menubar item

Still owned by the main app. Icon: monochrome mark (`mark-mono.svg` exported to PDF asset), tinted by macOS automatically.

- Click: opens 320pt-wide popover with today's totals, three top providers, "Open app" button.
- Right-click / control-click: standard menu (Open, Preferences, Quit).
- Active session pulses the menubar icon: 1.6s subtle opacity oscillation (0.6 → 1.0), `prefers-reduced-motion` disables.

### Tab content patterns

- **`DashboardView`** (the home tab): vertical scroll, sections separated by `Color.secondary.opacity(0.1)` 1pt dividers with 24pt top padding.
- **`OptimizePlanTabsView`**: segmented control at top (Optimize | Plan), content swaps below. Match dashboard's hero-savings pattern.
- **AnalyticsTabsView** (Compare | Models | Yield | Skills): segmented, denser tables. (No Entire tab — its UI and backend are commented out.)

---

## 10. Surface 3 — Widgets (macOS)

### What changed

Four widgets in `VibeDeckWidget/Widgets/`:
- `SummaryWidget.swift` — today's tokens & cost
- `TopModelsWidget.swift` — top 3 models by spend
- `UsageLimitsWidget.swift` — provider limit bars
- `HeatmapWidget.swift` — 7-day activity grid

All four share `WidgetTheme.swift` and `SharedWidgetViews.swift`. The revamp is about **shared rhythm** — they should feel like four panels of one instrument, not four separate apps.

### Widget chrome

- **Background:** `WidgetTheme.widgetBackground` (the linear gradient already defined). Keep it. Do not add a second background variant.
- **Corner radius:** Apple-controlled. Do not override.
- **Padding:** 12pt all sides for Small, 14pt for Medium, 16pt for Large.
- **Title row:** widget name uppercase `.caption2.weight(.semibold)`, `Color.secondary`. Right-aligned: relative timestamp via `WidgetFormat.relativeUpdated`.
- **Hero number:** `.title.weight(.semibold)` rounded design. Below it: secondary metric in `.caption.weight(.medium)`, `Color.secondary`.

### Widget-specific rules

**SummaryWidget**
- Small: hero token count, delta arrow, "today" label.
- Medium: hero + cost + sparkline (last 7 days, single indigo line, no fill).
- Large: hero + cost + sparkline + top 3 providers list with logo dot + provider name + share %.

**TopModelsWidget**
- Small: top 1 model name + cost.
- Medium: top 3 in a list. Use `WidgetTheme.modelDot` for the leading dot (indigo scale, no other colors).
- Large: top 5 + tiny bar chart per model showing relative share.

**UsageLimitsWidget**
- Small: one provider, biggest used %. Bar uses `WidgetTheme.limitBarColor` (green/amber/red — this is the one place semantic color overrides indigo).
- Medium: 3 providers as horizontal bars with reset countdown via `WidgetFormat.relativeReset`.
- Large: 5-6 providers + projected reset times.

**HeatmapWidget**
- Small: 7×4 grid (last 4 weeks). Use `WidgetTheme.heatmapLevels` (5 indigo steps).
- Medium: 7×13 grid (last 13 weeks, quarter-year).
- Large: full year heatmap with month labels.

### Cross-widget rules

- **Numbers always tabular.** `WidgetFormat.compact` handles thousands/millions/billions. Never wrap or truncate a hero number.
- **No motion in widgets.** WidgetKit redraws on schedule; live animation isn't supported and would burn battery.
- **No login state.** Widgets read from `StaticSnapshotProvider` which reads the local snapshot file. Never show "Sign in" — show "Open VibeDeck" as a deep link if data is stale.
- **Source colors stay green for "ok," amber for "warning," red for "over."** This is the only exception to the indigo lock — limit bars MUST use semantic colors. Already correct in `WidgetTheme.limitBarColor`.

---

## 10.5. Builder-grade components — progress bars, charts, signal elements

VibeDeck is for engineers running multiple AI tools — Linear, Vercel, Resend, Raycast, Datadog energy. **Cool but never cosplay.** No neon glow, no scanlines, no fake CRT chrome. The "techie" feel comes from precision, density, monospace counters where they count, and components that show their work.

This section is one source of truth for **progress bars**, **charts**, and **signal elements** across all three surfaces. Each component has the same visual logic on web, macOS, and widgets — only the implementation differs.

### 10.5.1 Progress bars

Six variants. Use the one that matches the data, not the prettiest one.

**A. Linear bar (default)**
```
███████████░░░░░░░░░  68%  ·  136K / 200K
```
- Track: `var(--oai-gray-200)` (light) / `var(--oai-gray-800)` (dark), 6px tall, `rounded-full`
- Fill: `var(--brand-600)` (light) / `var(--brand-400)` (dark), `rounded-full`
- Label: right-aligned, `text-label` (11px), tabular-nums. Format: `{percent}% · {used} / {total}`
- Animation on mount: width grows from 0 to target in 320ms `cubic-bezier(0.32, 0.72, 0, 1)`. Never on update.
- Use for: provider limits (when not at warning thresholds), generic capacity bars.

**B. Limit bar (semantic-colored)**
- Same geometry as Linear.
- Fill color from `WidgetTheme.limitBarColor`: green `#33B866` <70%, amber `#D9A633` 70-90%, red `#E64D4D` ≥90%.
- Right label adds reset countdown: `68% · resets in 3h 12m`.
- Use for: any quota that can be exceeded (provider rate limits, monthly subscription quota).

**C. Segmented bar (stacked composition)**
```
█████████ █████ ████ ██  Claude 45% · Codex 22% · Cursor 18% · Other 15%
```
- 8px tall, `rounded-md`, 1px gap between segments (visible gap, don't fake it with border).
- Each segment uses provider color from `SOURCE_COLORS` / `WidgetTheme.sourceColor`.
- Segments < 4% collapse into a final "Other" segment, `var(--oai-gray-400)`.
- Legend below or to the right, dot + label + %. Use `tabular-nums`.
- Use for: provider mix, model mix, repo mix.

**D. Stepped / discrete bar (for counts)**
```
■ ■ ■ ■ ■ ■ □ □ □ □   6 / 10 sessions today
```
- 10 cells, 8×8px each, 2px gap.
- Filled: `var(--brand-500)`. Empty: `var(--oai-gray-200)`.
- Above 10: collapse to Linear bar.
- Use for: small countable things (today's checkpoint count, attribution coverage out of N sessions).

**E. Dual-track bar (used vs budgeted)**
```
┌────────────────────────────┐
│ ████████████░░░░░░░░░░░░░░░│ $84 actual
│ ────────────●──────────────│ $120 budget
└────────────────────────────┘
```
- Top track 6px: actual spend, `var(--brand-500)` fill.
- Bottom track 2px: a single dot/marker at the budget position, `var(--oai-gray-500)`.
- If actual > budget, top fill turns `var(--oai-error)` past the dot.
- Use for: subscription efficiency, monthly burn vs budget on PlanPage.

**F. Indeterminate / "working" bar**
- 4px tall, full width, `var(--oai-gray-200)` track.
- Animated indigo block: 30% width, slides left-to-right in 1.2s loop, `ease-in-out`.
- `prefers-reduced-motion`: replace with a static 100% bar at `var(--brand-300)` opacity 0.6.
- Use for: sync in progress, optimize scan running, repo rebuild. Hide as soon as the operation completes.

**macOS implementation:** `ProgressView` with `.progressViewStyle(LinearProgressViewStyle(tint: Colors.brandPrimary))` for A. For B-E, build custom `Capsule()` views in `SharedComponents.swift`. Match the geometry exactly.

**Widget implementation:** Already correct in `WidgetTheme.limitBarColor`. Extend `SharedWidgetViews.swift` with `SegmentedBar`, `SteppedBar`, `DualTrackBar`. Use `Canvas` for performance — widgets re-render on every timeline entry.

### 10.5.2 Charts

VibeDeck ships six chart types. **Never invent a seventh** without updating this doc.

**A. Sparkline (the workhorse)**
- 1.5px stroke, `var(--brand-500)`, no fill.
- 7-day default range, 12 hours minimum span.
- Single hover dot: 4px filled circle, `var(--brand-700)`, with a 1px vertical guide to x-axis at `var(--oai-gray-300)`.
- No axes, no grid, no legend. Just the line and one hover dot.
- Below the line: optional micro-delta `▲ 12%` in `text-caption`, `var(--brand-600)` for up, `var(--oai-gray-500)` for down. Never red — going up isn't bad.
- Use in: SummaryWidget Medium/Large, dashboard hero cards, table rows.

**B. Area chart (only on PlanPage forecast)**
- Single indigo line, 1.5px, `var(--brand-500)`.
- Fill below: gradient `var(--brand-500)` at 0.18 alpha → transparent at bottom. **The only gradient surface outside the logo.**
- Dashed line continuation for forecast region (`stroke-dasharray: 4 4`), `var(--brand-400)`.
- Horizontal subscription tier lines: `var(--brand-200)` 1px, label at right margin in `text-label`.

**C. Stacked bar chart (provider/model breakdown over time)**
- Bars use the brand scale only when stacking same-category items (e.g., 5 model tiers from `--brand-300` lightest → `--brand-700` darkest).
- For provider stacking: use `SOURCE_COLORS`.
- Bar width: 60% of slot. Gap: 40%. `rounded-t-sm` only.
- Y-axis: 3 gridlines max, `var(--oai-gray-200)`, dashed.
- X-axis: labels every 7th tick on 30-day view, every tick on 7-day view.
- Tooltip on hover: card with date headline, then breakdown rows (dot + label + value), `tabular-nums` on values.

**D. Horizontal bar (for ranked lists — top providers, top models, top repos)**
- Label left (truncated with `…` at fixed width), bar middle, value right.
- Bar fills the available track width to its proportion of the max value.
- Track `var(--oai-gray-100)`, fill `var(--brand-500)`, height 4px, centered in row.
- Row height 32px (web), 24pt (macOS), 20pt (widget Large).
- The longest bar always reaches 100% of the track. Don't normalize to a hypothetical max.
- Use in: TopModelsView, OptimizePage opportunity ranking, dashboard top-3 cards.

**E. Heatmap (calendar)**
- Already specified in `WidgetTheme.heatmapLevels` — five steps: gray-tint, brand 0.25, 0.50, 0.75, 1.0.
- Cells: 10×10px (web), 12×12pt (macOS Large), 8×8pt (widget Medium), 4×4pt (widget Small).
- 2px gap between cells. `rounded-sm`.
- Day-of-week labels (`Mon / Wed / Fri`) on the left in `text-label`, `var(--oai-gray-500)`.
- Month labels on top, only at month boundaries.
- Hover/tap: tooltip with date + token count + cost. Selected cell: 1.5px ring `var(--brand-600)`.

**F. Ring / donut (use sparingly — only when one slice matters)**
- Outer radius 48px (web small), 64px (web medium), 80pt (macOS hero).
- Stroke width 8px. Background ring `var(--oai-gray-200)`.
- Filled arc: provider color or `var(--brand-500)`.
- Center label: hero number + 1-line caption below, both tabular-nums.
- Maximum 1 active ring per card. **Never stack multiple donuts side-by-side** (use horizontal bars instead).
- Use in: AttributionHealthCard (coverage %), OptimizePage cache-hit ring.

**Banned chart types:** pie charts with >3 slices, 3D anything, polar/radar charts, treemaps, sankey diagrams. If you think you need one of these, you need a table.

### 10.5.3 Signal elements (the "techie" details done right)

These are the small components that make the product feel engineered. Use sparingly — one or two per page maximum.

**A. Live tick indicator**
- An 8px pulsing dot (see Section 7) followed by a `text-caption` label: `● LIVE` or `● 3 ACTIVE`.
- Label always uppercase, `tracking-wide`, `font-medium`.
- Color: `var(--brand-500)` for "live"; `var(--oai-success)` for "healthy"; `var(--oai-warning)` for "degraded".
- Use in: LivePage header, menubar popover header, widget title rows when data is < 60s old.

**B. Status diode row**
- A horizontal row of 6×6px circles, one per provider, color = healthy/warning/danger from semantic palette.
- Hover (web) / tap (mac) reveals provider name and last-seen.
- Use in: dashboard top bar (compact health summary), macOS toolbar (right side).

**C. Monospace counter (the "ticking number")**
- For numbers that update live: tokens/sec, current spend.
- JetBrains Mono, `font-variant-numeric: tabular-nums slashed-zero`, `text-h2` or larger.
- **Number does not animate on change.** It snaps. Animating digits looks like a slot machine; engineers reading their own burn rate want truth, not theatre.
- A small `▲` or `▼` arrow next to it can fade in/out on direction change (180ms).
- Use in: LivePage hero, macOS DashboardView header.

**D. Signal bars (Wi-Fi style — for confidence/attribution strength)**
- 4 vertical bars, ascending height: 4px, 8px, 12px, 16px.
- Filled bars use `var(--brand-500)`. Unfilled use `var(--oai-gray-300)`.
- 1: low confidence, 2: medium, 3: high, 4: certain (rare).
- Replaces text "Low / Medium / High" in tight spaces. Pair with `aria-label` for accessibility.
- Use in: AttributionHealthCard, session list row, branch attribution.

**E. Command-output panel**
- Monospace block for command output, log lines, file paths.
- Background: `var(--oai-gray-50)` (light) / `var(--oai-gray-100)` (dark), `rounded-md`, `border-[var(--vd-border)]`.
- Font: `JetBrains Mono` `text-body-sm`. Line-height 1.55. No syntax highlighting unless it's actual code.
- Optional header strip: filename or command, `text-label` uppercase, copy button on right.
- Selectable text. **Always.** Engineers will copy from this.
- Use in: OptimizePage "run this command" suggestions, ExportPage CLI hints, SettingsPage advanced panels.

**F. Inline kbd**
- For keyboard shortcuts in copy: `<kbd>⌘</kbd> <kbd>K</kbd>`
- `bg-[var(--brand-50)] border border-[var(--brand-200)] text-[var(--brand-800)]`, `text-caption`, `rounded` 4px, padding `2px 6px`, font `JetBrains Mono`.
- Dark mode: `bg-[var(--vd-tint)] border-[var(--vd-border)] text-brand-300`.

**G. Hash / ID chip**
- For commit SHAs, session IDs, run IDs: `7a2f9c1`
- `JetBrains Mono` `text-caption`, `var(--oai-gray-600)`, `bg-[var(--oai-gray-100)]` (light) / `bg-[var(--oai-gray-200)]` (dark), `rounded` 4px, padding `2px 6px`.
- Click-to-copy with subtle 80ms scale-down feedback. Toast: "Copied 7a2f9c1".

**H. Trend chip (for stat cards)**
- `▲ 12% · 7d`  /  `▼ 4% · 24h`
- Up arrow `var(--oai-success)`, down arrow `var(--oai-gray-500)` (NOT red — "down" on cost is good, "down" on usage is neutral context).
- Trailing scope label (`7d`, `24h`, `mo`) in `var(--oai-gray-400)`.

**I. Provider chip**
- 16×16px logo circle (from `PROVIDER_LOGOS`) + provider name + optional cost.
- Mono logos (cursor, kimi, kiro) tint to `currentColor` so they pick up text color.
- Background: none for inline use. Card variant: `bg-[var(--vd-tint)] border-[var(--vd-border)] rounded-md px-2 py-1`.

**J. Status pill**
- For session/operation state: "Running", "Idle", "Failed", "Synced".
- Background `var(--oai-gray-100)`, text `var(--oai-gray-700)`, `text-caption`, `rounded-full`, padding `2px 8px`.
- Semantic variants swap to brand/success/warning/danger families.
- Always pair with status diode (Element B) for color-blind safety.

### 10.5.4 Placement rules — clean & professional

Cool components placed poorly look amateur. These rules keep density in check.

1. **One hero per page.** Either a hero number, a hero ring, or a hero chart — not all three. The hero anchors visual hierarchy.
2. **Signal elements live in the periphery.** Live tick indicators in headers. Status diodes in toolbars. Trend chips inside stat cards, not floating.
3. **Charts get their own card.** Don't stuff a sparkline next to a hero number AND a horizontal bar list AND a status row. One chart per card unless they're a small-multiples set.
4. **Small multiples come in 3s or 4s, never 5s.** A row of three sparklines feels intentional. A row of five feels like a dashboard exploded.
5. **Negative space is part of the design.** Cards should breathe. Internal padding minimum 16px on web cards (`p-4`), 12pt on macOS, 12pt on widget Medium/Large.
6. **Numbers go right, labels go left, charts go full-width.** This is true on tables, stat cards, and widget rows. Eyes scan left-to-right; the number is the answer, the label is the question.
7. **Monospace is a spice, not a base.** Use it for hashes, paths, code, commands, ticking counters. Never for body copy or chart axes.
8. **No more than two colors per chart unless it's a stack.** A line chart is one indigo. A bar chart is one indigo. A stacked chart can use the brand scale or provider scale, but never both at once.

---

## 10.6. Clawd — the pixel companion

Clawd is VibeDeck's pixel-art mascot. 39 hand-keyed states already shipped:
- **Idle:** living, doze, follow, look, yawn, collapse
- **Working:** building, carrying, conducting, confused, debugger, juggling, overheated, pushing, sweeping, thinking, typing, ultrathink, wizard
- **Mini:** alert, crabwalk, enter, enter-sleep, happy, idle, peek, sleep
- **React:** double, drag, left, right
- **Sleep:** collapse-sleep, sleeping, wake
- **Status:** disconnected, error, notification

Assets live in `dashboard/public/clawd/`. Web wrapper: `dashboard/src/ui/foundation/ClawdAnimated.jsx`. macOS native: `VibeDeckMac/VibeDeckMac/Views/ClawdCompanionView.swift`. **Keep them as the single source of truth — do not duplicate or re-key these animations.**

Clawd is the only place the product allows personality. The rest of the UI is calm, engineered, indigo. Clawd gets to be alive. That contrast is the whole point.

### Where Clawd lives

| Surface | Placement | Default state | Size |
|---------|-----------|--------------|------|
| **Dashboard home (`DashboardPage`)** | Top-right of the page header, next to the period picker | `idle-living` | 48px |
| **LivePage** | Inside `LiveWorkbenchOverview`, top-right corner of the first stat card | maps from live state (see table below) | 56px |
| **OptimizePage hero** | Left of the savings number | `working-wizard` when savings > 0; `idle-look` when nothing to optimize | 64px |
| **PlanPage hero** | Right of the forecast chart, peeking from edge | `working-thinking` | 64px |
| **Empty states (any page)** | Center of the empty card | varies by context (see below) | 80px |
| **Error / offline states** | Center of the error view | `status/error` or `status/disconnected` | 96px |
| **macOS DashboardView** | Top of `ClawdCompanionView` band (already wired) | maps from `viewModel` state | native |
| **Menubar popover** | Top-right of the popover header | `mini-idle` or `mini-happy` | 24pt |
| **Widgets** | **Never.** Widget binary budget is tight; static SVGs are too expensive to render at widget refresh cadence. Use the three-plane mark instead. |

### State mapping rules (consistent across web + macOS)

The companion's state derives from product state, not user action. Map it deterministically so the same situation always shows the same Clawd.

| Product state | Clawd state | Rationale |
|--------------|------------|-----------|
| Server reachable, no active sessions, < 10 min idle | `idle-living` | Breathing, alive |
| Server reachable, no active sessions, > 10 min idle | `idle-doze` → `idle-yawn` cycle | Getting sleepy |
| Server reachable, > 30 min idle | `sleep/sleeping` | Goes to sleep. Tap to wake. |
| 1 active session | `working-typing` | Visible work |
| 2-3 active sessions | `working-juggling` | Multi-tasking |
| 4+ active sessions | `working-overheated` | Honest about strain |
| Optimize scanner running | `working-thinking` | Computing |
| Repo rebuild running | `working-building` | Construction |
| Subscription analysis | `working-wizard` | Forecasting |
| Confused attribution / low confidence | `working-confused` | Honest signal |
| Sync just succeeded (< 3s ago) | `mini-happy` | Brief celebration |
| Sync failed | `status/error` | Visible problem |
| Server offline | `status/disconnected` | Clear state |
| New notification (e.g., approaching limit) | `status/notification` | Attention without alarm |
| User hovers Clawd | nudge to `react-left` / `react-right` / `react-double` | Lightweight responsiveness (already implemented in macOS) |
| Heavy compute > 5 minutes | `working-ultrathink` | Earned, not random |

**Implementation rule for web:** build a `useClawdState()` hook that subscribes to live session count, active operations, and last-sync state, then resolves to a Clawd state from the table above. Wire it into `ClawdAnimated`. Same logic as the macOS `ClawdCompanionView` — port the state machine, don't rebuild it.

### Placement rules (clean & professional)

1. **One Clawd per page at a time.** If the dashboard has Clawd in the header, the empty state inside a card does NOT also show Clawd. The companion is a focus point, not wallpaper.
2. **Never inside a chart or data card.** Clawd lives in headers, hero strips, empty states, and error states. Not inside `LiveOperationsPanel`, not inside a stat card with numbers, not inside a chart legend.
3. **Always against neutral background.** Glass card or page background, never on top of indigo tint. The pixel art is high-frequency; it needs breathing room.
4. **Padding around Clawd ≥ Clawd's size / 2.** A 48px Clawd gets ≥24px of margin on every side from text/chart content.
5. **No drop shadows on Clawd.** The pixel art is its own contrast.
6. **Respect `prefers-reduced-motion`.** When set, freeze to `static-base.svg` (or `idle-living` first frame). Already correct in `ClawdAnimated`.
7. **Tap/click behavior:**
   - Web: tapping Clawd triggers `react-double` for 600ms, returns to current state. No menu, no popover.
   - macOS: already wired in `ClawdCompanionView.handleTap()`.
8. **Speech bubble is optional, off by default on web.** The macOS app has quips (`bubbleView`). On the dashboard, do NOT ship quips initially — the dashboard already has more text than the macOS app. Add quips later only inside the empty states (one short message: "Run an AI tool to see something here").

### Quip copy rules (when used)

- Maximum 3 lines.
- Voice: dry, factual, never cute. "Nothing's running yet" not "Aww, looks lonely in here!"
- Never use Clawd to apologize for app problems. Error states use Clawd's expression, but the message is plain UI copy beside or below the bubble.
- No emojis in quips. The pixel face is the emotion.

### Don'ts

- ❌ Don't introduce new Clawd states without checking with the macOS app first — they must be drawn in the same pixel grid and shipped in both `dashboard/public/clawd/` and the macOS asset catalog.
- ❌ Don't put Clawd in the logo lockup. The wordmark + three-plane mark is the brand. Clawd is the personality.
- ❌ Don't show Clawd in marketing screenshots that emphasize professionalism (enterprise pitch, security review, compliance copy). Clawd is for the product, not the pitch deck.
- ❌ Don't auto-cycle through Clawd states for "engagement." Each state is earned by real product state.

---

## 11. Cross-surface coherence rules

These are the rules that make all three surfaces feel like one product.

1. **Same number formatting everywhere.** Tokens compact to `203.2M`, cost to `$12.40` (under $1000) or `$1,247` (above). Web mirrors `WidgetFormat`; if you change one, change all three.
2. **Same time formatting everywhere.** `just now`, `4m ago`, `2h ago`, `3d ago`. Implemented in `WidgetFormat.relativeUpdated` (Swift), `dashboard/src/lib/format-time.js` (web) — keep in sync.
3. **Same provider colors everywhere.** `WidgetTheme.sourceColor` (Swift) and `SOURCE_COLORS` (web) are the same map. When adding a new provider, add to both files in the same PR.
4. **Same hero metric definition everywhere.** "Today's tokens" = same SQL aggregation in all three surfaces. The macOS app and widget read the same `SyncResponse`; the web dashboard hits the same `/api/usage/today` endpoint. Do not introduce a fourth definition.
5. **Same empty states.** When there's no data: three-plane logo mark at 60% opacity, one-line headline, one-line subtitle, one action. Never show a chart with "0" — show empty state.
6. **Same offline copy.** "VibeDeck server is offline" (macOS app), "Can't reach the local server" (web), "Open VibeDeck" (widget). Three phrases for three contexts, one tone.

---

## 12. Accessibility

- **Contrast:** every text/background pair ≥ 4.5:1 (WCAG AA). Hero numbers can be 3:1 if ≥ 24px. The brand-500 (`#6366f1`) on white passes AA for large text only — use brand-700 (`#4f46a8`) for body text on white.
- **Focus rings:** 2px solid `--brand-400` with 2px offset on web. macOS uses system focus ring (don't override).
- **Reduced motion:** see Section 6. All `motion`-driven entrances must check `usePrefersReducedMotion`.
- **Color is never the only signal.** Status colors are paired with icons (check / warning triangle / x), labels ("Healthy" / "Approaching limit" / "Over"), or numbers (`87%`). A colorblind user reading the limit bars sees the number first, color second.
- **VoiceOver labels** on every widget number: "Today's tokens: 203.2 million, up 12 percent." Already implemented in `SummaryWidget` — extend to the other three.
- **Keyboard nav on web:** tab order matches visual order. Drawers trap focus. Esc closes drawers.

---

## 13. What to remove

Cleanup that should happen alongside the revamp:

- `@fontsource/geist-mono` from `dashboard/package.json` (loaded, never used; we use JetBrains Mono).
- Any remaining `bg-emerald-*` / `text-teal-*` Tailwind classes (the May rework left a few in test fixtures — sweep again).
- `--vd-live` and `--vd-branch` are now both indigo — confirm no component reads them expecting a different hue.
- `three` and `ogl` are in deps; if no 3D surfaces are live, drop them. Saves ~600KB.

---

## 14. Implementation order (suggested)

If you're picking this up incrementally, do it in this order — each step is shippable on its own:

1. **Lock the nav lanes.** Update `dashboard/src/components/Sidebar` (or equivalent) to group routes into Live / Intelligence / Analytics / Setup. Mirror in macOS `NavigationSplitView`. **Do not render an Entire route.**
2. **Apply the hero patterns** to `OptimizePage` and `PlanPage` (these are the two newest pages and the weakest visually right now).
3. **Sweep LivePage** with the two-column + drawer pattern.
4. **Audit widgets** against Section 10 — heatmap grid sizes, modelDot palette, title row rhythm.
5. **Wire `ServerOfflineView`** with the three-plane mark and dual actions.
6. **Cleanup pass** (Section 13).

Each step touches one surface area; nothing forces a big-bang revamp.

---

---

# Part II — Applied design specifications

Part I (sections 1-14) defines the system: tokens, components, principles. Part II is the playbook: every page, every menubar section, every widget size, drawn out so engineers know exactly what goes where. Nothing in Part II contradicts Part I — it applies it.

---

## 16. Reference visual language

The visual target is distilled from five references the user shared:

1. **Twisty (Income Tracker)** — lollipop charts, generous whitespace, status pills, one hero card dominates the page.
2. **Financial Dashboard (orange)** — mixed card geometries (circles, pills, rectangles), concentric circles for hierarchy, big rounded action buttons, mini stat cards next to chart cards.
3. **Stakent (dark)** — pure dark, single accent, sidebar with section labels + bottom promo, sparklines INSIDE stat cards, mini metric tabs (Momentum / General / Risk / Reward), big numbers with light tracking.
4. **Donezo (green)** — one accent-filled hero KPI + neutral siblings, striped/diagonal bar pattern for inactive data, half-gauge progress, dark gradient promo card in sidebar, list rows with logo + title + due date.
5. **Vision UI (navy)** — KPI row with colored icon chips, hero illustration card (jellyfish), half-gauge, area chart with gradient fill, alternating-height bar chart.

**What VibeDeck adopts:**

- One **accent-filled hero KPI card** per page (Donezo). On dashboard home: "Today's spend." On Live: "Active sessions." On Optimize: "Monthly savings available." Other KPI cards in the same row stay neutral.
- **Mixed card geometries** (Financial Dashboard). A page should not be 6 identical rectangles. Mix:
  - Wide rect for hero chart
  - Small rounded rect for KPI
  - Capsule (pill) for action buttons and toggles
  - Circular tile for single-icon controls (refresh, expand, settings)
  - Half-circle gauge for "% used / % done" metrics
- **Sparklines inside KPI cards** (Stakent). Every numeric KPI card includes a 7-day sparkline below or behind the number — no separate "trend" card.
- **Lollipop charts** (Twisty) for 7-day breakdowns. Dot + thin vertical line + tabbed pill label on the peak day. Used on Live and Plan.
- **Striped/diagonal fill** (Donezo) for forecast / projected / pending data. Solid fill = actual, diagonal stripes = forecast or skeleton. This is the single visual cue for "this is not yet real."
- **Half-gauge** (Donezo, Stakent, Vision UI) for any percentage that has a natural ceiling (cache hit rate, attribution coverage, provider limit %, project completion).
- **Sidebar bottom promo card** (Donezo, Stakent) — a dark gradient card with a single primary action. VibeDeck uses it for the macOS app download prompt on the web, and for the "Upgrade to Pro" CTA later.
- **List rows with logo + title + meta** (Donezo's project list, Twisty's recent projects). Used for session list, recent repos, top models, top providers.
- **One hero illustration per surface** (Vision UI's jellyfish). VibeDeck's hero illustration is **Clawd**. The three-plane logo mark is the secondary illustration (used in empty states).

**What VibeDeck rejects:**

- Emoji in UI chrome (Financial's 👋, even though it's cute — engineers reading their own burn don't need a wave). Clawd carries personality.
- Faces / stock avatars in stat cards (Donezo team collaboration). VibeDeck shows provider logos and Clawd, never people.
- Voice input chip (Financial's mic button). We're not adding chat.
- Mobile app download CTA in sidebar (Donezo). Replace with macOS app download CTA on web.
- Heavy gradients on chrome (Vision UI's purple/blue glow on cards). Our only gradient surfaces are the logo container, the OptimizePage savings hero, and area chart fills.

---

## 17. Card hierarchy — fight the "cards and cards" pattern

The current dashboard is wall-to-wall cards because every component shipped independently. The revamp imposes a hierarchy. **Not every panel is a card.**

### Card tiers (use deliberately)

**Tier 0 — page background.** Not a card. The page itself has padding (`32px` desktop, `16px` narrow), background `var(--oai-white)` (light) / `var(--oai-black)` (dark). No border, no shadow.

**Tier 1 — section.** Not a card. A section has a heading (`text-h3` or `text-label` uppercase), optional action on the right, then content. No border, no background, no shadow. Use for: grouping list rows, grouping chips, grouping form fields.

```
Top Providers                                          See all →
─────────────────────────────────────────────────────────────
  ⬤ Claude       45%   $24.18  ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆░░░░░
  ⬤ Codex        22%   $11.42  ▆▆▆▆▆▆▆▆▆▆▆░░░░░░░░░░░░░░░░░
  ⬤ Cursor       18%   $ 9.31  ▆▆▆▆▆▆▆▆▆░░░░░░░░░░░░░░░░░░░
```

**Tier 2 — card.** Glass background, 1px border, 12px radius, 16-20px padding. Used for: a single self-contained KPI, a chart, a callout. **A card has exactly one purpose.** If the contents need a sub-title and a sub-section, it's probably two cards.

**Tier 3 — hero card.** Accent-filled (`var(--brand-600)` background, white text on light / `var(--brand-500)` background on dark) OR oversized neutral card with `text-hero` number. One per page. Optional inner sparkline. Optional Clawd peeking from corner.

**Tier 4 — sidecar.** A small (typically `120-180px` wide) card pinned to the side of a larger card. Holds a single metric or control that augments the main card. Visually attached (shared border, or 8px gap with matching radius). Used in: OptimizePage (savings hero + 3 sidecars for cache / model-swap / subscription), Stakent's pattern (Stake AVAX card + Investment Period sidecar).

### Anti-patterns to remove

- ❌ Three cards in a row, each with their own title bar, when they're really one chart's three dimensions → collapse into one card with a tab strip or segmented control.
- ❌ A card whose only content is a single number with a label → that's a Tier 1 inline element, not a card.
- ❌ A card containing another card → never. Use sections or sidecars.
- ❌ A card with a title, a subtitle, a description paragraph, a chart, a table, and a footer → that's a page, not a card. Break it up.
- ❌ A row of 6+ KPI cards → no human reads 6 KPIs in parallel. Pick 3-4. The rest become Tier 1 list rows or move to a deeper page.

### Page-level density target

A page should have **3 to 7 distinct surfaces**, not 12. The current `LivePage` has ~14 cards visible at once — that's the pattern we're killing. Target densities:

| Page | Surfaces visible without scroll | Hero | Tier 2 cards | Sections |
|------|--------------------------------|------|--------------|----------|
| DashboardPage | 5 | 1 (today's spend) | 3 (active sessions, top providers, attribution health) | 1 (recent activity timeline) |
| LivePage | 4 | 1 (active sessions) | 2 (live ops table, provider limits) | 1 (session list) |
| OptimizePage | 4 | 1 (savings) + 3 sidecars | 2 (opportunity list, cache analysis) | 0 |
| PlanPage | 3 | 1 (forecast chart) | 2 (subscription efficiency, breakeven) | 0 |

---

## 18. Layered surfaces — drawers, sheets, popovers, modals

Four overlay patterns. Each has one job. Do not mix them.

### 18.1 Side drawer

Slides in from the right. **Solid background** (rule from `project_palette_rework.md` memory — never glass on drawers). Used when:
- The content is a deeper view of a row the user clicked (session details, checkpoint inspector, branch override).
- The user is expected to act on it (read values, change a setting, run a command) and return to the underlying page.

**Spec:**
- Width: `480px` standard, `640px` for tables/diffs, `full` (mobile, < 640px viewport).
- Background: `bg-white` (light) / `bg-[#0f0f14]` (dark). Solid. No glass.
- Left border (visible against page): `1px solid var(--vd-border)`.
- Shadow: `var(--vd-shadow)` strong, plus `0 0 0 100vw rgba(0, 0, 0, 0.32)` scrim over page.
- Header: 56px tall. Title (`text-h4`), close button (`X` icon, 32×32 tap target) right-aligned. Bottom border `1px var(--oai-gray-200)`.
- Content: scrollable, `24px` horizontal padding, `16px` top padding.
- Footer (optional): 64px tall, sticky bottom, `1px` top border. Primary action right, secondary left.
- Slide-in animation: 180ms `ease-out` translateX from `100%` to `0%`. Scrim fades 180ms.
- Esc closes. Click-outside closes. Focus traps inside until close.

**macOS equivalent:** `.sheet` with `.detents([.large])` or an inspector panel via `NavigationSplitView`'s detail column.

**Where used:**
- LivePage: clicking a session row opens `LiveWorkstreamDrawer` (already exists — verify it follows this spec).
- BranchesPage: clicking a branch opens override panel (`BranchOverridePanel`).
- Settings rows that need more than a toggle (e.g., "Manage providers") open in drawers, not new pages.

### 18.2 Bottom sheet (mobile/narrow only)

When viewport < 640px, side drawers become bottom sheets sliding up from the bottom. Same content, same chrome rules. Drag handle at top (4px tall, 32px wide, `var(--oai-gray-300)`, centered).

### 18.3 Popover

Anchored to a trigger element. Used when:
- The content is small (< 320px wide, < 400px tall).
- The user picks one thing and the popover closes (period picker, sort menu, provider filter).
- It does NOT need its own URL.

**Spec:**
- Background: `var(--vd-popover-bg)` (solid, no glass).
- Border: `1px var(--vd-border)`.
- Radius: `12px`.
- Shadow: `var(--vd-shadow)`.
- Padding: `8px` (for menus with list rows), `16px` (for richer content).
- Min width: `200px`. Max width: `320px`.
- Open animation: 120ms scale `0.96 → 1.0` + opacity `0 → 1`, origin near the trigger.
- Built on `@base-ui/react` Popover primitive (already in deps).

**Menu row inside popover:** 32px tall, 8px horizontal padding, hover `bg-[var(--vd-tint)]`, selected has leading checkmark `var(--brand-500)`. Keyboard `↑↓` navigates, Enter selects, Esc closes.

### 18.4 Modal / dialog

Centered, blocks the page. Used **rarely** — only when:
- The user must make a decision before continuing (destructive action, breaking change).
- The content is too large for a popover but doesn't fit the "return to context" feel of a drawer (e.g., onboarding step).

**Spec:**
- Width: `480px` (confirm), `640px` (form), `800px` (rich).
- Centered, vertical `min(60vh, 720px)` cap with internal scroll.
- Scrim: `rgba(0, 0, 0, 0.48)` blurred `6px`.
- Same header/footer structure as drawer.
- Esc closes. Click-outside closes only if non-destructive.
- Focus traps. Restore focus to trigger on close.

**Where used:**
- `LimitsSettingsView` (macOS) — already a sheet, keep it.
- Web: provider deletion confirmation, "Reset all data" in Settings.

### 18.5 Decision matrix

| Need | Use |
|------|-----|
| Pick one from a short list | Popover |
| Pick a date | Popover with `react-day-picker` |
| Detail view of a row | Drawer |
| Multi-step form | Drawer |
| Confirm destructive | Modal |
| Onboarding | Modal (one-off) |
| "Are you sure?" | Modal |
| Search across the app | **Command palette** (see 18.6) |

### 18.6 Command palette

`⌘K` opens a centered modal-like surface at the top of the page. Used for: search, quick navigation, "run this command" actions.

**Spec:**
- Width: `640px`. Height: auto, `max-h: 480px`.
- Background: `var(--vd-popover-bg)`, `16px` radius, strong shadow.
- Top: search input, large (`text-h4`), no border, placeholder "Search sessions, commands, providers…"
- Below: grouped results — `RECENT`, `SESSIONS`, `COMMANDS`, `PROVIDERS`, each as Tier 1 sections (caps label + items).
- Keyboard: `⌘K` toggles, `↑↓` navigates, `Enter` runs, `Esc` closes.
- Recent commands persist in localStorage.

On macOS, the same primitive uses `NSWindow` styled to match.

---

## 19. Loaders & skeletons

Loading is part of the UI, not an absence of it. Five patterns, picked by duration.

### 19.1 No loader (0-100ms)

If a fetch completes in < 100ms, show no loader at all. Render the result. Adding a 200ms spinner that flashes for 50ms looks janky.

### 19.2 Skeleton (100ms-2s, known structure)

The card / row / chart renders with grey placeholder shapes matching the real layout.

**Skeleton geometry:**
- Background: `var(--oai-gray-100)` (light) / `var(--oai-gray-800)` (dark).
- Radius: matches the shape it's replacing (4px for text, 12px for cards).
- Animation: subtle shimmer left-to-right, 1.6s cycle. Linear gradient sweep at `5%` opacity over the base color. Disabled by `prefers-reduced-motion`.
- Never animate dimensions — the skeleton must match the final layout pixel-for-pixel so there's no shift on load.

**Where used:** every stat card, every chart, every list row.

```
┌──────────────────────────────┐
│ ▓▓▓▓▓▓▓                       │  ← label skeleton (90px × 11px)
│                               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓                  │  ← number skeleton (120px × 32px)
│                               │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓     │  ← sparkline skeleton (full width × 24px)
└──────────────────────────────┘
```

### 19.3 Indeterminate bar (2s-10s, work in progress)

Top of the affected card or page. 4px tall, indigo block sliding L→R. Pattern F from Section 10.5.1.

**Where used:** sync in progress on the dashboard header, optimize scan, repo rebuild.

### 19.4 Progress bar (known % completion)

When we know the percentage (e.g., importing 100 sessions, on 47), use a determinate Linear bar (Pattern A from 10.5.1) with the % label.

### 19.5 Long-running task panel

For operations > 10s (full repo rebuild, large export), show a dedicated panel — not a spinner — with:
- Operation name and ETA estimate.
- Real-time line count or item count.
- Cancel button.
- Clawd in `working-overheated` or `working-building` state.
- When done: Clawd → `mini-happy`, panel collapses to a success toast after 4s.

**Where used:** OptimizePage scan-running state, ExportPage big exports, repo discovery on first run.

### 19.6 What NOT to use

- ❌ Centered spinning circle on a blank screen. Show skeleton instead.
- ❌ Modal spinner blocking the UI. Inline always.
- ❌ Multiple skeleton variants on the same card (skeleton text + spinner). Pick one.
- ❌ Skeletons longer than 4s without falling back to "Still loading…" copy. If it's slow, say so.

---

## 20. Light / Dark / System mode — unified handling

Three modes. **System is the default.** Users can override.

### 20.1 Mode source of truth

- **Web:** CSS `prefers-color-scheme` + an explicit user override stored in `localStorage.vd-theme` (`"light"` | `"dark"` | `"system"`). The override wins. `<html>` gets class `light` or `dark` set by a 0-flash inline script in `index.html`. Default = `"system"`.
- **macOS app:** SwiftUI `@Environment(\.colorScheme)` follows system by default. User override stored in `UserDefaults.standard["theme"]`. Apply via `.preferredColorScheme(.light | .dark | nil)` on the root view.
- **Widgets:** **system only.** Widgets cannot be overridden by app preference (macOS sandboxes them). `@Environment(\.colorScheme)` always wins.

### 20.2 Theme switcher placement

- **Web:** SettingsPage → Appearance section. Three-segment control: `Light · Dark · System`. The same control also lives in the user menu in the top-right header.
- **macOS:** Settings window → Appearance tab → same three-segment control. Also in the `View` menu of the menubar (`⌘⇧L` cycles).
- **Widgets:** no switcher (system follows OS).

### 20.3 Token behavior (already correct in `styles.css`)

- `:root` defines light tokens.
- `:root.dark` overrides with dark tokens.
- All component code reads `var(--token)`, never hex.
- Same rule on macOS: `Colors.swift` and `WidgetTheme.swift` provide per-scheme accessors.

### 20.4 What changes between modes (the discipline)

| Property | Light | Dark | Why |
|----------|-------|------|-----|
| Background | `#fafafa` | `#0a0a0a` | Not pure white / pure black. Pure white burns at night, pure black crushes shadows. |
| Card | `rgba(250, 250, 255, 0.70)` | `rgba(20, 20, 28, 0.75)` | Glass with violet undertone in both modes. |
| Border | `rgba(0, 0, 0, 0.06)` | `rgba(255, 255, 255, 0.08)` | Hairline, never structural. |
| Accent | `--brand-600` `#5b5fc7` | `--brand-400` `#818cf8` | Lighter accent on dark because dark backgrounds eat saturation. |
| Text primary | `#0a0a0a` | `#fafafa` | Inverse of background, not pure. |
| Text secondary | `oklch(55% 0.014 264)` | `oklch(75% 0.003 264)` | OKLCH scale, indigo-tinted. |
| Chart fill | Solid color | Same color, can use `0.15` alpha tint for region fills | Dark mode tolerates higher alpha on fills. |
| Shadow | `rgba(49, 46, 106, 0.07)` 14px blur | `rgba(0, 0, 0, 0.22)` 16px blur | Dark mode shadows are darker, not lighter. |
| Status colors | `#22c55e` / `#f59e0b` / `#ef4444` | `#4ade80` / `#fbbf24` / `#f87171` | Brighter on dark for legibility. |

### 20.5 What does NOT change between modes

- Layout: same grid, same spacing, same component dimensions.
- Typography: same fonts, same scale.
- Iconography: SVGs use `currentColor` for stroke/fill so they invert with text.
- Brand logo: the gradient container stays `#1e1b4b → #2a2566` in both modes (it's part of the mark). Light-mode pages get the wordmark text in `--brand-950`; dark mode in `var(--oai-gray-100)`.
- Clawd: same SVG states in both modes. The pixel art has built-in contrast.

### 20.6 The "no cheap" test

When designing in dark mode, ask:
- Is the contrast meeting AA on every text/bg pair? (4.5:1 body, 3:1 large.)
- Are saturated brand colors raised one step on the scale (`brand-500` → `brand-400`) to avoid muddiness?
- Are shadows actually visible? Dark shadows on dark backgrounds disappear; use them sparingly and increase opacity.
- Does anything look like a generic Bootstrap dark theme? If yes, rework.

When designing in light mode:
- Pure white backgrounds (`#ffffff`) are forbidden as page bg. Always `#fafafa` or a 1% indigo tint.
- Black text (`#000000`) is forbidden. Always `#0a0a0a`.
- No drop shadow on cards by default. Hairline border only.

---

## 21. Per-page composition specs — Dashboard (web)

Every page below has a defined composition. Engineers building these pages should match this layout. Visual tweaks within the constraints are fine; structural changes need design approval.

### 21.1 DashboardPage (`/`) — the landing surface

**Purpose:** answer "what's going on right now?" in one glance.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Welcome back, Vasu                                          [Week ▾]  ⚙   │  ← Page header (Tier 0 - inline, no card)
│  Tuesday, 27 May 2026                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────┐  ┌─────────────────────────────┐    │
│  │ TODAY'S SPEND                  ↗   │  │ ACTIVE SESSIONS            │    │  ← Tier 3 hero + Tier 2 sibling
│  │                                    │  │                             │    │
│  │  $12.40                            │  │  3                          │    │
│  │  ▆▁▂▃▅▇▆▅                          │  │  ⬤ ⬤ ⬤                      │    │
│  │  ▲ 14% vs yesterday                │  │  Claude · Codex · Cursor    │    │
│  └────────────────────────────────────┘  └─────────────────────────────┘    │
│  ↑ Accent-filled, brand-600 bg            ↑ Neutral card                     │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │  PROVIDER BREAKDOWN — Today                       [bar | list]      │    │  ← Tier 2 - chart card
│  │                                                                     │    │
│  │  ████████████████████████████████████████████████████████████████   │    │  ← Segmented bar (Pattern C)
│  │  ⬤ Claude 45%  ⬤ Codex 22%  ⬤ Cursor 18%  ⬤ Gemini 9%  ⬤ Other 6%  │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────────┐  ┌────────────────────────────────────┐    │
│  │ ATTRIBUTION HEALTH         │  │ NEEDS ATTENTION                    │    │  ← Two Tier 2 cards
│  │                            │  │                                    │    │
│  │   ⌒ ⌒ 87%                  │  │ ⚠ Claude approaching limit         │    │
│  │  half-gauge                │  │   2.3M / 2.5M tokens · resets 6h   │    │
│  │  142 of 163 sessions       │  │ [Manage provider →]                │    │
│  └────────────────────────────┘  └────────────────────────────────────┘    │
│                                                                              │
│  RECENT ACTIVITY                                            See all  →      │  ← Tier 1 section header
│  ─────────────────────────────────────────────────────────────────────     │
│   14:32  ⬤ Claude   workflow.ts        12,340 in · 4,210 out      $0.42    │  ← List rows, no card
│   14:18  ⬤ Codex    api/users.ts        8,120 in · 1,830 out      $0.18    │
│   13:55  ⬤ Cursor   README.md           1,200 in · 380 out        $0.03    │
│   13:40  ⬤ Claude   styles.css          5,400 in · 2,100 out      $0.21    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

[Clawd lives top-right of page header, idle-living, 48px]
```

**Composition rules:**
- 5 distinct surfaces (1 hero + 4 supporting). No more.
- Hero card uses `bg-[var(--brand-600)] text-white` (light) / `bg-[var(--brand-500)]` (dark). Sparkline below the number uses `rgba(255, 255, 255, 0.4)` stroke.
- "Provider Breakdown" card has a small `bar | list` segmented toggle top-right. Default `bar`. Saved in localStorage.
- "Attribution Health" uses Pattern F half-gauge (Section 10.5.2). Center label `text-h2`.
- "Needs Attention" is conditional. If nothing is wrong, replace with "Cache opportunity" or hide and let "Attribution Health" span full width.
- Recent Activity is Tier 1 (no card around the list). 5 rows max. Each row 40px tall.

### 21.2 LivePage (`/live`) — the now lane

**Purpose:** see and act on what's running this minute.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Live                                              ● 3 ACTIVE   [Now ▾]  ⚙ │  ← Live tick indicator in header
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────┬────────────────┬────────────────┬─────────────┐│
│  │ ACTIVE SESSIONS    [3] │ TOKENS / SEC   │ TODAY'S COST   │ ATTRIBUTION ││  ← 4 KPI strip (1 hero + 3 neutral)
│  │  brand-filled          │                │                │             ││
│  │                        │                │                │     ⌒⌒      ││  ← Last cell is half-gauge
│  │  3 of 12 today         │  1,247         │  $12.40        │     87%     ││
│  │  ▆▆▆▆▆▆▆▆░░░░          │  monospace     │  ▲ 14%         │             ││
│  └────────────────────────┴────────────────┴────────────────┴─────────────┘│
│                                                                              │
│  ┌──────────────────────────────────────────────┐  ┌────────────────────┐  │
│  │ SESSIONS                              ⌕ ⌗ ⛅ │  │ PROVIDER LIMITS    │  │
│  │ ──────────────────────────────────────────── │  │ ──────────────────  │  │
│  │  ● Claude   workflow.ts   ▆▆▆▆░░░  $0.42 ↗  │  │  Claude    ▆▆▆▆▇░░ │  │  ← Limit bars
│  │  ● Codex    api.ts        ▆▆░░░░░  $0.18 ↗  │  │  92% · 14m to reset │  │
│  │  ● Cursor   README.md     ▆░░░░░░  $0.03 ↗  │  │                     │  │
│  │  ○ Claude   (15m ago)     —        $0.21    │  │  Codex     ▆▆░░░░░░ │  │
│  │  ○ Codex    (32m ago)     —        $0.14    │  │  28% · 4h to reset  │  │
│  │  ○ Gemini   (1h ago)      —        $0.09    │  │                     │  │
│  │                                              │  │  Cursor    ▆▆▆▆▆░░ │  │
│  │  [Show 47 more from today]                  │  │  68% · 6h to reset  │  │
│  └──────────────────────────────────────────────┘  └────────────────────┘  │
│                                                                              │
│  OPERATIONS                                                                 │  ← Tier 1 section
│  ─────────────────────────────────────────────────────────────────────     │
│   Time     Provider   Project          Branch       Tokens     Cost   Conf │
│   14:32    Claude     vibedeck         release/1.0  12.3K     $0.42  ▍▍▍▍ │
│   14:18    Codex      dashboard        main          8.1K     $0.18  ▍▍▍░ │
│   ...                                                                       │
└─────────────────────────────────────────────────────────────────────────────┘

[Clawd top-right of KPI strip, working-typing → working-juggling depending on active count]
```

**Composition rules:**
- KPI strip is 4 equal cells, leftmost is the hero (accent-filled). Mixed contents — last cell is a half-gauge, others are number+sparkline or number+bar.
- Sessions list is a card with sticky header (filter / sort / live toggle). Rows include a tiny progress bar showing cumulative spend for that session relative to other sessions today.
- Clicking a session row opens `LiveWorkstreamDrawer` (480px side drawer).
- Provider Limits card is narrower (320-360px). Each limit row: provider name + bar + percentage + countdown.
- Operations table is Tier 1 (no card around it). Sortable headers. Virtualized if > 200 rows. Right-most column is signal bars (confidence).

### 21.3 OptimizePage (`/optimize`) — the savings sell

**Purpose:** show the user what they could save, ranked by impact.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Optimize                                          [Last 30 days ▾]   ⚙    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────┐  ┌────────────────┐            │
│  │  YOU CAN SAVE                          │  │ CACHE HIT      │            │  ← Hero + 3 sidecars
│  │                                        │  │   ⌒ ⌒ 34%      │            │
│  │   $84.20 / mo                          │  │   target 60%   │            │
│  │   ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆░░░          │  └────────────────┘            │
│  │                                        │  ┌────────────────┐            │
│  │  $52.10 cache  ·  $24.40 swap         │  │ MODEL SWAP     │            │
│  │  $7.70 subscription                    │  │   12 sessions  │            │
│  │                                        │  │   $24.40 / mo  │            │
│  │  Hero card, brand-700 bg, white text  │  └────────────────┘            │
│  │  Clawd: working-wizard, peeking from   │  ┌────────────────┐            │
│  │  bottom-right corner of hero          │  │ SUBSCRIPTION   │            │
│  └────────────────────────────────────────┘  │   PAYG wins    │            │
│                                              │   $7.70 / mo   │            │
│                                              └────────────────┘            │
│                                                                              │
│  OPPORTUNITIES                                  Sort: [Impact ▾]            │
│  ─────────────────────────────────────────────────────────────────────     │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ ⚡ Enable prompt caching on Claude                       $34.10/mo  │    │  ← Opportunity card
│  │ ─── 187 sessions hit the same system prompt across 4 repos          │    │  ← brand-left-border-4
│  │                                                                     │    │
│  │ [How to enable →]   [See affected sessions]                         │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 🔁 Swap claude-opus-4-7 → claude-sonnet-4-6 on 12 sessions  $24.40 │    │
│  │ ─── These are all "simple lookup" sessions where Opus is overkill   │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│  ...                                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Composition rules:**
- Hero is `60%` width, sidecars stack at `40%` width on the right. On narrow viewports, sidecars wrap below.
- Hero `text-hero` (48px) for the dollar number, Outfit, font-weight 600. Sub-breakdown in `text-body`, opacity `0.85`.
- Each opportunity card has a left border `4px solid var(--brand-500)` (or amber/red if the recommendation is urgent), `padding-left: 20px`. Action buttons inline at bottom-right.
- Empty state (nothing to optimize): Clawd `idle-look`, message "Everything's running tight already." Show current cache hit + model mix as proof.

### 21.4 PlanPage (`/plan`) — the forecast

**Purpose:** project monthly burn and recommend subscription vs PAYG.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Plan                                              [60-day forecast ▾]  ⚙  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ MONTHLY FORECAST                                                    │    │  ← Wide chart card
│  │                                                                     │    │
│  │     $200 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Pro tier              │    │
│  │     $100 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Hobby tier            │    │
│  │     $50  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ Free tier             │    │
│  │                                                                     │    │
│  │      ╱╲       ╱╲    ╱╲                                              │    │  ← Area chart, indigo gradient fill
│  │     ╱  ╲_____╱  ╲__╱  ╲___                                          │    │
│  │    ╱                       ╲ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄ ┄                      │    │  ← Dashed = forecast
│  │   ┴────┴────┴────┴────┴────┴────┴────┴────┴───                     │    │
│  │  May 1                      May 27 (today)        Jul 27           │    │
│  └────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────┐  ┌──────────────────────────┐     │
│  │ CURRENT SUBSCRIPTION (Claude Pro)   │  │ BREAKEVEN ANALYSIS       │     │
│  │  $20 / mo  ·  ▆▆▆▆▆▆▆▆▇░░ 78% used  │  │                          │     │
│  │  Effective rate: $0.014 / 1K tokens │  │  PAYG would cost: $34.20│     │
│  │                                     │  │  Pro covers it:    $20.00│     │
│  │  vs. PAYG equivalent: $34.20/mo     │  │                          │     │
│  │  ✓ Pro saves you $14.20/mo          │  │  Breakeven: 1.4M tokens  │     │
│  └─────────────────────────────────────┘  └──────────────────────────┘     │
│                                                                              │
│  PROVIDER PLANS                                                             │  ← Tier 1 section
│  ─────────────────────────────────────────────────────────────────────     │
│   Provider   Current      Burn rate     Recommendation                     │
│   Claude     Pro $20      $34.20/mo     ✓ Stay on Pro                     │
│   Codex      PAYG         $12.40/mo     ✓ Stay on PAYG                    │
│   Cursor     Pro $20      $8.10/mo      ⚠ Downgrade to Hobby ($4)         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Composition rules:**
- Forecast chart is the hero. Wide single card. Y-axis labels are inline with horizontal subscription tier lines (Pattern B).
- Two cards below: current subscription analysis (left), breakeven calc (right). Both `50%` width on desktop, stacked on mobile.
- Provider Plans is Tier 1 table at bottom. Includes a recommendation column with semantic icon + short text.

### 21.5 ComparePage, ModelsPage, YieldPage, SkillsPage (analytics surfaces)

All four follow the same pattern: header with period picker → top KPI strip (3-4 cards) → primary chart card → comparison table (Tier 1 or Tier 2 depending on density).

**ModelsPage** specifics: horizontal bar chart (Pattern D) showing top-15 models by total spend, with provider color dots. Click model row → drawer with model details (token cost, hit count, last used).

**YieldPage** specifics: stacked bar chart of yield (cache hits per session) over time. Two-mode toggle: absolute (tokens saved) vs ratio (cache hit %).

**SkillsPage** specifics: list of detected Claude Code / Codex / etc. skills, sorted by usage. Each row: skill name, count of invocations, cost attributed, link to skill source.

**ComparePage** specifics: pick two periods (this week vs last week, or arbitrary ranges), show side-by-side delta cards.

### 21.6 BranchesPage (`/branches`)

**Purpose:** see attribution by branch, override attribution where the system got it wrong.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Branches                                                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────────────────────────┐ │
│ │ BRANCH ATTRIBUTION                                       Filter ⌕      │ │
│ │ ──────────────────────────────────────────────────────────────────── │ │
│ │  release/1.0.4   ▍▍▍▍ high   72 sessions   $42.10   →                 │ │
│ │  main            ▍▍▍▍ high   183 sessions  $128.40  →                 │ │
│ │  feature/optim   ▍▍▍░ med    18 sessions   $9.20    →                 │ │
│ │  (unknown)       ▍▍░░ low    14 sessions   $4.10    ⚠  Override →     │ │
│ └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘

[Clicking → opens BranchOverridePanel drawer for that branch]
```

### 21.7 WidgetsPage (`/widgets`)

**Purpose:** preview and configure the four macOS widgets.

Page is a 2-column grid: left = widget SVG previews (already implemented in `WidgetsPage.jsx`), right = configuration panel (size, refresh interval, which provider to highlight). Below: macOS app download CTA (the only outbound CTA on the entire dashboard).

### 21.8 ExportPage, SettingsPage

**ExportPage** — single card, form: date range, format (CSV / JSON / SVG banner), filters. Primary action button at bottom. After export: success toast with download link.

**SettingsPage** — left column is Tier 1 section list (Account / Appearance / Providers / Menu Bar / Advanced / Privacy). Right column is the content for the selected section. No tabs at top, no nested cards. Each section is a vertical stack of form rows.

---

## 22. macOS app — per-tab composition specs

### 22.1 Window chrome

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⊙ ⊙ ⊙   VibeDeck — release/1.0.4                                  ⚙  ●   │ ← Title bar inline title
├──────────────┬──────────────────────────────────────────────────────────────┤
│ Sidebar      │ Detail (the active tab)                                       │
│  220pt       │                                                               │
│              │                                                               │
│ LIVE         │                                                               │
│ ● Dashboard  │                                                               │
│ ○ Live       │                                                               │
│ ○ Branches   │                                                               │
│              │                                                               │
│ INTELLIGENCE │                                                               │
│ ○ Optimize   │                                                               │
│ ○ Plan       │                                                               │
│ ○ Compare    │                                                               │
│ ○ Models     │                                                               │
│              │                                                               │
│ ANALYTICS    │                                                               │
│ ○ Yield      │                                                               │
│ ○ Skills     │                                                               │
│              │                                                               │
│ SETUP        │                                                               │
│ ○ Widgets    │                                                               │
│ ○ Export     │                                                               │
│ ○ Settings   │                                                               │
│              │                                                               │
│ ┌──────────┐ │                                                               │
│ │ Server   │ │  ← Bottom promo card pattern (Donezo/Stakent)                 │
│ │ healthy  │ │                                                               │
│ │ ▆▆▆▆▆▆░  │ │                                                               │
│ │ Sync now │ │                                                               │
│ └──────────┘ │                                                               │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

**Sidebar spec:**
- Width: `220pt` fixed.
- Background: `Color.windowBackground` (lets macOS handle vibrancy).
- Section headers: `text-label` uppercase, `Color.secondary`, `tracking-wide`, `12pt` font, padding-top `16pt`.
- Items: `28pt` tall, `8pt` horizontal padding, `4pt` radius hover state.
- Active item: leading `3pt` accent bar `Colors.brandPrimary`, text `Color.primary` weight `.semibold`.
- Hover: `Color.primary.opacity(0.04)` background.
- Bottom card: `160pt` tall, dark gradient (`Colors.brand900` → `Colors.brand800`), embedded server health (mini limit bar) + "Sync now" pill button. Replaces the empty space at bottom of sidebar with utility.

### 22.2 DashboardView (home tab)

Mirrors web `DashboardPage` composition but tighter (compact density).

```
┌───────────────────────────────────────────────────────────────────────┐
│  Welcome back, Vasu                              [Week ▾]   🐾 Clawd  │
│  Tuesday, 27 May 2026                                                  │
│                                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐│
│  │  TODAY'S SPEND          │  │  ACTIVE SESSIONS                    ││
│  │                         │  │                                      ││
│  │   $12.40                │  │   3                                  ││
│  │   ▆▁▂▃▅▇▆▅              │  │   ⬤ ⬤ ⬤                              ││
│  │   ▲ 14%                 │  │   Claude · Codex · Cursor            ││
│  └─────────────────────────┘  └─────────────────────────────────────┘│
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  PROVIDER BREAKDOWN                                               ││
│  │  Native SwiftUI Charts.BarMark, single brand color stack         ││
│  └──────────────────────────────────────────────────────────────────┘│
│                                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐│
│  │  ATTRIBUTION HEALTH     │  │  ACTIVITY HEATMAP                   ││
│  │  Gauge 87%              │  │  ▢▢▢▢▢▢▢▢▢▢▢▢▢                      ││
│  └─────────────────────────┘  └─────────────────────────────────────┘│
│                                                                        │
│  🐾 Clawd companion strip — bottom of view                            │
└───────────────────────────────────────────────────────────────────────┘
```

ClawdCompanionView stays bottom-of-page where it currently lives — it's the "ambient" surface. Top-right Clawd in header is a separate small instance for live state reflection.

### 22.3 LiveView (Live tab in macOS)

Same as web LivePage, tightened: KPI strip is 4 cells but each is `compact` density (`14pt` text instead of `16pt`). Sessions table uses `NavigationLink` to push detail view rather than open a drawer.

### 22.4 OptimizePlanTabsView

Already exists. Uses `Picker(.segmented)` for Optimize | Plan toggle. Each tab content matches web layout. Hero card uses `LinearGradient` `Colors.brand700 → Colors.brand600` background, white text, `.font(.system(size: 44, weight: .semibold, design: .rounded))` for the savings number.

### 22.5 AnalyticsTabsView (Compare | Models | Yield | Skills)

Segmented control with 4 tabs. Each tab is a vertical scroll of cards matching its web counterpart. **No Entire tab** — that surface is commented out across UI, setup, and backend.

### 22.6 ServerOfflineView

Full-window state.

```
┌────────────────────────────────────────────────────────┐
│                                                         │
│                                                         │
│                                                         │
│                          ▰▰▰                            │  ← Three-plane mark, secondary opacity 0.3
│                         ▰▰▰▰▰                           │
│                                                         │
│                    VibeDeck is offline                  │  ← text-h2
│              The local server isn't responding.         │  ← text-body, secondary
│                                                         │
│       [Restart server]    [Open dashboard in browser]   │  ← Primary + secondary buttons
│                                                         │
│       Logs: ~/Library/Application Support/VibeDeck/logs│  ← text-caption mono, secondary
│                                                         │
└────────────────────────────────────────────────────────┘
```

No stack traces. No exception text. The buttons do the work, logs are linked for debugging.

---

## 23. macOS menubar — section-by-section spec

The menubar is the single most-seen surface of VibeDeck (always present). It needs to be **denser than the dashboard, lighter than the app**.

### 23.1 Menubar icon (status bar item)

- Asset: monochrome 3-plane mark exported as PDF template image (`mark-mono.svg` → PDF asset).
- Auto-tinted by macOS to match menubar color.
- Size: 16×16pt (macOS default for menubar items).
- **Active session pulse:** opacity oscillation `0.6 → 1.0`, 1.6s period, only when 1+ active session. Disabled by `prefers-reduced-motion`.
- **Right-click / control-click:** standard menu (Open VibeDeck · Preferences · Quit).
- **Left-click:** opens popover (below).

### 23.2 Menubar popover anatomy

Popover width: `320pt`. Max height: `560pt`. Background: `.regularMaterial`. Corner radius `12pt`. Border `0.5pt Color.separator`.

```
┌──────────────────────────────────────────┐
│  🐾  VibeDeck            ● 3 ACTIVE  ⚙   │  ← Header (44pt tall)
├──────────────────────────────────────────┤
│                                          │
│   TODAY                                  │  ← Tier 1 label
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│   $12.40           ▲ 14%   vs yesterday  │  ← Hero number row
│                                          │
│   ████████████████████████████████░░░░   │  ← Segmented bar (provider mix)
│   ⬤ Claude 45%  ⬤ Codex 22%  ⬤ Cursor   │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│   ACTIVE NOW                             │  ← Tier 1 label
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│   ● Claude   workflow.ts          $0.42  │  ← 32pt row
│   ● Codex    api.ts               $0.18  │
│   ● Cursor   README.md            $0.03  │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│   LIMITS                                 │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━   │
│   Claude   ████████████████████▌  92%    │  ← Limit bar row
│            resets in 14m                 │
│   Codex    █████░░░░░░░░░░░░░░░  28%    │
│                                          │
├──────────────────────────────────────────┤
│                                          │
│   [Open VibeDeck]              [Sync ↻]  │  ← Footer actions, 44pt tall
│                                          │
└──────────────────────────────────────────┘
```

### 23.3 Popover sections — detailed specs

**Header (44pt tall):**
- Left: Clawd `mini-idle` 20×20pt + wordmark "VibeDeck" `headline` weight.
- Right: live tick indicator (`●` + uppercase count) + gear icon (opens Settings).
- Bottom border: `0.5pt Color.separator`.

**TODAY section (~120pt tall):**
- Section label: `caption2` uppercase, `Color.secondary`, padding-top `12pt`, padding-horizontal `16pt`.
- Hero row: `font(.title2).weight(.semibold).monospacedDigit()` for "$12.40", trend chip right-aligned.
- Segmented bar: 8pt tall, full width minus padding, brand colors.
- Provider dots + names: `caption.monospacedDigit()`, `Color.secondary`.

**ACTIVE NOW section (variable height, max 4 rows shown):**
- Each row 32pt tall.
- Leading 8pt pulsing dot (`Colors.brandPrimary`, `mini-alert` pulse).
- Provider name + filename (truncate with ellipsis). Filename uses JetBrains Mono `caption`.
- Trailing cost, monospaced, `body.weight(.medium)`.
- If 0 active: replace with single empty row "Nothing running — Clawd is napping 🛌" (literal text, Clawd state `sleep/sleeping`).
- If more than 4 active: show first 4 + "(+N more)" link row.

**LIMITS section (variable height, max 3 providers shown):**
- Each provider takes 40pt: name + bar + percent on top row (24pt), reset countdown on subrow (16pt).
- Bar uses `WidgetTheme.limitBarColor` (green/amber/red — semantic exception to indigo).
- Sort by urgency: red first, then amber, then highest %.
- If all are < 50%: collapse to single row "All providers under 50% — Vasu is being economical."

**Footer (44pt tall):**
- Two pill buttons, 32pt tall, equal width with 8pt gap.
- "Open VibeDeck" primary `.buttonStyle(.borderedProminent)` `.tint(Colors.brandPrimary)`.
- "Sync" secondary `.buttonStyle(.bordered)`, refresh icon + text. Triggers immediate sync, shows spinner inline while running.

### 23.4 Popover state behaviors

- **Live update:** popover refreshes every 5s while open. Numbers fade-swap (180ms cross-fade), bars resize (180ms ease-out).
- **Offline state:** if local server is unreachable, replace TODAY section with offline message + retry button. ACTIVE NOW and LIMITS sections hide. Clawd in header switches to `status/disconnected`.
- **First-run state:** if no sessions ever recorded, replace popover content with onboarding card (Clawd `mini-happy` + "Run any AI tool to start tracking" + link to setup docs).
- **Keyboard:** `Esc` closes. `⌘O` opens app. `⌘R` syncs. `↑↓` navigates rows; `Enter` opens session in app.

### 23.5 What the menubar popover never does

- ❌ No charts. (Use widgets for visual data.)
- ❌ No settings forms. (Open the app.)
- ❌ No multi-step flows. (One screen, one decision.)
- ❌ No login state. (We don't have one.)
- ❌ No notifications list. (System notifications handle that.)

---

## 24. Widgets — exact compositions per size

Four widgets × three sizes = twelve compositions. Each one drawn out below. All measurements in points (1pt = 1px @1x). System always controls theme (light/dark follows OS, never overridable in widget).

### 24.1 SummaryWidget

**Small (158×158pt)**
```
┌──────────────────────────┐
│ TODAY              4m ago│  ← Title row 16pt
│                          │
│  $12.40                  │  ← Hero, title2 rounded semibold
│                          │
│  203.2M tokens           │  ← Subtitle, caption medium
│                          │
│  ▆▁▂▃▅▇▆                 │  ← Sparkline, 24pt tall, brand stroke
│                          │
│  ▲ 14%  vs yesterday     │  ← Trend chip caption2
└──────────────────────────┘
```

**Medium (338×158pt)**
```
┌────────────────────────────────────────────────┐
│ TODAY                                  4m ago  │
│                                                 │
│  $12.40                       PROVIDERS         │
│  203.2M tokens                                  │
│                              ⬤ Claude    45%   │
│  ▆▁▂▃▅▇▆▅▆▇▅▃▂▁▂▃▅▇▆▅       ⬤ Codex     22%   │
│                              ⬤ Cursor    18%   │
│  ▲ 14%  vs yesterday         ⬤ Gemini     9%   │
└────────────────────────────────────────────────┘
```

**Large (338×354pt)**
```
┌────────────────────────────────────────────────┐
│ TODAY                                  4m ago  │
│                                                 │
│  $12.40                       PROVIDERS         │
│  203.2M tokens                                  │
│                              ⬤ Claude    45%   │
│  ▆▁▂▃▅▇▆▅▆▇▅▃▂▁▂▃▅▇▆▅       ⬤ Codex     22%   │
│                              ⬤ Cursor    18%   │
│  ▲ 14%  vs yesterday         ⬤ Gemini     9%   │
│                              ⬤ Other      6%   │
├────────────────────────────────────────────────┤
│ THIS WEEK                                       │
│                                                 │
│  ▁ ▃ ▅ ▆ ▇ ▆ ▆                                 │  ← 7 bars, daily
│  S M T W T F S                                  │
│                                                 │
│  $84.20 total  ·  6 active days                 │
└────────────────────────────────────────────────┘
```

### 24.2 TopModelsWidget

**Small (158×158pt)** — top 1 model
```
┌──────────────────────────┐
│ TOP MODEL          4m ago│
│                          │
│  claude-opus-4-7         │  ← caption.semibold, may wrap to 2 lines
│                          │
│  $8.40                   │  ← title2 rounded semibold
│  60.2M tokens            │  ← caption
│                          │
│  ▆▆▆▆▆▆▆▆▆▆ 67%          │  ← Bar showing % of today's total
└──────────────────────────┘
```

**Medium (338×158pt)** — top 3 models with bars
```
┌────────────────────────────────────────────────┐
│ TOP MODELS                             4m ago  │
│                                                 │
│ ● claude-opus-4-7  ▆▆▆▆▆▆▆▆▆▆▆▆▆ 67%   $8.40   │
│ ● gpt-5.5          ▆▆▆▆▆ 22%             $2.80 │
│ ● gemini-2.5       ▆▆ 11%                $1.20 │
└────────────────────────────────────────────────┘
```

**Large (338×354pt)** — top 5 + provider breakdown
```
┌────────────────────────────────────────────────┐
│ TOP MODELS                             4m ago  │
│                                                 │
│ ● claude-opus-4-7  ▆▆▆▆▆▆▆▆▆▆▆▆▆ 67%   $8.40   │
│ ● gpt-5.5          ▆▆▆▆▆ 22%             $2.80 │
│ ● gemini-2.5       ▆▆ 11%                $1.20 │
│ ● claude-sonnet-4  ▆ 5%                  $0.62 │
│ ● cursor-fast      ▆ 4%                  $0.50 │
├────────────────────────────────────────────────┤
│ BY PROVIDER                                     │
│                                                 │
│  ⬤ Claude   ▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆▆ 72%   $9.02 │
│  ⬤ OpenAI   ▆▆▆▆▆▆▆ 22%                 $2.80 │
│  ⬤ Google   ▆▆▆ 11%                     $1.20 │
└────────────────────────────────────────────────┘
```

### 24.3 UsageLimitsWidget

**Small (158×158pt)** — biggest used provider
```
┌──────────────────────────┐
│ LIMITS             4m ago│
│                          │
│  Claude                  │
│  ████████████████░░  92% │  ← Color-coded limit bar (red)
│                          │
│  2.3M / 2.5M tokens      │
│  resets in 14m           │
└──────────────────────────┘
```

**Medium (338×158pt)** — 3 providers
```
┌────────────────────────────────────────────────┐
│ LIMITS                                 4m ago  │
│                                                 │
│  Claude   ████████████████████▌ 92%  in 14m    │  ← red
│  Codex    █████████░░░░░░░░░░░ 45%  in 4h      │  ← green
│  Cursor   █████████████░░░░░░░ 68%  in 6h      │  ← amber  
└────────────────────────────────────────────────┘
```

**Large (338×354pt)** — 5-6 providers + reset timeline
```
┌────────────────────────────────────────────────┐
│ LIMITS                                 4m ago  │
│                                                 │
│  Claude    ████████████████████▌ 92%  in 14m   │
│  Codex     █████████░░░░░░░░░░░ 45%  in 4h     │
│  Cursor    █████████████░░░░░░░ 68%  in 6h     │
│  Gemini    ████░░░░░░░░░░░░░░░░ 18%  in 2d     │
│  Kimi      ██░░░░░░░░░░░░░░░░░░ 8%   in 12h    │
│  Copilot   ██████░░░░░░░░░░░░░░ 28%  in 18h    │
├────────────────────────────────────────────────┤
│ RESET TIMELINE                                  │
│                                                 │
│  Now   1h    6h    12h   1d    2d              │
│  ┃     ┃     ┃     ┃     ┃     ┃              │
│  ●─Claude       ●─Cursor                       │
│        ●─Codex             ●─Copilot           │
└────────────────────────────────────────────────┘
```

### 24.4 HeatmapWidget

**Small (158×158pt)** — last 4 weeks
```
┌──────────────────────────┐
│ ACTIVITY           4m ago│
│                          │
│  M ▢ ▢ ▣ ▤               │  ← 4 weeks × 7 days
│  T ▢ ▣ ▣ ▥                │
│  W ▢ ▣ ▤ ▥                │
│  T ▢ ▤ ▥ ▦                │
│  F ▢ ▤ ▥ ▥                │
│  S ▢ ▢ ▢ ▣                │
│  S ▢ ▢ ▢ ▢                │
│                          │
│  4-week streak           │
└──────────────────────────┘
```

**Medium (338×158pt)** — 13 weeks (quarter)
```
┌────────────────────────────────────────────────┐
│ ACTIVITY                              4m ago    │
│                                                 │
│  M ▢ ▢ ▢ ▣ ▣ ▤ ▤ ▥ ▥ ▥ ▥ ▦ ▦                  │
│  T ▢ ▢ ▣ ▣ ▤ ▤ ▥ ▥ ▥ ▦ ▦ ▦ ▦                  │
│  W ▢ ▣ ▣ ▤ ▤ ▥ ▥ ▥ ▦ ▦ ▦ ▦ ▦                  │
│  T ▢ ▣ ▤ ▤ ▤ ▥ ▥ ▦ ▦ ▦ ▦ ▦ ▦                  │
│  F ▢ ▣ ▤ ▥ ▥ ▥ ▥ ▦ ▦ ▦ ▦ ▦ ▦                  │
│  S ▢ ▢ ▢ ▣ ▣ ▣ ▣ ▣ ▤ ▤ ▤ ▤ ▤                  │
│  S ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▢ ▣ ▣ ▣ ▣                  │
│                                                 │
│  91-day streak  ·  214M tokens this quarter    │
└────────────────────────────────────────────────┘
```

**Large (338×354pt)** — full year
```
┌────────────────────────────────────────────────┐
│ ACTIVITY                              4m ago    │
│                                                 │
│      Jan  Feb  Mar  Apr  May  Jun  Jul  ... Dec │
│  M  ▢▢▢▢ ▢▢▢▢ ▣▣▣▣ ▤▤▤▤ ▥▥▥▥ ▦▦▦▦ ▢▢▢▢ ...   │
│  T  ▢▢▢▢ ▢▣▣▣ ▣▣▤▤ ▤▤▥▥ ▥▥▥▥ ▦▦▦▦ ▢▢▢▢ ...   │
│  ...                                            │
│                                                 │
│  ▢ none   ▣ low   ▤ med   ▥ high   ▦ peak     │  ← Legend
│                                                 │
│  ─────────────────────────────────────────     │
│  Best day:  $42.30   on  2026-04-18            │
│  Longest streak:  47 days  (Mar 12 – Apr 28)   │
└────────────────────────────────────────────────┘
```

### 24.5 Widget shared rules

- **All title rows are 16pt tall** with `caption2` weight `.semibold`, `Color.secondary`.
- **Trailing relative time** always present (`WidgetFormat.relativeUpdated`).
- **Numbers always tabular** (`.monospacedDigit()` on every digit-bearing text).
- **No taps inside widgets** (deep links open the app at the relevant tab).
- **Background:** `WidgetTheme.widgetBackground` linear gradient. Untouched.
- **Padding:** Small 12pt all sides, Medium 14pt, Large 16pt.
- **System theme only.** Widgets always follow OS appearance.
- **Refresh cadence:** 5 minutes (TimelineProvider). Force refresh on app sync.

---

## 25. The "no cheap" checklist

Before shipping any surface, run through this list. If any answer is "yes," fix it.

- [ ] Does any text use `font-family: Arial`, `Helvetica`, `Inter`, or system default for body copy?
- [ ] Does any card use a hardcoded `bg-white` or `bg-gray-50` instead of `var(--glass-bg)` / `var(--vd-card-bg)`?
- [ ] Does any button have a gradient background?
- [ ] Are any two indigo shades being used as a gradient on chrome (outside the logo container and OptimizePage hero)?
- [ ] Is there an emoji used as a UI icon (not in copy)?
- [ ] Is a card containing another card?
- [ ] Are there more than 4 KPI cards visible at once on a single page?
- [ ] Is a chart showing more than 6 colors without a clear ordinal mapping?
- [ ] Does any number lack `tabular-nums` / `.monospacedDigit()`?
- [ ] Is any spinner running for more than 4 seconds without falling back to a progress bar or skeleton?
- [ ] Is a side drawer using glass background instead of solid?
- [ ] Are any text/background pairs below 4.5:1 contrast?
- [ ] Does any state lose information when `prefers-reduced-motion` is set?
- [ ] Does dark mode use pure black `#000` or near-black with no indigo undertone?
- [ ] Does light mode use pure white `#fff` for the page background?
- [ ] Is Clawd in a widget? (Widgets must never include Clawd.)
- [ ] Is there a "Sign in" prompt anywhere? (We are local-only.)
- [ ] Is a stack trace shown in a user-facing error state?
- [ ] Does the page have 8+ surfaces (the "wall of cards" smell)?

---

## 26. Implementation checklist for the revamp PR

Concrete tasks, ordered. Each is its own ~half-day chunk.

1. **Tokens audit (web).** Confirm every component reads `var(--*)` and not hex. Sweep `dashboard/src`.
2. **Tokens parity (Swift).** Update `Colors.swift` to mirror every `--brand-*` token. Same for `WidgetTheme.swift`.
3. **Sidebar grouping (web).** Implement the 4-lane sidebar from §8 / §22.1. Add section labels. Active state with left bar.
4. **Sidebar bottom card (web).** Add the server-health + macOS-app-download card to sidebar bottom.
5. **Sidebar grouping (macOS).** Mirror in `NavigationSplitView`.
6. **DashboardPage rebuild.** Implement the layout in §21.1. Kill any extra cards.
7. **LivePage rebuild.** Implement §21.2. Verify drawer pattern.
8. **OptimizePage hero + sidecars.** §21.3.
9. **PlanPage forecast chart.** §21.4.
10. **Drawer audit.** Every existing drawer follows §18.1 spec.
11. **Loader audit.** Replace every spinner with skeleton (§19.2) or progress bar (§19.4).
12. **Menubar popover rebuild.** §23.
13. **Widget refresh.** All 12 widget compositions per §24.
14. **ServerOfflineView.** §22.6.
15. **Theme switcher.** Settings page in both web + macOS.
16. **Provider-logo sweep.** Replace every color dot with the local SVG logo per §27.
17. **Final "no cheap" pass.** §25 checklist on every surface.

Ship as one big PR or 17 small ones. Either way, every surface ends up on this design system or none of them do.

---

## 27. Provider logos — the canonical identity

Provider logos are the **only** correct way to identify a provider in VibeDeck UI. Color dots are reserved for status (live / idle / offline), not for telling providers apart. We have all 12 locally — there is no excuse to render dots-with-names anywhere.

### 27.1 Local assets

Path: `dashboard/public/brand-logos/`. Mirror these on macOS as PDF/SVG in `VibeDeckMac/VibeDeckMac/Assets.xcassets/ProviderLogos/`.

```
antigravity.svg       claude-code.svg       codex.svg
copilot.svg           cursor.svg            factoryai-droid.svg
gemini.svg            hermes.svg            kimi.svg
kiro.svg              openclaw.svg          opencode.svg
```

When a new provider ships: add its SVG to **both** locations in the same PR. Until then, fall back to the three-plane logo mark in `var(--oai-gray-400)` with the provider name in `text-caption` next to it.

### 27.2 Color vs mono logos

Some logos in our library are full-color (claude-code, gemini, codex, antigravity, copilot, factoryai-droid). Some are monochrome (cursor, kimi, kiro, hermes, opencode, openclaw).

**Existing `MONO_LOGOS` set in `WidgetsPage.jsx`** lists which ones are mono. Mono logos must be rendered as `currentColor` (the surrounding text color flows into them). Color logos render as-is.

This is already mostly correct in `WidgetsPage.jsx`. The rule for the rest of the app: **read `MONO_LOGOS` before rendering. Don't tint color logos. Don't leave mono logos black on dark mode.**

Centralize this. Create `dashboard/src/lib/provider-logos.js` exporting:

```js
export const PROVIDER_LOGOS = { /* path map */ };
export const MONO_PROVIDERS = new Set([...]);
export function ProviderLogo({ provider, size = 16, className }) {
  // renders <img> for color, <svg> with currentColor for mono
}
```

Every consumer imports `ProviderLogo`. No raw `<img src="/brand-logos/..." />` anywhere else.

### 27.3 Sizes (consistent across surfaces)

| Use | Size | Container |
|-----|------|-----------|
| Inline in body copy | 14px / 14pt | no container |
| Table row / list row | 16px / 16pt | no container |
| Chip / pill | 16px / 16pt | rounded-full bg-[var(--oai-gray-100)] 4px padding |
| KPI card secondary identity | 20px / 20pt | no container |
| Hero / featured provider | 32px / 32pt | rounded-md bg-[var(--vd-tint)] 8px padding |
| Menubar popover row | 16pt | no container |
| Widget Medium / Large row | 14pt | no container |
| Widget Small "top provider" hero | 24pt | no container |

### 27.4 Where dots become logos

This is a sweep of every existing component. Every ASCII `⬤` in the page composition sketches in §21–§24 means "provider logo at the size listed in §27.3," not "colored dot."

| Component | Current | After |
|-----------|---------|-------|
| `LiveSessionList` row leading element | Color dot from `SOURCE_COLORS` | `<ProviderLogo size={16} />` |
| `LiveOperationsPanel` Provider column | Color dot + name | Logo + name |
| `TopModelsView` row | Color dot per model's provider | Logo per model's provider |
| `LiveProviderLimitsGrid` per-provider row | Color dot | Logo + name |
| Dashboard "Top Providers" section | Color dot | Logo + name (already partially correct in WidgetsPage) |
| Menubar popover provider rows | Color dot | Logo + name |
| BranchesPage attribution rows | Color dot per branch's primary provider | Logo |
| Widget rows (Medium/Large) | Color dot | Logo (14pt) |

**What stays as a color dot:**

- **Status diodes** (Section 10.5.3.B) — green/amber/red health pip is intentionally generic, not provider-identifying.
- **Live tick** (Section 10.5.3.A) — single pulsing dot meaning "live now," not "Claude."
- **Sessions list "● running / ○ idle" prefix** — that's a state indicator, not provider identity. Provider logo sits to the right of it.

```
Row anatomy after the sweep:

  ●  [logo] Claude   workflow.ts    $0.42  →
  ▲  ▲     ▲         ▲              ▲
  │  │     │         │              └ cost (tabular-nums)
  │  │     │         └ filename (truncate)
  │  │     └ provider name (label)
  │  └ provider logo (16×16)
  └ status diode (8×8) — green/grey/red
```

### 27.5 Provider color usage after the sweep

`SOURCE_COLORS` (web) and `WidgetTheme.sourceColor` (Swift) still exist and are still used — but **only for chart fills and segmented bars**, never for identity dots. The breakdown:

| Color use | Allowed? |
|-----------|----------|
| Stacked bar segment fill (a provider's share of total) | ✓ |
| Provider's line/area in a multi-series chart | ✓ |
| Provider's bar in a horizontal bar list (next to its logo + name) | ✓ |
| Sparkline stroke when the sparkline is provider-specific | ✓ |
| Identifying a provider via dot alone (no logo) | ✗ |
| Coloring a provider's name text | ✗ — names stay `Color.primary` |
| Background tint on a row to flag provider | ✗ |
| Pill / chip background to identify provider | ✗ |

Charts use provider color. Lists use provider logo. **They never substitute for each other.**

### 27.6 Logo accessibility

- Every `ProviderLogo` must include `aria-label="<provider name> logo"` and be next to (or include via visually-hidden text) the provider's name. Screen readers should never get just an image with no context.
- Mono logos: ensure 3:1 contrast against background after `currentColor` resolution.
- High-contrast OS mode (Windows/macOS): mono logos auto-invert via `currentColor`. Color logos remain as-is (their original color is the brand).

---

## 28. Data presentation — anti-overwhelm rules

The current dashboard fails the "absorb at a glance" test. Numbers are everywhere, ratios stack on ratios, the eye doesn't know where to start. These rules fix that.

### 28.1 The 3-tier glance hierarchy

Every page answers three questions in this order, with decreasing prominence:

1. **The headline (1 number, 1 word).** "$12.40 today." That's the page's answer.
2. **The context (3 numbers max).** "$84 this week · ▲ 14% vs yesterday · 3 active now." Supports the headline.
3. **The detail (table, chart, list).** Everything else.

If a page has two headlines, it's two pages. Split.

### 28.2 Number-per-screen budget

On any single viewport (no scroll), there is a hard cap on numbers visible:

| Surface | Max numbers visible | Max distinct number formats |
|---------|---------------------|------------------------------|
| Dashboard home | 14 | 3 (currency, count, percent) |
| LivePage | 18 | 4 (currency, tokens, percent, time) |
| Optimize hero zone | 6 | 1 (currency) |
| Plan forecast | 10 | 2 (currency, percent) |
| Compare | 12 | 2 |
| Models / Yield / Skills | 16 | 3 |
| Menubar popover | 12 | 3 |
| Widget Small | 3 | 1 |
| Widget Medium | 6 | 2 |
| Widget Large | 14 | 3 |

If a design exceeds the cap, drop the lowest-value metric. The cap forces editorial choice.

### 28.3 Number formatting — one rule per kind

| Kind | Format | Example |
|------|--------|---------|
| Currency, < $1 | 2 decimal places, leading $ | `$0.42` |
| Currency, $1–$999 | 2 decimal places, leading $ | `$84.20` |
| Currency, ≥ $1000 | 0 decimal places, comma sep | `$1,247` |
| Tokens, < 1K | raw, comma sep | `847` |
| Tokens, 1K–999K | 1 decimal `K` | `12.4K` |
| Tokens, ≥ 1M | 1 decimal `M` | `203.2M` |
| Tokens, ≥ 1B | 1 decimal `B` | `1.4B` |
| Percent | 0 decimals if integer; 1 decimal otherwise | `92%` `87.5%` |
| Ratio (cache hit) | 0 decimals percent | `34%` |
| Delta | Signed integer percent with arrow | `▲ 14%` |
| Time, < 1 min | seconds | `42s` |
| Time, < 1 hr | minutes | `14m` |
| Time, < 1 day | hours + minutes | `2h 14m` |
| Time, ≥ 1 day | days | `3d` |
| Relative past | suffix `ago` | `4m ago` |
| Relative future | prefix `in` | `in 14m` |
| Date | abbreviated month + day | `27 May` |
| Datetime | hh:mm 24h, no seconds | `14:32` |
| Tabular numerals | always for currency, tokens, percent, time | (via CSS / `.monospacedDigit()`) |

Centralize in `dashboard/src/lib/format.js`. Mirror exactly in `WidgetFormat.swift`. **A user must never see two formats for the same kind of number on the same page.**

### 28.4 The "what does this number mean?" rule

Every number on screen must answer three questions at a glance:

1. **What is it?** A label, never inferred. `Today's spend` not just `$12.40`.
2. **What's the scale?** A unit or denominator. `92% of limit`, not just `92%`.
3. **Is it good or bad?** A trend arrow or color cue. `▲ 14%` and the color tells the user it's up; semantic color tells them whether that's good or bad in context.

If a number can't answer all three, it doesn't belong on that surface — it belongs in a detail drawer or table.

### 28.5 Progressive disclosure

The dashboard surfaces summaries. The drawer surfaces details. **Don't put both in front of the user at once.**

Examples:

- Live session list shows: provider logo + filename + spend + status. Click the row → drawer with: full token breakdown (in/out/cache), model used, branch, parent session ID, raw command, retry button. The 30 extra fields go in the drawer.
- TopModelsView shows top 3 with bars. Click "See all" → ModelsPage with 50 rows + filters. Don't try to fit 50 rows on the home page.
- LiveProviderLimitsGrid shows current %. Click → drawer with history of limit hits, reset timestamps for the last 30 days, per-key breakdown if the provider has multiple keys.

**Three-click rule:** any data the user might want is within three clicks of the dashboard home. Not three taps on the same page.

### 28.6 Stop showing zeros

If a value is `0`, suppress it from displays where its presence implies activity. Examples:

- "0 active sessions" → show "No active sessions" with Clawd sleeping. Don't render a `0`.
- "$0.00 today" → show "No spend yet today" (until first session of the day).
- "0% cache hit" → show "Caching not yet detected" with explainer link, not a `0%` half-gauge.
- Empty table → empty state component (§29), not table with `0` cells.

A zero in a table cell is OK (it's data). A zero as a headline is depressing and uninformative. Show the absence with words, not numbers.

### 28.7 Cap list lengths

| Surface | Default rows | Show-more |
|---------|--------------|-----------|
| Dashboard "Recent Activity" | 5 | "See all" → LivePage |
| Dashboard "Top Providers" | 5 (top + Other) | "See all" → page link |
| Dashboard "Top Models" | 3 | "See all" → ModelsPage |
| LivePage Sessions | 20 | "Show N more" expands |
| LivePage Operations | 50 (virtualized after) | infinite scroll |
| ModelsPage | 50 per page | pagination |
| Menubar Active Now | 4 | "(+N more)" inline |
| Menubar Limits | 3 | tap to see all in app |
| Widget Small | 1 | n/a |
| Widget Medium | 3 | n/a |
| Widget Large | 5–6 | n/a |

Beyond these defaults, show a clean "show more" affordance. Never auto-expand by default.

### 28.8 Stop labeling the obvious

Bad: `Today's spend: $12.40 USD (currency)`
Good: `Today's spend  $12.40`

- Don't append `USD` if the user is in a US-locale build. If we ship multi-currency later, label it then.
- Don't say `(tokens)` after a token count. The K/M/B suffix already tells them.
- Don't repeat the time-range in every card title if the page header already has a period picker.

### 28.9 Use stripes to mark "not real yet"

Forecast data, projected limits, in-flight sums — anything that isn't settled real data — uses **diagonal stripe fill** (Donezo pattern, §16). Solid fill = settled. Stripes = projected.

Implementation:

```css
.is-projected {
  background-image: repeating-linear-gradient(
    -45deg,
    var(--brand-300) 0,
    var(--brand-300) 4px,
    transparent 4px,
    transparent 8px
  );
}
```

Apply to: forecast bars on PlanPage, "projected today's spend" half-bars on LivePage when extrapolating from current burn rate, skeleton-state KPI numbers while live data is loading (transitions from striped → solid as data arrives).

---

## 29. Empty / first-run / loading / error states — per surface

Every surface has four states. Designing only the "happy path" is the most common reason dashboards feel cheap. Spec each state.

### 29.1 The four states

1. **First-run / empty** — User has VibeDeck installed but no sessions yet recorded. Friendly, instructional.
2. **Mid-flight / loading** — Data is fetching. Use skeleton (§19.2).
3. **Live / data present** — The happy path. Specs in §21–§24.
4. **Error / offline** — Backend unreachable, sync failed, data corrupt. Calm, actionable.

### 29.2 Dashboard home

**First-run:** Replace KPI cards with one centered card:

```
┌─────────────────────────────────────────────────────┐
│                                                      │
│                      [Clawd]                         │  ← mini-happy, 80px
│                                                      │
│              Welcome to VibeDeck                     │  ← text-h2
│                                                      │
│       Run any AI coding tool to start tracking.      │  ← text-body, secondary
│       VibeDeck listens automatically.                │
│                                                      │
│       [Detect now]    [Setup guide →]                │  ← Primary + ghost
│                                                      │
└─────────────────────────────────────────────────────┘
```

"Detect now" triggers a one-shot scan of common log paths. "Setup guide" opens documentation.

**Loading:** All KPI cards render as skeletons matching their final shape. Hero card shows skeleton number `▓▓▓▓▓▓` and skeleton sparkline. Provider breakdown shows skeleton segmented bar. Page header fills in instantly (it doesn't depend on data).

**Error:** KPI strip stays visible with last-known values. Banner above strip: `⚠ Couldn't refresh data — showing values from 4m ago. [Retry]`. Banner is `bg-[var(--vd-tint)] border-[var(--vd-border-strong)]`, 40px tall, inline-dismissible.

### 29.3 LivePage

**First-run:** Same welcome card. No KPI strip.

**No active sessions (but past data exists):** KPI strip still visible. Sessions card shows:

```
┌─────────────────────────────────────────────────────┐
│  [Clawd, sleep/sleeping, 56px]                       │
│                                                      │
│  Nothing's running right now                         │  ← text-h4
│  Last session ended 32 minutes ago.                  │  ← text-body, secondary
│  Today's totals are still up to date.                │
└─────────────────────────────────────────────────────┘
```

Operations table below stays populated with recent (idle) operations.

**Loading:** Skeleton sessions list (5 rows, 40px each). KPI strip skeleton.

**Error:** Stale-data banner. Live tick indicator in header turns amber `● STALE` until reconnect.

### 29.4 OptimizePage

**First-run / no opportunities:** Hero replaced with:

```
┌─────────────────────────────────────────────────────┐
│  [Clawd, idle-look, 64px]                            │
│                                                      │
│  Nothing to optimize yet                             │  ← text-h2
│  Keep using AI tools — we'll surface savings         │
│  once we see a pattern. (Usually after ~50 sessions.)│
│                                                      │
│  Current cache hit: 0% · Sessions tracked: 12        │  ← progress indicator
└─────────────────────────────────────────────────────┘
```

**Scan running:** Indeterminate bar at top of page + Clawd in `working-thinking`. Hero shows "Scanning…" placeholder. Sidecars render skeletons.

**Error:** Last successful scan results shown with banner: `Last scan failed — showing results from {time}. [Retry scan]`.

### 29.5 PlanPage

**Insufficient data (< 7 days):** Forecast chart shows the data we have + grayed-out region with caption "Forecast unlocks after 7 days of usage." Subscription analysis card still works (it just needs current spend, not history).

**Loading:** Chart skeleton with axis labels visible but no curve.

**Error:** Show forecast as cached, with stale banner.

### 29.6 Compare / Models / Yield / Skills

**Empty (no data for the selected period):** Hero replaced with:

```
[Clawd, idle-doze, 48px]   No {compare|model|yield|skill} data for this period.
                            Try a wider range, or check back after more sessions.
                            [Last 30 days] [Last 90 days]
```

**Loading:** Table skeleton, 10 rows.

### 29.7 BranchesPage

**Empty (no git repos detected):** Card with "Point VibeDeck at a repo to attribute sessions to branches. [Add repo →]" — opens drawer for repo path.

### 29.8 WidgetsPage

Always populated (it's a configuration / preview page, no backend dependency). No empty state needed.

### 29.9 Macros for state design

For every new page, the design template is:

```
First-run    →  Centered card, Clawd mini-happy, "Welcome to {feature}", primary CTA
No-data      →  Centered card, Clawd idle, plain message + secondary CTA to widen filter
Loading      →  Skeletons matching final layout, NEVER spinners
Error        →  Stale banner at top, last-known values still visible, [Retry] action
Offline      →  Same as error, plus Clawd status/disconnected in header
```

Engineers MUST design all four states for every new surface. Code reviews block merge if any state is missing.

---

## 30. Backend → UI data flow — what comes from where

The dashboard is only as honest as the data it shows. This section maps every UI value to its backend source. **No invented metrics. No client-side fabrication.**

### 30.1 Data sources

| Source | Type | Refresh cadence |
|--------|------|------------------|
| Local SQLite event ledger | Session events, token totals, attribution | Real-time (file watcher via chokidar) |
| Provider adapters | Provider limits, reset times | Polled per-provider cadence (1m–10m) |
| Codeburn enrichment fields | Cache hit, model, branch, parent session | Stored per-event in the ledger |
| Optimize scanner | Cached scan output | On-demand (user-triggered) + nightly |
| Plan forecast | Computed from event ledger | Live |
| Skill detector | Detected skills + attribution | Stored per-session |

### 30.2 UI value → source map

| UI surface | Value | Source |
|------------|-------|--------|
| Dashboard hero "Today's spend" | sum of `cost` over today's session events | event ledger |
| Dashboard "Active sessions" | count of sessions with `lastSeen > now-60s` | event ledger |
| Dashboard "Provider breakdown" segmented bar | grouped sum by `provider` field | event ledger |
| Dashboard "Top Providers" list | top N providers by cost, today's range | event ledger |
| LivePage "Tokens / sec" | derivative of recent token deltas, 10s window | event ledger (computed) |
| LivePage "Attribution coverage %" | sessions with non-null `branch` / total sessions | event ledger |
| LiveProviderLimitsGrid bars | `(used / limit)` per provider | provider adapters |
| LiveProviderLimitsGrid reset time | provider-reported reset timestamp | provider adapters |
| OptimizePage savings | scanner output: `cache_savings + swap_savings + subscription_delta` | optimize scanner |
| OptimizePage cache hit % | `cache_hits / total_reads` | Codeburn fields in ledger |
| PlanPage current month spend | sum of `cost` for `month-to-date` | event ledger |
| PlanPage forecast curve | linear regression over last 14 days, extrapolated | computed client-side from ledger |
| PlanPage breakeven | subscription `monthly_cost` vs PAYG-equivalent computed cost | event ledger + provider pricing |
| ModelsPage rows | grouped by `model_id`, all-time or per-period | event ledger |
| YieldPage cache yield | `cache_savings` aggregated by day | Codeburn fields in ledger |
| SkillsPage rows | detected skill invocations grouped by skill | skill detector output |
| BranchesPage attribution | grouped by `branch`, confidence from attribution score | event ledger |
| Widget all values | latest snapshot file written by main app | snapshot file |
| Menubar popover all values | live IPC from main app (no extra fetch) | event ledger via app process |

### 30.3 Rules for engineers wiring data

1. **No client-side fudging.** If the backend says 87%, show 87%. Don't round to "≈ 90%" for "cleanliness."
2. **No fallback values.** If data is missing, show empty state. Never default to `0` or `—` without explicit empty handling.
3. **Show last-update time.** Every card with backend data has a `4m ago` style timestamp accessible (hover on web, secondary text on macOS, always-visible in widgets).
4. **Show data lineage where relevant.** OptimizePage savings: hovering the dollar amount reveals tooltip "Based on 187 sessions over last 30 days. Last scanned 2h ago." Builds trust.
5. **Surface confidence.** Where attribution confidence < high, render the Signal Bars indicator (§10.5.3.D) next to the value. The user must know when we're guessing.
6. **Stale data wins over no data.** If sync fails, show last-known with a stale banner. Empty UI is worse than slightly-old UI.
7. **Never compute UI-only metrics that don't exist server-side.** If you find yourself doing `(a/b)*100` in a component, ask: should this live in the backend so widgets and menubar agree? Usually yes.

### 30.4 Data freshness indicators

Three labels for "how fresh is this":

| Label | When | Color |
|-------|------|-------|
| `● LIVE` | Data < 30s old AND auto-refresh enabled | `var(--brand-500)` pulsing |
| `4m ago` | Data 30s – 30min old | `var(--oai-gray-500)` plain |
| `STALE` | Data > 30min old OR last sync failed | `var(--oai-warning)` |

Every Tier 2 card displays its freshness label in the top-right of its header or in `text-caption` near the value.

### 30.5 What data we have but currently waste

Audit findings (the revamp should surface these properly):

- **Cache hit ratio per session** is in the ledger (Codeburn enrichment) but currently only used in OptimizePage. Surface it in the LivePage session drawer + ModelsPage row detail.
- **Model breakdown per session** is stored but only shown in TopModelsView aggregate. Show in session drawer.
- **Branch + parent session ID** is stored. Show in session drawer with a clickable link to the parent (if exists).
- **Skill attribution per session** is stored. Show in session drawer as a "Skills used in this session" chip row.
- **Provider reset windows** are polled. Show reset countdown not just in widgets but on dashboard home "Needs attention" card.
- **Raw command / prompt-hash** is stored (not the prompt itself — just the hash). Use it for "this exact prompt was cached N times this week" in OptimizePage opportunities. Already collected; not yet displayed.

### 30.6 What data we do NOT have (don't render placeholders for it)

The current backend does NOT track:

- User-attributed names per session (no concept of "this was bug #42").
- Cost of "what would this have cost without VibeDeck."
- Cross-machine sync.
- Team-level aggregation.
- Pricing tier changes over time (we use current pricing for historical analysis).

Don't render UI suggesting these exist. If a future iteration adds them, add UI then.

---

## 31. Microcopy — the small words that prevent confusion

Numbers tell the truth. Words tell the user what the truth means. This is a one-page style guide for every label, button, tooltip, and empty-state line in VibeDeck.

### 31.1 Voice

- **Calm, direct, accurate.** "12 sessions today" not "🚀 You've crushed 12 sessions today!"
- **Specific, not abstract.** "Claude approaching 92% of daily token limit" not "Provider warning."
- **Active voice.** "VibeDeck couldn't reach the server" not "An error has occurred."
- **No clichés.** Never "Houston, we have a problem," "Whoops!", "Oh snap!", "It's not you, it's us."
- **No exclamation points** (one exception: Clawd quips, which are deliberately playful).

### 31.2 Empty / first-run

- "Run any AI coding tool to start tracking." (Dashboard first-run.)
- "Nothing's running right now." (No active sessions.)
- "Nothing to optimize yet — keep going." (Optimize empty.)
- "Forecast unlocks after 7 days of usage." (Plan insufficient data.)
- "Point VibeDeck at a repo to see branch attribution." (Branches empty.)

### 31.3 Errors

- "Couldn't refresh data — showing values from {time}. [Retry]"
- "VibeDeck is offline. [Restart server]"
- "{Provider} sync failed. Check your API key. [Open settings]"
- "Repo path not found: {path}. [Update path]"

Never: "Error 500", "Unknown error", "Something went wrong", "Failed to fetch."

### 31.4 Confirmations & destructive

- Delete data: "Delete all session data? This can't be undone. [Cancel] [Delete]"
- Reset settings: "Reset all settings to defaults? [Cancel] [Reset]"
- Sign out (when we add accounts later): "Sign out of {provider}? Your local data stays on this machine. [Cancel] [Sign out]"

### 31.5 Buttons

- Primary actions: verb + noun, max 3 words. "Restart server", "Add repo", "Open in app", "Run scan."
- Secondary actions: same rule. "Cancel", "Dismiss", "Skip for now."
- Never: "OK", "Click here", "Submit" (use the actual action verb).

### 31.6 Tooltip rules

- Tooltips on icons must repeat the icon's meaning. Icon `⚙` → tooltip "Settings". Don't elaborate.
- Tooltips on numbers explain the source (§30.3.4). "Last scanned 2h ago. Based on 187 sessions."
- No tooltips on text labels — the label is the explanation.
- Tooltip delay: 600ms (don't be aggressive).

### 31.7 Time + date

- Relative for recent: "4m ago", "2h ago", "yesterday".
- Absolute for older: "27 May", "27 May 2026", "14:32 on 27 May".
- Today is "Today", yesterday is "Yesterday", everything else uses dates.
- Never mix relative and absolute in the same column.

### 31.8 Clawd quips (the only place to be playful)

When Clawd speaks (macOS only initially, per §10.6 the dashboard skips quips at first), keep quips:

- Short (1 line, ≤ 60 chars).
- Honest about state, never about you. "Nothing's running" not "You're slacking."
- Occasionally dry. "Claude is doing 80% of the work today."
- Never patronizing. Never motivational. Never anthropomorphizing the user.

Sample bank:
- (idle-living) "All quiet. Tokens unspent."
- (working-typing) "Watching Claude type."
- (working-juggling) "Three sessions. Holding."
- (working-overheated) "That's a lot of context."
- (mini-happy) "Synced."
- (status/error) "Server didn't answer."
- (sleep/sleeping) "Nap mode."

These are quips, not error messages. Real error copy lives in the UI text next to Clawd, not in his bubble.

---

## 32. Final verification — before shipping the revamp

Two passes, in order.

### 32.1 The data pass

For every page, verify:

- [ ] Every visible number traces to a backend source in §30.2.
- [ ] Every state from §29 (first-run, empty, loading, error) renders correctly.
- [ ] No client-side computation invents a number that should be backend-owned (§30.3.7).
- [ ] Provider logos render correctly (§27.4): mono ones inherit color, color ones don't.
- [ ] Freshness indicator (§30.4) is visible on every data card.
- [ ] No zero-as-headline (§28.6).
- [ ] Number budget (§28.2) not exceeded.

### 32.2 The visual pass

For every page, verify:

- [ ] §25 "no cheap" checklist passes.
- [ ] Tier 0–4 card hierarchy (§17) respected; no card-in-card.
- [ ] Exactly one hero per page.
- [ ] Mixed card geometries (§16) — not 6 identical rectangles.
- [ ] All four overlay patterns (§18) used correctly; drawer is solid, popover is solid, modal is rare.
- [ ] Loaders are skeletons (§19), not spinners.
- [ ] Light, dark, and system mode all render correctly (toggle in Settings to verify).
- [ ] Clawd state matches product state (§10.6.2).
- [ ] Microcopy (§31) — every label and button reviewed for voice.

If both passes are clean, ship. If anything fails, fix before merging.

---

## 33. Motion system — animations, transitions, shimmers

The right motion makes a dashboard feel alive without being noisy. Done well, users open VibeDeck because the act of opening it is *satisfying* — the page composes itself in front of them, the data settles into place, the live tick breathes. Done poorly, it's a parade of slide-ins from the corner like every Bootstrap admin template. This section spec's the difference.

This section supersedes the brief Motion table in §6 — Part I established the principle, this is the implementation.

### 33.1 Five motion principles

1. **Motion explains change.** A card slides because it's new. A number morphs because it updated. Never animate for decoration.
2. **Motion is physics, not curves.** Default to springs (mass + stiffness + damping), not bezier timing functions. The eye reads spring as natural.
3. **Motion creates rhythm.** Page entrances stagger. Lists cascade. One focal moment at a time. Two simultaneous animations fighting for attention = none win.
4. **Motion respects the user.** `prefers-reduced-motion: reduce` cuts every duration to ≤ 50ms AND replaces translate/scale with opacity-only. No exceptions.
5. **Motion has a budget.** 16ms per frame, 60fps minimum. If an animation drops frames on a 2018 MacBook Air, it's wrong. GPU-only properties (`transform`, `opacity`, `filter`). Never animate `width`, `height`, `top`, `left`, `box-shadow` directly — use `transform: scale()` and layered shadow elements.

### 33.2 Easing & duration tokens (replaces §6 table)

**Spring presets (preferred default):**

| Token | mass | stiffness | damping | Feel | Use |
|-------|------|-----------|---------|------|-----|
| `spring.snap` | 0.4 | 320 | 24 | Crisp, no overshoot | Toggle, tab switch, checkbox |
| `spring.gentle` | 0.6 | 240 | 28 | Soft settle | Card mount, modal open |
| `spring.bouncy` | 0.8 | 200 | 16 | Slight overshoot, playful | Clawd reactions, success toast |
| `spring.slow` | 1.0 | 140 | 26 | Lazy settle | Hero entrance, page-level |

**Bezier fallback (use only when spring isn't available, e.g., widgets, CSS-only):**

| Token | Duration | Easing | Use |
|-------|----------|--------|-----|
| `ease.micro` | 80ms | `cubic-bezier(0.4, 0, 0.2, 1)` | Hover, focus ring |
| `ease.short` | 180ms | `cubic-bezier(0.32, 0.72, 0, 1)` | Tab swap, accordion |
| `ease.medium` | 320ms | `cubic-bezier(0.32, 0.72, 0, 1)` | Drawer, modal, page nav |
| `ease.long` | 600ms | `cubic-bezier(0.32, 0.72, 0, 1)` | First-paint orchestration |
| `ease.linear` | varies | `linear` | Indeterminate bar sweep, shimmer |

**Implementation:**
- Web: use `motion` (already in `package.json`) for springs. CSS variables hold bezier tokens. Expose all as `theme.motion.*` in a single `dashboard/src/lib/motion.js`.
- macOS: SwiftUI `Animation.interpolatingSpring(mass:, stiffness:, damping:)` matches values exactly. Centralize in `Motion.swift`.
- Widgets: bezier only via `withAnimation` in TimelineProvider transitions. No live animation inside the widget body.

### 33.3 Skeleton shimmers — four variants

Skeletons (§19.2) carry the loading state. The shimmer is the part that makes it not boring.

**A. Gradient sweep (default, all rectangular skeletons)**
- Base color: `var(--oai-gray-100)` (light) / `var(--oai-gray-800)` (dark).
- Sweep: linear gradient `90deg`, transparent → `rgba(255, 255, 255, 0.6)` at 50% → transparent. Width = 30% of skeleton width.
- Animation: `transform: translateX(-100%)` to `translateX(220%)`, 1.6s, `ease.linear`, infinite.
- Why this looks good: the highlight passes through, never sits. Eye reads it as "in progress" without strobing.

**B. Pulse (small skeletons, chips, dots)**
- `opacity: 0.5` to `opacity: 0.9` to `opacity: 0.5`, 1.4s, `ease.linear`, infinite.
- For elements < 80px wide where the sweep wouldn't read.

**C. Wave (heatmap skeleton, grid of cells)**
- Sweep moves diagonally across the grid, 2.4s cycle. Each cell brightens to `var(--brand-200)` opacity 0.4 then returns. Wave hits cells in row-by-row order with 40ms delay per row.
- Used in HeatmapWidget loading + dashboard heatmap on Compare/Yield.
- Implementation hint: per-cell `animation-delay` calculated from `(row * 40) + (col * 8)` ms.

**D. Trace (chart skeletons)**
- For line charts: the skeleton is a faint dashed line `var(--oai-gray-300)`, `stroke-dasharray: 4 4`. A 1.5px solid `var(--brand-400)` segment of 80px length slides along the path, masked. 2.2s linear infinite.
- For bar charts: bars render at full skeleton height but at `opacity: 0.4`. A "highlight" bar pulses to opacity 0.7 → 0.4 in sequence (left to right), 1.8s per cycle.
- For sparklines: trace from left edge with 1.5s draw-on, then fades to wait for data.

**Reduced motion:** all four variants → static base color, no animation.

### 33.4 Entrance choreography — staggered page reveal

When a page first loads, surfaces arrive in a deliberate order. This is the "composing itself in front of you" feel.

**Default page entrance:**

1. **0ms** — Page header (title, period picker) renders instantly. No animation. The user reads where they are.
2. **40ms** — Hero card mounts. `spring.slow` from `translateY(12px) + opacity(0)` to `translateY(0) + opacity(1)`. Slight scale `0.985 → 1`.
3. **120ms** — Sibling KPI cards stagger in. Each card uses `spring.gentle`, same translate/opacity. Stagger delay: 60ms per card.
4. **120ms + (n × 60ms)** — Below-the-fold cards (charts, tables) stagger in. Cap at 6 staggered items, then batch-fade the rest in over 200ms together.
5. **600ms** — Once main composition settles, Clawd entrance: spring-bounce from `scale(0.7) + opacity(0)` with `spring.bouncy`. Eyes blink twice.
6. **800ms** — Subtle freshness indicator pulse on cards with live data.

**Implementation (web, using `motion`):**

```js
// dashboard/src/lib/motion.js
export const stagger = {
  parent: { animate: { transition: { staggerChildren: 0.06, delayChildren: 0.04 }}},
  child: {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0, transition: { type: 'spring', mass: 0.6, stiffness: 240, damping: 28 }}
  }
};
```

Wrap card grids in `<motion.div variants={stagger.parent}>` and each card in `<motion.div variants={stagger.child}>`.

**Implementation (macOS):**

```swift
ForEach(cards.indices, id: \.self) { idx in
  CardView(cards[idx])
    .opacity(visible ? 1 : 0)
    .offset(y: visible ? 0 : 12)
    .animation(.interpolatingSpring(mass: 0.6, stiffness: 240, damping: 28).delay(Double(idx) * 0.06), value: visible)
}
.onAppear { visible = true }
```

**Reduced motion override:** no translate, no scale. Pure fade `opacity 0 → 1` over 80ms, no stagger (all cards fade simultaneously).

### 33.5 Data transitions — when to morph, when to snap

The rule from §10.5.3.C still holds for **live updates** of numeric data: numbers don't tick. But the question is broader. Here's the full matrix:

| Situation | Behavior |
|-----------|----------|
| First paint (skeleton → real data) | Cross-fade skeleton out (180ms) while real value fades in. Optionally count-up the number from 0 over 400ms using `ease.medium` — but only on first paint, never on update. |
| Live update of a number that changes < 1×/minute (today's spend) | Snap. The new value replaces the old. No animation. |
| Live update of a number that changes > 1×/second (tokens/sec) | Snap. Animation would lag behind reality. |
| Live update of a sparkline (new point arrives) | New point appears at right edge with spring-bounce. Existing points slide left by 1 step over 600ms `ease.medium`. |
| Live update of a bar in a bar chart (value changes) | Bar resizes via `transform: scaleY()` with `spring.gentle`. 320ms. Other bars stay still. |
| Live update of a segmented bar (provider mix shifts) | Each segment width animates with `spring.gentle`, 240ms. Provider order does not reorder mid-animation (avoids flicker). |
| Half-gauge updates | Arc length animates with `spring.gentle`, 320ms. Center number snaps. |
| Status pill changes (Running → Idle) | Pill background cross-fades 180ms. Text snaps. |
| Provider limit bar crosses a threshold (green → amber → red) | Bar color cross-fades over 300ms `ease.medium`. Width animation finishes first, then color shift. |
| Confidence badge changes | Crossfade 180ms. The shape doesn't morph. |
| Row arrives in a sortable list (new session) | Row inserts at top with `spring.gentle` translate-from-above + opacity, 280ms. Existing rows shift down. |
| Row leaves a list | Translate-out to right + opacity 0, 220ms `ease.short`. |

### 33.6 Hover, focus, active — micro-interactions

The page rewards exploration. Every interactive element responds, but quietly.

| Target | State | Animation |
|--------|-------|-----------|
| Card (interactive) | hover | `transform: translateY(-1px)` + shadow expand from `var(--vd-shadow)` to `0 4px 12px rgba(49, 46, 106, 0.10)`. 120ms `ease.micro`. Reverses on leave. |
| Button (primary) | hover | Background color shift `--brand-600 → --brand-700`. 120ms. Slight `transform: translateY(-1px)`. |
| Button (primary) | active (mouse down) | `transform: scale(0.97)`. 80ms. Releases on mouse up. |
| Button | focus (keyboard) | Focus ring expands: `box-shadow: 0 0 0 2px var(--vd-ring)` with 0px → 2px ring growth over 80ms. |
| List row | hover | `bg-[var(--vd-tint)]` cross-fade 120ms. Trailing chevron `→` slides 2px right (translateX 2px) 180ms. |
| List row | click (before nav) | Brief flash `bg-[var(--vd-tint-strong)]` 80ms before drawer opens. |
| Icon button | hover | Background circle scales `0.92 → 1.0` 120ms. |
| Provider logo | hover (where clickable) | Slight scale `1.0 → 1.06` 180ms `spring.snap`. |
| Tab in segmented control | switch | Active indicator slides under the new tab with `spring.gentle` 280ms (layoutId pattern). Tab labels snap. |
| Toggle switch | toggle | Thumb slides with `spring.bouncy` 240ms. Track color cross-fades 180ms. |
| Period picker | open | Popover scales from `0.96` at trigger anchor + fades in. 120ms `ease.micro`. |
| Drawer | open | Slides from `translateX(100%) → 0` over 280ms `spring.gentle`. Scrim fades to 0.32 over 280ms. Page content behind blurs `0 → 2px` over 200ms. |
| Drawer | close | Reverse, 240ms (slightly faster than open). |
| Modal | open | Backdrop fades 200ms. Card scales `0.94 → 1.0` + fades, 320ms `spring.gentle`. |
| Toast (success / info) | appear | Slides from below the viewport with `spring.bouncy` + fades, 320ms. Auto-dismiss after 4s with reverse + slight slide-right. |

### 33.7 Chart entrances — make data feel earned

Charts get the most theatrical treatment. They're the page's payoff.

**Sparkline (Pattern A):**
- Skeleton: dashed gray path.
- On data arrive: solid stroke draws left-to-right via `stroke-dasharray` animation. Duration: `Math.min(800, points × 40)`ms, `ease.medium`.
- After draw completes (+200ms delta): hover dot fades in if hovered, otherwise the line just sits.

**Area chart (Pattern B):**
- Same as sparkline for the top stroke.
- Gradient fill below: fades from `opacity 0` to `opacity 1` over 400ms, starts 200ms after stroke completes.
- Forecast dashed extension draws AFTER the solid section completes, 400ms slower.

**Stacked bar (Pattern C):**
- Each bar grows from baseline (`scaleY: 0 → 1`, `transform-origin: bottom`). `spring.gentle` 380ms.
- Stagger across bars: 30ms per bar left-to-right. Cap stagger at 12 bars total, then batch-grow the rest.
- Each stack segment within a bar animates `0 → final height` in sequence, bottom-to-top, 40ms apart.

**Horizontal bar (Pattern D, ranked list):**
- Bars grow from left edge (`scaleX: 0 → 1`, `transform-origin: left`). `spring.gentle` 320ms.
- Stagger top-to-bottom: 40ms per row. Numbers (cost, %) count-up from 0 to final value over the duration of the bar's animation. Cap count-up to 800ms.

**Heatmap (Pattern E):**
- Cells fade-in from `opacity: 0` to final. Stagger by `(row × 30) + (col × 8)` ms — gives a wash-across-the-grid feel.
- After mount completes, "current week" cells briefly pulse (scale 1.0 → 1.06 → 1.0) once over 600ms.

**Ring / donut (Pattern F):**
- Arc draws from `stroke-dasharray 0` to final length. `spring.gentle` 600ms.
- Background ring fades in 200ms before the arc starts.
- Center number counts up from 0 to value, synced to arc duration.

**Reduced motion override for all charts:** no draw/grow. Render in final state with a 180ms opacity fade.

### 33.8 Live signals — the heartbeat of the dashboard

These ambient animations run continuously (or while their underlying state is "live"). They create the feeling that the app is alive without making it feel busy.

**A. Live tick pulse**
- 8px brand-colored dot.
- Outer ring expands from `box-shadow: 0 0 0 0 var(--brand-500)` to `0 0 0 8px transparent`, 1.6s linear infinite.
- Dot itself stays static.
- Active whenever the parent surface has live data (LIVE freshness label).

**B. Status diode breathing**
- For healthy/warning/danger diodes that are passive ambient indicators.
- `opacity: 1 → 0.65 → 1`, 3.2s `ease.linear`. Slower than live tick — feels like steady breath, not heartbeat.
- Only animate the diode if there are active sessions. When idle, diodes are static.

**C. Sync icon during sync**
- Refresh icon rotates `0deg → 360deg`, 1.0s linear infinite.
- On sync complete: one final 360° rotation transitions to a green check that fades in (cross-fade 180ms), holds 1.2s, then cross-fades back to the refresh icon.

**D. Menubar icon pulse (active sessions)**
- Icon opacity `0.6 → 1.0 → 0.6`, 1.6s `ease.linear`, only while active sessions exist.
- Reduced motion: replace with a tiny dot in the corner of the icon (static).

**E. Indeterminate progress bar (Pattern F from §10.5.1)**
- Indigo block 30% width, slides `translateX(-50%) → translateX(220%)`, 1.2s `ease.linear` infinite.
- Reduced motion: static 100% width bar at `var(--brand-300)` opacity 0.6.

**F. Card "fresh data arrived" pulse**
- When a card's freshness indicator flips from `4m ago` back to `● LIVE` (data just refreshed): card briefly outlines with `box-shadow: 0 0 0 2px var(--brand-300)`, expands to `4px transparent`, 800ms. Once, not infinite.
- Subtle but rewarding — users notice the page just got fresher.

### 33.9 Page transitions — moving between routes

When the user navigates between pages (Live → Optimize, Settings → Dashboard, etc.):

- Outgoing page: fades to `opacity: 0` + slight translate `translateY(-4px)`, 180ms `ease.short`.
- Incoming page: starts at `opacity: 0` + `translateY(8px)`, settles to final with `spring.gentle`, 320ms total.
- 60ms overlap between out and in (slight cross-fade window).
- Page header (title + period picker) animates separately and FIRST — appears at 0ms with `ease.short`. The user always knows where they are immediately.
- After page composition completes, the staggered card entrance (§33.4) begins.

**Total transition time: ~500ms.** Feels deliberate, not laggy.

**Same-page state changes** (filter switch, period change): no full page transition. Only the affected cards animate (skeleton-shimmer for ~200ms while data refetches, then chart re-draws via §33.7).

### 33.10 Clawd animations — already orchestrated, don't fight them

Clawd has 39 hand-keyed SVG states already. The motion rule: **don't add CSS transitions on top of them.** They're frame-keyed pixel art; smoothing them ruins the pixel feel.

What VibeDeck adds:
- State transitions (idle-living → working-typing): cross-fade between SVGs over 180ms.
- Entrance: scale `0.7 → 1.0` with `spring.bouncy`, opacity `0 → 1`, 400ms.
- Hover: gentle scale `1.0 → 1.04` with `spring.snap`, 200ms.
- Tap: nudge to `react-double` (the SVG state itself handles the bounce), return to current state after 600ms.

**Already-animated within SVG (don't touch):** blink loop, idle micro-movements, working motion. Clawd's internal animations run on `<animate>` SMIL or keyframed CSS inside the SVG.

### 33.11 Drawer / modal / popover specifics

**Side drawer (§18.1):**
- Open: slide from `translateX(100%) → 0` with `spring.gentle`, 280ms. Scrim fades to 0.32 alpha over same duration. Page behind blurs `0 → 2px` (use `backdrop-filter` on the scrim).
- Close: reverse, 240ms (faster) — closing should feel snappier than opening.
- Content inside drawer staggers in: header at 80ms, body at 160ms, footer at 240ms. Each with 12px Y-translate + opacity.
- ESC, click-outside, close button all use the same animation.

**Modal:**
- Backdrop fades in 200ms.
- Card: scale `0.94 → 1.0` + `translateY(8px) → 0` + opacity, 320ms `spring.gentle`. Origin: center of viewport.
- Reduced motion: opacity-only, 120ms.

**Popover:**
- Scale `0.96 → 1.0` + opacity, 120ms `ease.micro`. Origin: near the trigger element (use `transform-origin` based on trigger anchor — top-right, top-left, bottom-right, bottom-left).
- Close: scale `1.0 → 0.97` + opacity to 0, 100ms.
- Menu items inside popover stagger in only on first open of the session (subsequent opens snap). Stagger: 20ms per row, opacity-only.

**Toast:**
- Appears from below the viewport: `translateY(60px) → 0` + opacity + slight scale `0.94 → 1.0`, `spring.bouncy` 320ms.
- Auto-dismiss after 4s. Departure: translate-right `0 → 80px` + fade, 240ms `ease.short`.
- Stack: when multiple toasts queue, each pushes the previous up by `60px + 8px gap` with spring.

### 33.12 Per-surface motion budget

Different surfaces, different motion budgets.

**Dashboard (web):**
- Full motion catalog enabled.
- Targets 60fps on a 2018 MacBook Air with Chrome.
- Profile with Chrome DevTools Performance tab; any animation that drops below 60fps gets the GPU-acceleration treatment (`will-change: transform`) or its duration cut.
- One focal animation at a time. If a drawer is opening, the staggered card entrance pauses.

**macOS app:**
- Native SwiftUI animations are nearly free. Use generously.
- Avoid `.animation(_, value:)` on properties that update every frame from `@Published` observables — wrap in `withAnimation` blocks only at intentional moments.
- The DashboardView's section dividers and card entrances mirror web's staggered reveal.
- ClawdCompanionView already has its own animation budget — see existing implementation, do not add more.

**Widgets:**
- **No live animation.** WidgetKit doesn't support it (timelines are static snapshots).
- The only allowed motion: SwiftUI's automatic transition between timeline entries when the widget refreshes. This is a `.transition(.opacity)` cross-fade.
- Make this transition feel intentional: when numbers change between snapshots, the cross-fade does the work — don't try to count-up the number or slide it.
- Refresh cadence (5 min) means most users will see the transition naturally during the day.
- Reduced motion: no transition; new snapshot snaps in.

### 33.13 First-launch animations — the "wow" moment

The first time a user opens VibeDeck after install (or first time on a new device), give them a slightly more elaborate entrance once:

**Dashboard first-launch:**
1. Three-plane logo mark renders centered, full-size (160px), at `scale(0.7) + opacity(0)`. Springs in `spring.slow`, 800ms.
2. Each of the three planes' colors shift to their indigo values in sequence (top plane first, then middle, then bottom). 200ms per plane.
3. Logo zooms back to its header size (`scale(0.24)`) and translates to top-left corner. `spring.slow` 700ms.
4. Page header appears (wordmark + title) at 1.5s.
5. Cards stagger in per §33.4, but with longer delays (100ms between cards instead of 60ms) and `spring.slow` instead of `spring.gentle`.
6. Clawd enters last at 3.2s with `mini-happy` then transitions to `idle-living`.

Total first-launch sequence: ~4 seconds. Stored as a one-time flag in localStorage (`vd-first-launch-seen`). Skip entirely on subsequent loads.

**macOS first-launch:** mirror in `WindowGroup`'s `onAppear`, with the same one-time flag in `UserDefaults`.

### 33.14 Reduced motion — the full override

When `prefers-reduced-motion: reduce` is set, every animation in this section is replaced as follows:

| Animation type | Reduced-motion equivalent |
|----------------|---------------------------|
| Shimmer (sweep, pulse, wave, trace) | Static base color, no animation. |
| Stagger entrance | All cards opacity 0 → 1 simultaneously, 80ms, no translate. |
| Spring transitions | Linear opacity transitions, 120ms max. |
| Translate + scale on mount | Opacity-only. |
| Number count-up | Final value renders immediately. |
| Chart draw-on | Final state, opacity fade 120ms. |
| Live tick pulse | Static brand-colored dot. |
| Status diode breathing | Static. |
| Sync icon rotation | Replaced with text "Syncing…" or a static spinner image. |
| Menubar icon pulse | Static icon with a small dot indicator. |
| Indeterminate bar | Static full-width bar at brand-300 opacity 0.6. |
| Drawer slide | Drawer renders in place with 120ms opacity fade. No translate. Scrim fades same duration. |
| Modal scale | Opacity-only, 120ms. |
| Popover scale | Opacity-only, 100ms. |
| Toast | Opacity-only, 180ms. |
| Page transition | Cross-fade, 180ms. |
| Clawd transitions | SVG state changes snap (no cross-fade). Internal Clawd animations remain (they're SMIL inside the SVG; SMIL respects `prefers-reduced-motion` via CSS-level disable). |
| First-launch sequence | Skip entirely. Render final state. |

**Implementation rule:** every component that animates MUST check `useReducedMotion()` (web) or `accessibilityReduceMotion` (macOS) and switch to the override. Audit at code review.

### 33.15 Performance audit checklist

Before merging any animation:

- [ ] Uses `transform` and `opacity` only (no `width`/`height`/`top`/`left`/`box-shadow`).
- [ ] Stays at 60fps on 2018 MacBook Air running Chrome (test in DevTools Performance tab).
- [ ] Animation duration ≤ 800ms unless it's a one-time first-launch sequence.
- [ ] No animation runs longer than 4 seconds total on any single user interaction.
- [ ] No infinite animations are visible if the surface is off-screen (use IntersectionObserver to pause).
- [ ] `prefers-reduced-motion` override is implemented and tested.
- [ ] Animation respects `display: none` ancestors (no orphan timers running).
- [ ] On macOS: animations don't block the main thread; use `Task.detached` for heavy work mid-animation.
- [ ] On widgets: no animation inside widget body, only timeline transitions.

### 33.16 What "natural-looking" means in practice — concrete examples

- A bar growing from `0` to its value should feel like it's settling into place. That's `spring.gentle` with damping `28` — overshoots by maybe 2px, comes back. Linear bezier `cubic-bezier(0.4, 0, 0.2, 1)` grows the bar but ends abruptly — it looks scripted. Springs look earned.
- A card mounting should feel like it's arriving from slightly below, not sliding in from the side. Side-slides are 2014 mobile patterns; below-rise is 2024 native feel.
- Numbers should never tick up during live use. The user is reading their own burn rate; they want truth, not theatre. The only exception is the very first paint (skeleton → real value) where a 400ms count-up sells the moment.
- Hover lifts should be 1px, not 4px. The lower the lift, the more expensive the product feels. Cheap dashboards lift cards 8px on hover; real software lifts 1-2px.
- Sync animations should celebrate completion (sync icon → green check → reset). They should not run forever. Users mistake forever-spinners for the app being broken.
- Live tick pulses should breathe, not strobe. 1.6s cycle is the sweet spot (matches resting human heart rate). 800ms feels anxious; 2.4s feels lazy.
- Drawers should open slightly slower than they close. Open with intent (280ms), close with speed (240ms). The user expects "I'm done with this" to be more responsive than "show me this."

This whole section, in one sentence: **make things move because they have somewhere to go, not because they can.**

---

## 15. Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-05 | Indigo-slate palette (`#5b5fc7`) replacing emerald/teal | Original teal was "too aggressive," didn't blend with grey/black UI. Logged in `project_palette_rework.md`. |
| 2026-05 | Plus Jakarta Sans + Outfit + JetBrains Mono | Replaced DM Sans/Inter pairing. Outfit's rounded geometry differentiates from every Inter-based dev tool. |
| 2026-05 | All neutrals OKLCH with `264` hue | Indigo undertone in greys keeps the accent in family. |
| 2026-05-27 | DESIGN.md authored — locks logo palette across Dashboard, macOS app, Widgets | User directive: "just keep the logo colour." Three surfaces, one source of truth, covering 1.0.4 API additions (Optimize, Plan, Live actionable surfaces, provider breadth, analytics surfaces). |
| 2026-05-27 | EntirePage (and all checkpoint inspector / repo command center surfaces) removed from scope | User commented out the Entire feature's UI, setup, and backend. Not shipping in this revamp. |
| 2026-05-27 | Provider logos (not color dots) become the canonical provider identity in UI | 12 local SVGs already in `dashboard/public/brand-logos/`. Dots reserved for status, not identity. |
| 2026-05-27 | Motion system spec'd (§33) — springs over beziers as the default | Springs read as natural; beziers read as scripted. The product needs to feel alive and earned. Reduced-motion override is mandatory. |
