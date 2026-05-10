# VibeDeck v1 — Plan 5 Dashboard UI Design

> **Status:** Drafted after backend Plan 4 completion. This spec covers the web dashboard only. Native macOS app UI work is deferred to a later Phase 6 spec/plan.

## Goal

Make VibeDeck's dashboard a Live Workbench-first product while preserving the existing TokenTracker-derived usage analytics. The new dashboard should surface active sessions, branch attribution confidence, Entire state, and correction workflows as the product's first screen, without rewriting the current heatmap/trend/model/cost components.

## Non-Goals

- Do not rewrite the existing usage dashboard components.
- Do not remove the current heatmap, trend chart, usage overview, cost modal, model breakdown, daily table, limits page, widgets page, or settings page.
- Do not replace the existing `AppLayout` / `Sidebar.jsx` shell.
- Do not remove Light / Dark / System theme support.
- Do not add macOS native panels in this plan.
- Keep backend changes narrow. Plan 5 may add the read-only dashboard data endpoints required for Branches and VibeDeck Skills naming, but must not alter parser math, attribution semantics, or write-side runtime contracts unless explicitly called out in this spec.

## Product Direction

The dashboard opens on live work, not historical totals. VibeDeck's backend differentiation is session attribution: which tool ran, in which repo, on which branch, with what confidence, at what token/cost burn. The first screen should answer:

- What agent sessions are active right now?
- Which repo and branch are they attached to?
- How trustworthy is that attribution?
- What needs correction?
- Is Entire active for the repo, and are checkpoints available?

Historical usage analytics remain first-class, but move behind a dedicated Usage page.

## Existing UI To Preserve

Reuse the current dashboard component language and shell:

- `dashboard/src/ui/openai/components/Sidebar.jsx` and `AppLayout`
- `dashboard/src/ui/openai/components/*` primitives (`Button`, `Card`, `ConfirmModal`, `Input`, etc.)
- `dashboard/src/ui/foundation/*` motion/foundation pieces
- `dashboard/src/ui/matrix-a/components/ActivityHeatmap.jsx`
- `TrendMonitor`, `UsageOverview`, `ProjectUsagePanel`, `DataDetails`, `CostAnalysisModal`
- `UsageLimitsPanel`, `LimitsPage`, `WidgetsPage`, `SettingsPage`
- Current `ThemeProvider`, `useTheme`, Light / Dark / System behavior

New work should compose these pieces before creating new primitives.

## Visual Identity

Plan 5 includes a restrained VibeDeck identity pass:

- Replace visible TokenTracker naming in dashboard chrome with VibeDeck.
- Add a VibeDeck logo mark in the sidebar/header area.
- Define updated brand tokens for both light and dark mode in the existing token system.
- Keep the existing UI density, panel shape, and interaction style.
- Use lucide icons for new nav/actions, matching current sidebar buttons.
- Preserve System theme mode by continuing to derive from OS preference through existing theme plumbing.

The design should feel like the current dashboard matured into a session/workbench product, not like a different app.

## Navigation

Reuse the existing collapsible sidebar and mobile drawer. The nav groups become:

### Work

- `Live` → `/dashboard` and `/`
- `Usage` → `/usage`
- `Branches` → `/branches`

### Control

- `Entire` → `/entire`
- `Skills` → `/skills`

### System

- `Limits` → `/limits`
- `Widgets` → `/widgets`
- `Settings` → `/settings`

Recommended lucide icons:

- Live: `Radio`, `Activity`, or `CircleDot`
- Usage: `BarChart3`
- Branches: `GitBranch`
- Entire: `GitCommitGraph` or `Workflow`
- Skills: `Puzzle`
- Limits: `Gauge`
- Widgets: `LayoutGrid`
- Settings: `Settings`

## Page Specs

### Live Workbench (`/`, `/dashboard`)

Purpose: show current agent sessions and attribution health.

Data sources:

- `GET /functions/vibedeck-sessions-live` (SSE)
- `GET /functions/vibedeck-attribution-stats`
- `POST /functions/vibedeck-attribute`
- `GET /functions/vibedeck-entire-status?repo=<repo>&cached=1`
- `GET /functions/vibedeck-branch-usage` for recent branch/repo options when active sessions are empty

