/* @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComparePage } from "./ComparePage.jsx";

const api = vi.hoisted(() => ({
  getCompareMetrics: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getCompareMetrics: api.getCompareMetrics,
}));

beforeEach(() => {
  api.getCompareMetrics.mockReset();
});

describe("ComparePage", () => {
  it("renders empty state without crashing", async () => {
    api.getCompareMetrics.mockResolvedValue({
      ok: true,
      metrics: {
        one_shot_rate: "0.00",
        retry_rate: "0.00",
        self_correction_rate: "0.00",
        cost_per_call_usd: "0.0000",
        cost_per_edit_usd: "0.0000",
        cache_hit_percent: "0.00",
      },
      totals: { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 },
    });

    render(<ComparePage />);

    expect(screen.getByText("Compare")).toBeTruthy();
    expect(screen.getByText("Loading parity data...")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No data for this window yet.")).toBeTruthy());
  });

  it("renders sample compare metrics", async () => {
    api.getCompareMetrics.mockResolvedValue({
      ok: true,
      metrics: {
        one_shot_rate: "42.50",
        retry_rate: "12.00",
        self_correction_rate: "18.25",
        cost_per_call_usd: "0.0833",
        cost_per_edit_usd: "0.2500",
        cache_hit_percent: "13.33",
      },
      totals: { total_tokens: 1000, total_cost_usd: "0.2500", session_count: 4 },
    });

    render(<ComparePage />);

    expect(await screen.findByText("42.50%")).toBeTruthy();
    expect(screen.getByText("$0.0833")).toBeTruthy();
    expect(screen.getByText("1,000")).toBeTruthy();
  });

  it("shows request errors instead of a false empty state", async () => {
    api.getCompareMetrics.mockRejectedValue(new Error("compare endpoint failed"));

    render(<ComparePage />);

    expect(await screen.findByText("Unable to load compare metrics.")).toBeTruthy();
    expect(screen.getByText("Check that the local VibeDeck server is running, then refresh.")).toBeTruthy();
    expect(screen.queryByText("compare endpoint failed")).toBeNull();
    expect(screen.queryByText("No data for this window yet.")).toBeNull();
  });
});
