/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { LivePage } from "./LivePage.jsx";

vi.mock("../hooks/use-vibedeck-live-sessions", () => ({
  useVibeDeckLiveSessions: () => ({
    status: "connected",
    error: null,
    sessions: [
      {
        provider: "codex",
        session_id: "s1",
        repo_root: "/repo/vibedeck",
        branch: "main",
        confidence: "high",
        branch_resolution_tier: "A",
        model: "gpt-5.2",
        total_tokens: 1200,
        total_cost_usd: 0.12,
      },
      {
        provider: "codex",
        session_id: "s2",
        repo_root: "/repo/vibedeck",
        branch: "feature/costs",
        confidence: "medium",
        branch_resolution_tier: "B",
        model: "gpt-5.4",
        total_tokens: 5000,
        total_cost_usd: null,
        estimated_total_cost_usd: 0.05,
        cost_estimated: true,
      },
      {
        provider: "unknown",
        session_id: "s3",
        repo_root: null,
        branch: null,
        confidence: "low",
        branch_resolution_tier: "C",
        model: "totally-unknown-model",
        total_tokens: 5000,
        total_cost_usd: 0,
        estimated_total_cost_usd: null,
        cost_estimated: true,
        cost_quality: "pricing_missing",
      },
      {
        provider: "gemini",
        session_id: "s4",
        repo_root: "/repo/zero",
        branch: "idle",
        confidence: "medium",
        branch_resolution_tier: "D",
        model: "gemini-2.5-flash-lite",
        total_tokens: 0,
        total_cost_usd: 0,
        estimated_total_cost_usd: 0,
        cost_estimated: false,
        cost_quality: "zero_tokens",
      },
      {
        provider: "codex",
        session_id: "s5",
        repo_root: "/repo/paged",
        branch: "visible-fifth",
        confidence: "high",
        branch_resolution_tier: "A",
        model: "gpt-5.5",
        total_tokens: 100,
        total_cost_usd: 0.01,
      },
      {
        provider: "codex",
        session_id: "s6",
        repo_root: "/repo/paged",
        branch: "second-page-session",
        confidence: "low",
        branch_resolution_tier: "C",
        model: "gpt-5.5",
        total_tokens: 100,
        total_cost_usd: 0.01,
      },
    ],
  }),
}));

vi.mock("../hooks/use-usage-limits", () => ({
  useUsageLimits: () => ({
    data: {
      codex: {
        configured: true,
        primary_window: {
          used_percent: 42,
          reset_at: "2026-05-11T12:00:00.000Z",
        },
        secondary_window: {
          used_percent: 18,
          reset_at: "2026-05-16T12:00:00.000Z",
        },
      },
      gemini: {
        configured: false,
      },
    },
    error: null,
    isLoading: false,
  }),
}));

vi.mock("../lib/vibedeck-api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getAttributionStats: () =>
      Promise.resolve({ high: 1, medium: 0, low: 0, unattributed: 0, total: 1 }),
    getLiveSessionsSnapshot: () =>
      Promise.resolve({
        freshness: {
          mode: "partial",
          recent_ready: true,
          historical_ready: false,
          active_rebuild: true,
          complete_through: null,
          indexing_providers: ["codex"],
          failed_shards: [],
        },
      }),
    getSyncStatus: () =>
      Promise.resolve({
        last_parse_at: "2026-05-10T09:30:00.000Z",
        queue_updated_at: "2026-05-10T09:30:00.000Z",
        project_queue_updated_at: "2026-05-10T09:30:00.000Z",
        session_count: 1,
        open_session_count: 1,
        sync_enabled: false,
      }),
  };
});

describe("LivePage", () => {
  it("selects the session passed by native menubar deep link", async () => {
    window.history.pushState({}, "", "/live?session=gemini%3As4");
    render(<LivePage />);

    const zeroWorkstream = await screen.findByRole("button", { name: /select zero workstream/i });
    expect(zeroWorkstream.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders active sessions and attribution confidence", async () => {
    window.history.pushState({}, "", "/live");
    render(<LivePage />);

    expect(await screen.findByText("Live control center")).toBeTruthy();
    expect(screen.getAllByText(/codex/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/main/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/feature\/costs/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/idle/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/visible-fifth/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/second-page-session/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("high").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /view breakdown for VibeDeck/i }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("button", { name: /view breakdown for VibeDeck/i })[0]);
    expect(screen.getByRole("dialog", { name: /workstream breakdown/i })).toBeTruthy();
    expect(screen.getAllByText("$0.05").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.05 est.")).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00 est.")).toBeNull();
    expect(screen.getByText("$0.00")).toBeTruthy();
    expect(screen.getAllByText("Live sessions").length).toBeGreaterThan(0);
    expect(screen.getByText("Live control center")).toBeTruthy();
    expect(screen.getByText("Needs attribution")).toBeTruthy();
    expect(screen.getByText("Limit sources")).toBeTruthy();
    expect(screen.getByText("Branch routing")).toBeTruthy();
    expect(screen.getByText("Unrouted")).toBeTruthy();
    expect(screen.getByText("Provider limits")).toBeTruthy();
    expect(screen.getByText("Codex")).toBeTruthy();
    expect(screen.getAllByText("5h").length).toBeGreaterThan(0);
    expect(screen.getByText("7d")).toBeTruthy();
    expect(screen.queryByText("Gemini")).toBeNull();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByText("Local sync is disabled. Live data may be stale.")).toBeTruthy();
    expect(await screen.findByText("Indexing historical data")).toBeTruthy();
  });
});