Main regions:

- Session list: active sessions from the SSE snapshot and deltas.
- Session detail rail: selected session metadata and correction controls.
- Attribution health card: high/medium/low/unattributed counts.
- Repo / Entire card: status for the selected session repo.
- Empty state: "No live sessions" with links to Usage and sync.

Session row fields:

- Provider icon + provider name
- Session ID short form
- Repo root basename and full path tooltip
- Branch
- Branch resolution tier (`A`, `B`, `C`, `D`, `OVERRIDE`)
- Confidence (`high`, `medium`, `low`, `unattributed`)
- Model
- Total tokens
- Total cost
- Started time and last observed/updated time
- State: live, ended, stale, disconnected

Correction controls:

- For low/unattributed rows, show branch override action.
- `POST /functions/vibedeck-attribute` body:
  - `{ provider, session_id, branch }` to set override
  - `{ provider, session_id, branch: null }` to clear override
- Mutations use existing local auth header helper.
- After mutation, the row should visually indicate `OVERRIDE/high`.

SSE behavior:

- Initial event type: `snapshot`
- Delta event types: `session:start`, `session:update`, `session:end`
- Display `last_observed_at` when present for providers without cwd.
- Show degraded state if SSE fails, hits 503 client cap, or reconnects.
- Backpressure `dropped` count should surface as a small warning when non-zero.

### Usage (`/usage`)

Purpose: preserve current historical analytics.

Implementation direction:

- Move or wrap the existing `DashboardPage`/`DashboardView` behavior as the Usage page.
- Keep heatmap, trend, overview, top models, project usage, cost modal, daily/monthly/hourly detail tables, manual sync, and install prompts.
- Update copy and route labels from Dashboard/TokenTracker phrasing to Usage/VibeDeck where needed.
- Do not change token math or parser assumptions.

### Branches (`/branches`)

Purpose: show cost by repo and branch with confidence context.

Data source:

- `GET /functions/vibedeck-branch-usage`

Required experience:

- Repo selector sourced from exposed branch/session attribution data.
- Branch table grouped by repo.
- Branch rows show tokens, cost, session count, confidence mix, and recent activity.
- Drill into sessions for a branch.
- Confidence is always visible. Fuzzy branch attribution must not be presented as ground truth.

Required backend surface:

- Plan 5 must expose a read-only branch aggregate endpoint before building the Branches page.
- Endpoint name: `GET /functions/vibedeck-branch-usage`
- Query params:
  - `from`, `to` (optional date range)
  - `repo` (optional absolute repo path filter)
  - `branch` (optional branch filter)
  - `limit` (optional row cap)
- Response shape:
  - `{ repos: [{ repo_root, branches: [...] }], totals: {...} }`
  - Each branch row includes `branch`, `total_tokens`, `total_cost_usd`, `session_count`, `last_seen_at`, and confidence counts: `high`, `medium`, `low`, `unattributed`.
- Source tables: `vibedeck_sessions`, `vibedeck_session_branch_windows` where available.
- Read-only only. No mutation, no auth required.

Do not fake branch totals from unrelated daily/project usage data.

### Entire (`/entire`)

Purpose: manage Entire per repo from the dashboard.

Data/actions:

- `GET /functions/vibedeck-entire-status?repo=<repo>&cached=1`
- `GET /functions/vibedeck-checkpoints?repo=<repo>`
- `GET /functions/vibedeck-checkpoint?repo=<repo>&path=<path>`
- `POST /functions/vibedeck-entire/enable`
- `POST /functions/vibedeck-entire/disable`
- `POST /functions/vibedeck-entire/agent-add`
- `POST /functions/vibedeck-entire/agent-remove`
- `POST /functions/vibedeck-entire/configure`
- `POST /functions/vibedeck-entire/doctor`
- `POST /functions/vibedeck-entire/status`
- `POST /functions/vibedeck-confirm-destructive`
- `POST /functions/vibedeck-entire/rewind`
- `POST /functions/vibedeck-entire/clean`

