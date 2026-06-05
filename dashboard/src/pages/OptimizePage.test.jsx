/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OptimizePage } from "./OptimizePage.jsx";

const api = vi.hoisted(() => ({
  getOptimizeFindings: vi.fn(),
  triggerOptimizeScan: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getOptimizeFindings: api.getOptimizeFindings,
  triggerOptimizeScan: api.triggerOptimizeScan,
}));

beforeEach(() => {
  api.getOptimizeFindings.mockReset();
  api.triggerOptimizeScan.mockReset();
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
      expect(screen.getByText("No optimize scan has run yet. Run a local scan to populate findings from this machine.")).toBeTruthy();
    });
    expect(screen.queryByText("$0.00 / mo")).toBeNull();
  });

  it("runs a local scan and reloads findings from the page", async () => {
    api.getOptimizeFindings
      .mockResolvedValueOnce({ ok: true, findings: [], health: null, latest_run: null })
      .mockResolvedValueOnce({
        ok: true,
        latest_run: { observed_at: "2026-05-23T12:00:00.000Z" },
        health: { health_grade: "A", score: 100 },
        findings: [],
      });
    api.triggerOptimizeScan.mockResolvedValue({ ok: true, inserted: 0, health_grade: "A" });

    render(<OptimizePage />);

    const button = await screen.findByText("Run local scan");
    fireEvent.click(button);

    await waitFor(() => expect(api.triggerOptimizeScan).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("No open optimize findings in the latest scan.")).toBeTruthy());
    expect(screen.getByText("A")).toBeTruthy();
  });
});
