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
const getKnownRepos = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getEntireStatus: (...args) => getEntireStatus(...args),
  getCheckpoints: (...args) => getCheckpoints(...args),
  getCheckpoint: (...args) => getCheckpoint(...args),
  getBranchUsage: (...args) => getBranchUsage(...args),
  getKnownRepos: (...args) => getKnownRepos(...args),
}));

beforeEach(() => {
  getEntireStatus.mockReset();
  getCheckpoints.mockReset();
  getCheckpoint.mockReset();
  getBranchUsage.mockReset();
  getKnownRepos.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("EntirePage", () => {
  it("renders repo path input and selector", async () => {
    getKnownRepos.mockResolvedValue({ repos: [] });
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
    getKnownRepos.mockResolvedValue({ repos: [] });
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
    getKnownRepos.mockResolvedValue({
      repos: [{ repo_root: "/Users/dev/repo", branches: [] }],
    });
    getBranchUsage.mockResolvedValue({ repos: [] });
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

  it("adds a manually loaded repo to recent repos immediately", async () => {
    getKnownRepos.mockResolvedValue({ repos: [] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({ available: true, files: [] });

    render(<EntirePage />);

    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/manual-repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByRole("button", { name: "Load recent repo manual-repo" })).toBeTruthy();
  });

  it("renders readable deduped recent repo chips, caps visible chips, and loads from chip click", async () => {
    getKnownRepos.mockResolvedValue({
      repos: [
        { repo_root: "/Users/dev/workspace/repo-01" },
        { repo_root: "/Users/dev/workspace/repo-02" },
        { repo_root: "/Users/dev/workspace/repo-03" },
        { repo_root: "/Users/dev/workspace/repo-04" },
        { repo_root: "/Users/dev/workspace/repo-05" },
        { repo_root: "/Users/dev/workspace/repo-06" },
        { repo_root: "/Users/dev/workspace/repo-07" },
        { repo_root: "/Users/dev/workspace/repo-08" },
        { repo_root: "/Users/dev/workspace/repo-09" },
        { repo_root: "/Users/dev/workspace/repo-02" },
      ],
    });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({ available: true, files: [] });

    render(<EntirePage />);

    expect(await screen.findByRole("button", { name: "Load recent repo repo-01" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Load recent repo repo-08" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load recent repo repo-09" })).toBeNull();
    expect(screen.getByText("+1 more")).toBeTruthy();

    const chip = screen.getByRole("button", { name: "Load recent repo repo-01" });
    expect(chip).toHaveAttribute("title", "/Users/dev/workspace/repo-01");
    expect(screen.getAllByText("workspace")).toHaveLength(8);

    fireEvent.click(chip);

    expect(await screen.findByDisplayValue("/Users/dev/workspace/repo-01")).toBeTruthy();
    expect(getEntireStatus).toHaveBeenLastCalledWith("/Users/dev/workspace/repo-01");
    expect(getCheckpoints).toHaveBeenLastCalledWith("/Users/dev/workspace/repo-01");
  });
});