Repo selection:

- The dashboard can enable Entire for a repo by sending `{ repo, agents }` to `/functions/vibedeck-entire/enable`.
- Since there is no general "list all historical repos" endpoint today, the UI should provide:
  - recently seen repos from active/live session data when available,
  - manual absolute path input,
  - validation and clear error states for missing/non-repo paths.
- A richer repo picker is a backend/API gap, not a Plan 5 assumption.

Entire state labels:

- `not_installed`: Entire CLI not found; show install/help copy.
- `not_enabled`: Entire exists, repo is not enabled; show Enable action.
- `enabled_no_commits`: Entire enabled, no checkpoint branch tip; show waiting/doctor action.
- `active`: Entire enabled and checkpoint branch tip exists; show checkpoints.

Checkpoint detail:

- List checkpoint files from `vibedeck-checkpoints`.
- Detail defaults to metadata-oriented display.
- Any transcript or sensitive content must be behind an explicit click.

Destructive flows:

- Rewind and clean require a confirmation modal.
- Before destructive call, request token from `vibedeck-confirm-destructive` with op:
  - `rewindCheckpoint`
  - `cleanEntire`
- Then call the destructive endpoint with `confirm_token`.
- Single-use / expired token errors must be displayed and recoverable.

Advanced raw action:

- Entire `configure` remains an advanced raw action in Plan 5.
- The dashboard may expose it behind an "Advanced" disclosure with argv-style inputs, validation, and command output.
- Do not turn `configure` into a friendly telemetry-only toggle in Plan 5.

### Skills (`/skills`)

Purpose: preserve and modernize existing skill management.

Current page already has browse/install/target-toggle behavior. Plan 5 should:

- Keep the current component structure where possible.
- Use VibeDeck-named endpoints for installed skill list, discovery/search, repo management, and mutations:
  - `GET /functions/vibedeck-skills`
  - `GET /functions/vibedeck-skills?mode=installed`
  - `GET /functions/vibedeck-skills?mode=repos`
  - `GET /functions/vibedeck-skills?mode=discover`
  - `GET /functions/vibedeck-skills?mode=search&q=<query>`
  - `POST /functions/vibedeck-skills/install`
  - `POST /functions/vibedeck-skills/uninstall`
  - `POST /functions/vibedeck-skills/restore`
  - `POST /functions/vibedeck-skills/importLocal`
  - `POST /functions/vibedeck-skills/deleteLocal`
  - `POST /functions/vibedeck-skills/addRepo`
  - `POST /functions/vibedeck-skills/removeRepo`
- Plan 5 must mirror any currently legacy-only Skills discovery/search/repo-management behavior under `vibedeck-skills`.
- The dashboard should not call `tokentracker-skills` after this plan.

### Limits / Widgets / Settings

Keep these pages functionally stable. Apply only:

- VibeDeck naming/copy updates.
- Token/logo/theme consistency.
- Navigation integration.
- Any required local-auth copy cleanup.

## Endpoint Coverage Checklist

