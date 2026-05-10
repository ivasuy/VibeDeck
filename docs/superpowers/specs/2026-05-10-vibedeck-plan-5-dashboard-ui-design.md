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
- Do not build a new backend in Plan 5. If a UI requirement exposes a missing backend read/write surface, document it as a Plan 4 amendment or follow-up.

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

Required experience:

- Repo selector sourced from available session data.
- Branch table grouped by repo.
- Branch rows show tokens, cost, session count, confidence mix, and recent activity.
- Drill into sessions for a branch.
- Confidence is always visible. Fuzzy branch attribution must not be presented as ground truth.

Backend coverage note:

- Current exposed endpoints do not provide a dedicated historical branch aggregate endpoint.
- The implementation plan must first verify whether existing local API endpoints can produce branch aggregate data.
- If not, this page should either:
  - ship an MVP using available session/attribution data only where exposed, or
  - record a small Plan 4 amendment for a read-only branch aggregate endpoint before implementation.

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

### Skills (`/skills`)

Purpose: preserve and modernize existing skill management.

Current page already has browse/install/target-toggle behavior. Plan 5 should:

- Keep the current component structure where possible.
- Prefer new VibeDeck endpoints for installed skill list and mutations:
  - `GET /functions/vibedeck-skills`
  - `POST /functions/vibedeck-skills/install`
  - `POST /functions/vibedeck-skills/uninstall`
  - `POST /functions/vibedeck-skills/restore`
  - `POST /functions/vibedeck-skills/importLocal`
  - `POST /functions/vibedeck-skills/deleteLocal`
- Keep legacy `tokentracker-skills` only where discovery/search/repo management is not yet mirrored by `vibedeck-skills`.
- Label this split clearly in code comments and tests so the endpoint migration is intentional.

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
| `POST /functions/vibedeck-entire/configure` | Entire advanced settings | optional in Plan 5 MVP unless needed for telemetry toggle |
| `POST /functions/vibedeck-entire/doctor` | Entire diagnostics action | new helper + output panel |
| `POST /functions/vibedeck-entire/status` | Entire raw status action | new helper + output panel |
| `POST /functions/vibedeck-confirm-destructive` | Rewind/clean confirmation | new helper |
| `POST /functions/vibedeck-entire/rewind` | Checkpoint rewind | destructive modal |
| `POST /functions/vibedeck-entire/clean` | Entire clean | destructive modal |
| `GET /functions/vibedeck-skills` | Skills installed list | update existing page |
| `POST /functions/vibedeck-skills/*` | Skills mutations | update existing page |
| `GET/POST /functions/tokentracker-skills` | Skills discovery/search/repo management fallback | keep intentionally until mirrored |

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
- SSE parser/hook tests for snapshot, update, end, reconnect, dropped events, and 503 cap handling.
- Live Workbench tests for confidence labels and override actions.
- Entire page tests for all four repo states and destructive-token flow.
- Skills page tests verifying VibeDeck endpoint use for installed/mutation paths and intentional legacy fallback for discovery/search.
- Theme tests for Light / Dark / System control preservation.
- Copy validation.
- UI hardcode validation.
- Dashboard build.

## Implementation Sequencing

The implementation plan should split work into independently reviewable phases:

1. Route/nav/identity scaffolding.
2. Shared VibeDeck dashboard API helpers.
3. Live Workbench read-only session stream.
4. Live correction actions and attribution health.
5. Usage page re-home with existing analytics preserved.
6. Entire page repo/status/checkpoint views.
7. Entire write/destructive flows.
8. Skills endpoint modernization.
9. Branches page MVP or API-gap resolution.
10. Final polish, theme QA, copy pruning, build/test validation.

## Open Questions For Implementation Plan

- Whether `/branches` can ship from exposed data or needs a small read-only backend amendment.
- Whether Skills discovery/search should remain on `tokentracker-skills` for Plan 5 or be mirrored to `vibedeck-skills` before dashboard implementation.
- Whether Entire `configure` should expose only telemetry toggle in Plan 5 or stay as an advanced/raw action.

