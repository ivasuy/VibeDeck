/* @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage.jsx";

const hookData = vi.hoisted(() => ({
  dailyBreakdown: [],
  refresh: vi.fn(),
}));

const api = vi.hoisted(() => ({
  getForecastView: vi.fn(),
  getPlanView: vi.fn(),
  getSyncStatus: vi.fn(),
}));

vi.mock("../hooks/useLocale.js", () => ({
  useLocale: () => ({ resolvedLocale: "en" }),
}));

vi.mock("../lib/copy", () => ({
  copy: (key) => ({
    "dashboard.mcp.title": "MCP servers",
    "dashboard.mcp.empty": "No MCP activity in this window.",
    "shared.data_source": "Data source: EDGE",
    "usage.summary.total": "Total tokens",
    "shared.unit.thousand_abbrev": "K",
    "shared.unit.million_abbrev": "M",
    "shared.unit.billion_abbrev": "B",
    "shared.placeholder.short": "--",
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

vi.mock("../hooks/use-activity-heatmap", () => ({
  useActivityHeatmap: () => ({
    daily: [],
    heatmap: { weeks: [], active_days: 0 },
    loading: false,
    refresh: hookData.refresh,
  }),
}));

vi.mock("../hooks/use-project-usage-summary", () => ({
  useProjectUsageSummary: () => ({
    entries: [],
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
  getForecastView: api.getForecastView,
  getPlanView: api.getPlanView,
  getSyncStatus: api.getSyncStatus,
}));

vi.mock("../lib/sync-freshness", () => ({
  getSyncFreshnessWarning: () => null,
}));

vi.mock("../ui/matrix-a/components/ActivityHeatmap.jsx", () => ({
  ActivityHeatmap: () => <div>Heatmap</div>,
}));

vi.mock("../ui/matrix-a/views/DashboardView.jsx", () => ({
  DashboardView: ({ activityHeatmapBlock }) => (
    <div>
      <div>Dashboard shell</div>
      {activityHeatmapBlock}
    </div>
  ),
}));

beforeEach(() => {
  hookData.dailyBreakdown = [];
  hookData.refresh.mockClear();
  api.getForecastView.mockReset();
  api.getForecastView.mockResolvedValue({ ok: true, forecast_30d_usd: "0.0000" });
  api.getPlanView.mockReset();
  api.getPlanView.mockResolvedValue({ ok: true, monthly_usd: 0 });
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

  it("shows reading-pattern hint only when cache counters are present and below 80 percent", async () => {
    hookData.dailyBreakdown = [
      {
        day: "2026-05-23",
        input_tokens: 1000,
        cached_input_tokens: 100,
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Reading pattern hint: cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeTruthy();
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

    expect(await screen.findByText("Reading pattern hint: cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeTruthy();
  });

  it("does not show reading-pattern hint with missing counters", async () => {
    hookData.dailyBreakdown = [{ day: "2026-05-23" }];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("Dashboard shell")).toBeTruthy();
    expect(screen.queryByText("Reading pattern hint: cache hit below 80%. Repeated reads may be costing extra tokens.")).toBeNull();
  });

  it("renders MCP servers derived from tools_json counters", async () => {
    hookData.dailyBreakdown = [
      {
        day: "2026-05-23",
        tools_json: { "mcp__repo__search": 2, Read: 1 },
      },
    ];

    render(<DashboardPage signedIn auth="token" />);

    expect(await screen.findByText("MCP servers")).toBeTruthy();
    expect(screen.getByText("repo")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("Read")).toBeNull();
  });
});
