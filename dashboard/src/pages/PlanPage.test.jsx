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

    expect(await screen.findByText("cursor-pro")).toBeTruthy();
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

  it("explains unconfigured custom plan while keeping month-to-date spend visible", async () => {
    api.getPlanView.mockResolvedValue({
      ok: true,
      plan: "custom",
      monthly_usd: 0,
      monthly_plan_usd: "0.00",
      month_to_date_api_equivalent_usd: "3632.0315",
      usage_percent: null,
      label: "API-equivalent cost",
      label_detail: "API-equivalent cost - this is direct API-equivalent display cost, not a subscription bill.",
    });

    render(<PlanPage />);

    expect(await screen.findByText("Monthly plan not configured")).toBeTruthy();
    expect(screen.getByText("$3,632.0315")).toBeTruthy();
    expect(screen.getByText("Budget percentage unavailable until a monthly plan amount is configured.")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
