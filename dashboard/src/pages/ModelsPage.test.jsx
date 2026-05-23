/* @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModelsPage } from "./ModelsPage.jsx";

const api = vi.hoisted(() => ({
  getModelsView: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getModelsView: api.getModelsView,
}));

beforeEach(() => {
  api.getModelsView.mockReset();
});

describe("ModelsPage", () => {
  it("renders empty state without crashing", async () => {
    api.getModelsView.mockResolvedValue({
      ok: true,
      models: [],
      totals: { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 },
    });

    render(<ModelsPage />);

    expect(screen.getByText("Models")).toBeTruthy();
    expect(screen.getByText("Loading parity data...")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No data for this window yet.")).toBeTruthy());
  });

  it("renders sample model rows", async () => {
    api.getModelsView.mockResolvedValue({
      ok: true,
      models: [
        {
          model: "claude-sonnet-4",
          providers: ["claude", "codex"],
          total_tokens: 1200,
          total_cost_usd: "0.3200",
          session_count: 3,
          task_categories: { Coding: 2, Research: 1 },
        },
      ],
      totals: { total_tokens: 1200, total_cost_usd: "0.3200", session_count: 3 },
    });

    render(<ModelsPage />);

    expect(await screen.findByText("claude-sonnet-4")).toBeTruthy();
    expect(screen.getByText("claude, codex")).toBeTruthy();
    expect(screen.getByText("Coding")).toBeTruthy();
  });
});
