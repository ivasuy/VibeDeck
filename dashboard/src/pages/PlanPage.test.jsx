/* @vitest-environment jsdom */

import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlanPage } from "./PlanPage.jsx";

const api = vi.hoisted(() => ({
  getPlanView: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getPlanView: api.getPlanView,
}));

beforeEach(() => {
  api.getPlanView.mockReset();
});

describe("PlanPage", () => {
  it("shows Cursor API-equivalent label and not-what-you-owe wording", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "cursor-pro",
      monthly_usd: 20,
      monthly_plan_usd: "20.00",
      month_to_date_api_equivalent_usd: "12.50",
      usage_percent: "62.50",
      label: "API-equivalent cost",
      label_detail: "API-equivalent cost - this is what these tokens would have cost via direct API, not what you owe Cursor.",
    });

    render(<PlanPage />);

    expect(await screen.findByText("Cursor Pro")).toBeTruthy();
    expect(screen.getByText("API-equivalent cost — this is what these tokens would have cost via direct API, not what you owe Cursor.")).toBeTruthy();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("shows Claude plan usage without Cursor debt wording", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "claude-pro",
      monthly_usd: 20,
      month_to_date_api_equivalent_usd: "8.00",
      usage_percent: "40.00",
      label: "Plan usage",
      label_detail: "Plan usage",
    });

    render(<PlanPage />);

    expect((await screen.findAllByText("Plan usage")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/not what you owe Cursor/i)).toBeNull();
  });

  it("shows a soft inline hint when there is no observed activity yet", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "custom",
      monthly_usd: 0,
      monthly_plan_usd: "0.00",
      month_to_date_api_equivalent_usd: "0.0000",
      usage_percent: null,
      inferred: null,
      label: "API-equivalent cost",
      label_detail: "API-equivalent cost - this is direct API-equivalent display cost, not a subscription bill.",
    });

    render(<PlanPage />);

    expect(
      await screen.findByText(
        "No recent activity yet — once you use Claude or Codex, VibeDeck will pick a plan automatically.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/Monthly plan not configured/i)).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders an Auto-detected badge for an inferred plan", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "claude-monthly",
      monthly_usd: 200,
      monthly_plan_usd: "200.00",
      month_to_date_api_equivalent_usd: "82.7700",
      usage_percent: "41.39",
      inferred: true,
      label: "Plan usage",
      label_detail: "Plan usage — detected from your Claude activity.",
    });

    render(<PlanPage />);

    expect(await screen.findByText("Claude monthly")).toBeTruthy();
    expect(screen.getByText("Auto-detected")).toBeTruthy();
    expect(screen.queryByText(/Monthly plan not configured/i)).toBeNull();
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("marks forecast as locked until seven active days are available", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "claude-pro",
      monthly_usd: 20,
      month_to_date_api_equivalent_usd: "4.20",
      usage_percent: "21.00",
      active_days: 3,
      label: "Plan usage",
      label_detail: "Plan usage",
    });

    render(<PlanPage />);

    expect(await screen.findAllByText("Forecast unlocks after 7 days of usage.")).toHaveLength(2);
    expect(screen.getByText("VibeDeck has 3 active days so far. Current spend stays visible, while projected bars are marked as forecast data.")).toBeTruthy();
  });
});
