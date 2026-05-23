/* @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OptimizePage } from "./OptimizePage.jsx";

const api = vi.hoisted(() => ({
  getOptimizeFindings: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getOptimizeFindings: api.getOptimizeFindings,
}));

beforeEach(() => {
  api.getOptimizeFindings.mockReset();
});

describe("OptimizePage", () => {
  it("renders health grade and grouped severities", async () => {
    api.getOptimizeFindings.mockResolvedValue({
      ok: true,
      latest_run: { observed_at: "2026-05-23T12:00:00.000Z" },
      health: { health_grade: "B", score: 82 },
      findings: [
        {
          id: 1,
          severity: "high",
          title: "Repeated file reads",
          detail: "Read README.md repeatedly.",
          estimated_token_waste: 3000,
          estimated_cost_waste_usd: "0.009000",
          paste_fix: "Cache repeated file reads.",
        },
        {
          id: 2,
          severity: "low",
          title: "Large CLAUDE.md",
          detail: "Trim project instructions.",
          estimated_token_waste: 2000,
          estimated_cost_waste_usd: "0.006000",
        },
      ],
    });

    render(<OptimizePage />);

    expect(await screen.findByText("Health grade")).toBeTruthy();
    expect(screen.getByText("B")).toBeTruthy();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.getByText("Low")).toBeTruthy();
    expect(screen.getByText("Repeated file reads")).toBeTruthy();
    expect(screen.getByText("Estimated avoidable cost")).toBeTruthy();
  });

  it("renders empty state", async () => {
    api.getOptimizeFindings.mockResolvedValue({ ok: true, findings: [], health: null, latest_run: null });

    render(<OptimizePage />);

    await waitFor(() => {
      expect(screen.getByText("No optimize findings yet. Run vibedeck optimize --scan to generate the first scan.")).toBeTruthy();
    });
  });
});
