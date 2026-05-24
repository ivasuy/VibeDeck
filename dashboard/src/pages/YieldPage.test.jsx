/* @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { YieldPage } from "./YieldPage.jsx";

const api = vi.hoisted(() => ({
  getYieldView: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getYieldView: api.getYieldView,
}));

beforeEach(() => {
  api.getYieldView.mockReset();
});

describe("YieldPage", () => {
  it("renders empty state without crashing", async () => {
    api.getYieldView.mockResolvedValue({
      ok: true,
      branches: [],
      totals: { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 },
    });

    render(<YieldPage />);

    expect(screen.getByText("Yield")).toBeTruthy();
    expect(screen.getByText("Loading parity data...")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No data for this window yet.")).toBeTruthy());
  });

  it("renders sample branch yield cards", async () => {
    api.getYieldView.mockResolvedValue({
      ok: true,
      branches: [
        {
          branch: "main",
          yield_state: "productive",
          session_count: 2,
          total_tokens: 2400,
          total_cost_usd: "1.1250",
        },
      ],
      totals: { total_tokens: 2400, total_cost_usd: "1.1250", session_count: 2 },
    });

    render(<YieldPage />);

    expect(await screen.findByText("main")).toBeTruthy();
    expect(screen.getAllByText("productive").length).toBeGreaterThan(0);
    expect(screen.getByText("2,400")).toBeTruthy();
  });
});
