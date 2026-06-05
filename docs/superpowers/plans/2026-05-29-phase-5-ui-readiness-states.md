# Phase 5 UI Readiness States Implementation Plan

> Writingplans fallback: `$writingplans` is not installed in this workspace, so this plan follows the repo's `docs/superpowers/plans` format and AGENTS task contract.

**Goal:** Let dashboard and native surfaces render instantly from snapshot/partial data while clearly labeling indexing state.

## Task P5-T1 Dashboard Freshness States

**Files:**
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Modify: `dashboard/src/pages/DashboardPage.jsx`
- Modify: `dashboard/src/pages/LivePage.jsx`
- Modify: `dashboard/src/pages/ModelsPage.jsx`
- Modify: `dashboard/src/pages/WidgetsPage.jsx`
- Test: related dashboard tests.

**Instructions:**

- Consume freshness metadata when present.
- Add small, non-blocking freshness indicators.
- Distinguish "No data yet" from "Indexing historical data".
- Avoid changing final completed layouts.

**Acceptance:**

- Snapshot/partial payloads produce usable pages.
- Historical analytics show an indexing state until complete.
- Existing completed-data tests still pass.

**Checks:**

- `npm test -- --run DashboardPage.test.jsx LivePage.test.jsx ModelsPage.test.jsx WidgetsPage.test.jsx`
- `npm run build`

## Task P5-T2 Native Snapshot/Freshness Plumbing

**Files:**
- Modify: `VibeDeckMac/VibeDeckMac/Services/APIClient.swift`
- Modify: `VibeDeckMac/VibeDeckMac/ViewModels/DashboardViewModel.swift`
- Modify: native views as needed.

**Instructions:**

- Add decoders for freshness fields.
- Render snapshot/freshness states without blocking server refresh.

**Checks:**

- `xcodebuild -project VibeDeckMac/VibeDeckMac.xcodeproj -scheme VibeDeckMac -configuration Debug -destination 'platform=macOS' build`

