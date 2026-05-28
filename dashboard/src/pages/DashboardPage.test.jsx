/* @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.jsx";

const hookData = vi.hoisted(() => ({
  dailyBreakdown: [],
  liveSessions: [],
  refresh: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getAttributionStats: vi.fn(),
  getForecastView: vi.fn(),
  getPlanView: vi.fn(),
  getRecentSessions: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../lib/copy", () => ({
  copy: (key) => ({
    "shared.data_source": "Data source: EDGE",
    "usage.summary.total": "Total tokens",
    "shared.unit.thousand_abbrev": "K",
    "shared.unit.million_abbrev": "M",
    "shared.unit.billion_abbrev": "B",
    "shared.placeholder.short": "--",
    "dashboard.identity.fallback": "Anonymous",
  }[key] || key),
}));

vi.mock("../hooks/use-usage-data", () => ({
  useUsageData: (options = {}) => ({
    daily: String(options.cacheKey || "").includes("daily-breakdown") ? hookData.dailyBreakdown : [],
    summary: null,
    rolling: null,
    source: "edge",
    loading: false,
    error: null,
    refresh: hookData.refresh,
  }),
}));

vi.mock("../hooks/use-trend-data", () => ({
  useTrendData: () => ({
    rows: [],
    from: "2026-05-23",
    to: "2026-05-23",
    loading: false,
    refresh: hookData.refresh,
  }),
}));

vi.mock("../hooks/use-usage-limits", () => ({
  useUsageLimits: () => ({
    data: null,
    refresh: hookData.refresh,
  }),
}));

vi.mock("../hooks/use-usage-model-breakdown", () => ({
  useUsageModelBreakdown: () => ({
    breakdown: { sources: [] },
    loading: false,
    refresh: hookData.refresh,
  }),
}));

vi.mock("../hooks/use-vibedeck-live-sessions", () => ({
  useVibeDeckLiveSessions: () => ({
    sessions: hookData.liveSessions,
    initialLoading: false,
    stale: false,
  }),
}));

vi.mock("../lib/auth-token", () => ({
  isAccessTokenReady: () => true,
  normalizeAccessToken: (token) => token,
  resolveAuthAccessToken: async (token) => token || "token",
}));

vi.mock("../lib/mock-data", () => ({
  getMockNow: () => null,
  isMockEnabled: () => false,
}));

vi.mock("../lib/install-status", () => ({
  shouldShowInstallCard: () => false,
}));

vi.mock("../lib/api", () => ({
  getUserStatus: vi.fn(async () => null),
  triggerLocalSync: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../lib/vibedeck-api", () => ({
  getAttributionStats: api.getAttributionStats,
  getForecastView: api.getForecastView,
  getPlanView: api.getPlanView,
  getRecentSessions: api.getRecentSessions,
  getSyncStatus: api.getSyncStatus,
}));

vi.mock("../lib/sync-freshness", () => ({
  getSyncFreshnessWarning: () => null,
}));

vi.mock("../ui/matrix-a/views/DashboardView.jsx", () => ({
  DashboardView: ({ attentionInsight, attributionStats, hasDashboardUsage, identityDisplayName, recentSessionRows }) => (
    <div>
      <div>Dashboard shell</div>
      <div>Attribution total: {attributionStats?.total ?? "none"}</div>
      <div>Dashboard has usage: {hasDashboardUsage ? "yes" : "no"}</div>
      <div>Identity: {identityDisplayName}</div>
      <div>Recent sessions: {recentSessionRows?.length ?? 0}</div>
      {attentionInsight ? <div>{attentionInsight.body}</div> : null}
    </div>
  ),
}));

beforeEach(() => {
  hookData.dailyBreakdown = [];
  hookData.liveSessions = [];
  hookData.refresh.mockClear();
  api.getAttributionStats.mockReset();
  api.getAttributionStats.mockResolvedValue({ total: 0, high: 0, medium: 0, low: 0, unattributed: 0 });
  api.getForecastView.mockReset();
  api.getForecastView.mockResolvedValue({ ok: true, forecast_30d_usd: "0.0000" });
  api.getPlanView.mockReset();
  api.getPlanView.mockResolvedValue({ ok: true, monthly_usd: 0 });
  api.getRecentSessions.mockReset();
  api.getRecentSessions.mockResolvedValue({ sessions: [] });
  api.getSyncStatus.mockReset();
  api.getSyncStatus.mockResolvedValue({ ok: true });
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
});

describe("DashboardPage", () => {
  it("shows forecast banner only when projected spend exceeds configured plan", async () => {
    api.getForecastView.mockResolvedValue({ ok: true, forecast_30d_usd: "42.00" });
    api.getPlanView.mockResolvedValue({ ok: true, monthly_usd: 20 });

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Projected month spend is above your configured plan. Showing API-equivalent cost, not provider billing.")).toBeTruthy();
  });

  it("hides forecast banner when forecast data is missing", async () => {
    api.getForecastView.mockResolvedValue({ ok: true });
    api.getPlanView.mockResolvedValue({ ok: true, monthly_usd: 20 });

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Dashboard shell")).toBeTruthy();
    expect(screen.queryByText("Projected month spend is above your configured plan. Showing API-equivalent cost, not provider billing.")).toBeNull();
  });

  it("passes first-run dashboard state when no tracked usage exists", async () => {
    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Dashboard has usage: no")).toBeTruthy();
    expect(screen.getByText("Identity: Anonymous")).toBeTruthy();
  });

  it("shows reading-pattern hint only when cache counters are present and below 80 percent", async () => {
    hookData.dailyBreakdown = [
      {
        day: "2026-05-23",
        input_tokens: 1000,
        cached_input_tokens: 100,
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeTruthy();
  });

  it("computes reading-pattern cache hit against total input tokens", async () => {
    hookData.dailyBreakdown = [
      {
        day: "2026-05-23",
        input_tokens: 100,
        cached_input_tokens: 300,
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeTruthy();
  });

  it("does not show reading-pattern hint with missing counters", async () => {
    hookData.dailyBreakdown = [{ day: "2026-05-23" }];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Dashboard shell")).toBeTruthy();
    expect(screen.queryByText("Cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeNull();
  });

  it("does not render legacy MCP server cards on the landing dashboard", async () => {
    hookData.dailyBreakdown = [
      {
        day: "2026-05-23",
        tools_json: { "mcp__repo__search": 2, Read: 1 },
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Dashboard shell")).toBeTruthy();
    expect(screen.queryByText("MCP servers")).toBeNull();
    expect(screen.queryByText("repo")).toBeNull();
  });

  it("loads attribution stats and passes exact recent live sessions into the dashboard view", async () => {
    api.getAttributionStats.mockResolvedValue({
      total: 3,
      high: 2,
      medium: 1,
      low: 0,
      unattributed: 0,
    });
    hookData.liveSessions = [
      {
        provider: "codex",
        session_id: "recent-1",
        started_at: "2026-05-23T10:00:00.000Z",
        last_observed_at: "2026-05-23T10:05:00.000Z",
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Attribution total: 3")).toBeTruthy();
    expect(screen.getByText("Recent sessions: 1")).toBeTruthy();
    expect(api.getAttributionStats).toHaveBeenCalled();
  });

  it("passes exact historical recent sessions from the backend when no live rows exist", async () => {
    api.getRecentSessions.mockResolvedValue({
      sessions: [
        {
          provider: "claude",
          session_id: "historical-1",
          branch: "main",
          activity_at: "2026-05-22T09:20:00.000Z",
        },
      ],
    });

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Recent sessions: 1")).toBeTruthy();
    expect(api.getRecentSessions).toHaveBeenCalledWith({ limit: 5 });
  });
});
