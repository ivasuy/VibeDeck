/* @vitest-environment jsdom */

import React from "react";
import { cleanup } from "@testing-library/react";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { EntirePage } from "./EntirePage.jsx";

const getEntireStatus = vi.fn();
const getCheckpoints = vi.fn();
const getCheckpoint = vi.fn();
const getBranchUsage = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getEntireStatus: (...args) => getEntireStatus(...args),
  getCheckpoints: (...args) => getCheckpoints(...args),
  getCheckpoint: (...args) => getCheckpoint(...args),
  getBranchUsage: (...args) => getBranchUsage(...args),
}));

beforeEach(() => {
  getEntireStatus.mockReset();
  getCheckpoints.mockReset();
  getCheckpoint.mockReset();
  getBranchUsage.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EntirePage", () => {
  it("renders repo path input and selector", async () => {
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "not_enabled" });
    getCheckpoints.mockResolvedValue({ available: false, files: [] });

    render(<EntirePage />);

    expect(await screen.findByPlaceholderText("/Users/you/project")).toBeTruthy();
  });

  it.each([
    ["not_installed", "Entire not installed"],
    ["not_enabled", "Not enabled"],
    ["enabled_no_commits", "Enabled, waiting for checkpoints"],
    ["active", "Active"],
  ])("renders status label for %s", async (state, label) => {
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state });
    getCheckpoints.mockResolvedValue({ available: false, files: [] });

    render(<EntirePage />);

    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByText(label)).toBeTruthy();
  });

  it("renders checkpoint file names for selected repo", async () => {
    getBranchUsage.mockResolvedValue({
      repos: [{ repo_root: "/Users/dev/repo", branches: [] }],
    });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: ["checkpoints/2026-05-10.json", "checkpoints/2026-05-09.json"],
    });
    getCheckpoint.mockResolvedValue({ id: "abc123", created_at: "2026-05-10T10:00:00.000Z" });

    render(<EntirePage />);

    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(await screen.findByRole("button", { name: "Load repo" }));

    expect(await screen.findByText("checkpoints/2026-05-10.json")).toBeTruthy();
    expect(screen.getByText("checkpoints/2026-05-09.json")).toBeTruthy();
  });
});