| Endpoint | Dashboard Surface | Status |
|---|---|---|
| `GET /api/local-auth` | shared auth helper for local mutations | required |
| `POST /functions/tokentracker-local-sync` | Usage and Live sync actions | existing helper |
| `GET /functions/vibedeck-branch-usage` | Branches page + Live repo suggestions | new read-only endpoint + helper |
| `GET /functions/vibedeck-sessions-live` | Live Workbench session stream | new hook/component |
| `POST /functions/vibedeck-attribute` | Live correction controls | new helper + modal/form |
| `GET /functions/vibedeck-attribution-stats` | Live attribution health card | new helper + card |
| `GET /functions/vibedeck-entire-status` | Live repo card + Entire page | new helper + labels |
| `GET /functions/vibedeck-checkpoints` | Entire checkpoint list | new helper + list |
| `GET /functions/vibedeck-checkpoint` | Entire checkpoint detail | new helper + detail |
| `POST /functions/vibedeck-entire/enable` | Entire Add/Enable repo flow | new helper + form |
| `POST /functions/vibedeck-entire/disable` | Entire repo control | new helper + confirm |
| `POST /functions/vibedeck-entire/agent-add` | Entire agent management | new helper |
| `POST /functions/vibedeck-entire/agent-remove` | Entire agent management | new helper |
| `POST /functions/vibedeck-entire/configure` | Entire advanced raw action | advanced disclosure + output panel |
| `POST /functions/vibedeck-entire/doctor` | Entire diagnostics action | new helper + output panel |
| `POST /functions/vibedeck-entire/status` | Entire raw status action | new helper + output panel |
| `POST /functions/vibedeck-confirm-destructive` | Rewind/clean confirmation | new helper |
| `POST /functions/vibedeck-entire/rewind` | Checkpoint rewind | destructive modal |
| `POST /functions/vibedeck-entire/clean` | Entire clean | destructive modal |
| `GET /functions/vibedeck-skills` | Skills installed/discover/search/repos | mirror legacy modes under VibeDeck name |
| `POST /functions/vibedeck-skills/*` | Skills mutations and repo management | update existing page |
| `GET/POST /functions/tokentracker-skills` | Legacy Skills endpoint | dashboard stops calling this endpoint |

## Copy And Labels

Every new endpoint state needs user-facing labels:

- `db_unavailable`
- `too_many_clients`
- `not_installed`
- `not_enabled`
- `enabled_no_commits`
- `active`
- `branch_not_fetched`
- `git_error`
- `invalid_repo`
- `invalid_path`
- `missing_repo`
- `missing_confirm_token`
- `invalid_confirm_token`
- `unknown_command`
- `session_not_found`
- Branch aggregate empty range / no repo rows

Use `dashboard/src/content/copy.csv` for visible strings. Avoid hardcoded visible text in JSX except test-only labels.

## Theme Requirements

- Preserve current Light / Dark / System behavior.
- New tokens must be defined for both `:root` and `:root.dark`.
- New components must use existing theme variables or Tailwind dark variants.
- New logo must work on light, dark, and native transparent backgrounds.
- Tests or screenshots must cover light and dark at minimum.

## Reliability Requirements

New dashboard features must include:

- Loading states
- Empty states
- Error states
- Offline/server unavailable states
- Local auth failure states
- Mutation in-progress states
- SSE reconnect/degraded state
- Reduced-motion compatibility

## Testing Requirements

Required test categories:

- Route tests for `/`, `/dashboard`, `/usage`, `/branches`, `/entire`, `/skills`.
- API helper tests for every new helper.
- Backend tests for `GET /functions/vibedeck-branch-usage`.
- Backend tests for VibeDeck Skills discovery/search/repo-management modes.
- SSE parser/hook tests for snapshot, update, end, reconnect, dropped events, and 503 cap handling.
- Live Workbench tests for confidence labels and override actions.
- Entire page tests for all four repo states and destructive-token flow.
- Skills page tests verifying VibeDeck endpoint use for installed, discovery/search, repo management, and mutation paths.
- Theme tests for Light / Dark / System control preservation.
- Copy validation.
- UI hardcode validation.
- Dashboard build.

## Implementation Sequencing

The implementation plan should split work into independently reviewable phases:

1. Route/nav/identity scaffolding.
2. Shared VibeDeck dashboard API helpers.
3. Read-only `vibedeck-branch-usage` endpoint.
4. Live Workbench read-only session stream.
5. Live correction actions and attribution health.
6. Usage page re-home with existing analytics preserved.
7. Entire page repo/status/checkpoint views.
8. Entire write/destructive flows, including advanced raw configure.
9. VibeDeck Skills endpoint modernization.
10. Branches page backed by `vibedeck-branch-usage`.
11. Final polish, theme QA, copy pruning, build/test validation.

## Locked Decisions For Implementation Plan

- `/branches` must be backed by exposed branch attribution data through `GET /functions/vibedeck-branch-usage`.
- Skills discovery/search/repo management must be mirrored under `vibedeck-skills`; dashboard code should stop calling `tokentracker-skills`.
- Entire `configure` is an advanced raw action in Plan 5, not a simplified telemetry-only toggle.
