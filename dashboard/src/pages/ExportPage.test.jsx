/* @vitest-environment jsdom */

import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportPage } from "./ExportPage.jsx";

const api = vi.hoisted(() => ({
  downloadExport: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  downloadExport: api.downloadExport,
}));

beforeEach(() => {
  api.downloadExport.mockReset();
});

describe("ExportPage", () => {
  it("renders empty state without crashing", async () => {
    api.downloadExport.mockResolvedValue({
      ok: true,
      rows: [],
      totals: { total_tokens: 0, total_cost_usd: "0.0000", session_count: 0 },
    });

    render(<ExportPage />);

    expect(screen.getByText("Export")).toBeTruthy();
    expect(screen.getByText("Loading parity data...")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("No data for this window yet.")).toBeTruthy());
  });

  it("renders sample export totals and actions", async () => {
    api.downloadExport.mockResolvedValue({
      ok: true,
      rows: [{ provider: "claude", session_id: "s1", total_tokens: 1000, cost_usd: "0.2500" }],
      totals: { total_tokens: 1000, total_cost_usd: "0.2500", session_count: 1 },
    });

    render(<ExportPage />);

    expect(await screen.findByText("1,000")).toBeTruthy();
    expect(screen.getByRole("button", { name: "JSON" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
  });
});
