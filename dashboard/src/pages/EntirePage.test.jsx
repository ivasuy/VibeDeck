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

    expect(await screen.findByRole("button", { name: /Open checkpoint file JSON checkpoints\/2026-05-10\.json/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Open checkpoint file JSON checkpoints\/2026-05-09\.json/i })).toBeTruthy();
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

  it("opens text, hash, jsonl, and metadata checkpoint files without parse errors", async () => {
    getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: [
        "06/e2abdc1ec6/metadata.json",
        "06/e2abdc1ec6/0/prompt.txt",
        "06/e2abdc1ec6/0/full.jsonl",
        "06/e2abdc1ec6/0/content_hash.txt",
      ],
    });
    getCheckpoint.mockImplementation((_repo, filePath) => {
      if (filePath.endsWith("metadata.json")) {
        return Promise.resolve({
          path: filePath,
          file_name: "metadata.json",
          kind: "json",
          raw: "{\"branch\":\"publish-main\"}",
          parsed: { branch: "publish-main", cli_version: "0.6.1" },
          parse_error: null,
          size_bytes: 25,
          line_count: 1,
        });
      }
      if (filePath.endsWith("prompt.txt")) {
        return Promise.resolve({
          path: filePath,
          file_name: "prompt.txt",
          kind: "text",
          raw: "Quality review\nLine two",
          parsed: null,
          parse_error: null,
          size_bytes: 23,
          line_count: 2,
        });
      }
      if (filePath.endsWith("full.jsonl")) {
        return Promise.resolve({
          path: filePath,
          file_name: "full.jsonl",
          kind: "jsonl",
          raw: "{\"type\":\"start\"}\n{\"type\":\"end\"}",
          parsed: { valid_lines: 2, invalid_lines: 0, preview: [{ line: 1, value: { type: "start" } }] },
          parse_error: null,
          size_bytes: 33,
          line_count: 2,
        });
      }
      return Promise.resolve({
        path: filePath,
        file_name: "content_hash.txt",
        kind: "hash",
        raw: "sha256:abc123",
        parsed: { algorithm: "sha256", value: "abc123" },
        parse_error: null,
        size_bytes: 13,
        line_count: 1,
      });
    });

    render(<EntirePage />);
    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByText("publish-main")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file Prompt/i }));
    expect(await screen.findByText(/Quality review/)).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file JSONL/i }));
    expect(await screen.findByText("2 valid lines")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: /Open checkpoint file Hash/i }));
    expect(await screen.findByText("sha256")).toBeTruthy();
    expect(screen.queryByText(/Unable to load checkpoint/)).toBeNull();
  });
});
