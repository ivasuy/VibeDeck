/* @vitest-environment jsdom */

import React from "react";
import { cleanup } from "@testing-library/react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { EntirePage } from "./EntirePage.jsx";

const getEntireStatus = vi.fn();
const getCheckpoints = vi.fn();
const getCheckpoint = vi.fn();
const getBranchUsage = vi.fn();
const getKnownRepos = vi.fn();
const hideKnownRepo = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getEntireStatus: (...args) => getEntireStatus(...args),
  getCheckpoints: (...args) => getCheckpoints(...args),
  getCheckpoint: (...args) => getCheckpoint(...args),
  getBranchUsage: (...args) => getBranchUsage(...args),
  getKnownRepos: (...args) => getKnownRepos(...args),
  hideKnownRepo: (...args) => hideKnownRepo(...args),
}));

beforeEach(() => {
  getEntireStatus.mockReset();
  getCheckpoints.mockReset();
  getCheckpoint.mockReset();
  getBranchUsage.mockReset();
  getKnownRepos.mockReset();
  hideKnownRepo.mockReset();
});

afterEach(() => {
  cleanup();
});

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("EntirePage", () => {
  it("renders the new entire dashboard layout", async () => {
    getKnownRepos.mockResolvedValue({ repos: [] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "not_enabled" });
    getCheckpoints.mockResolvedValue({ available: false, files: [] });

    render(<EntirePage />);

    expect(screen.queryByText("Repo command center")).toBeNull();
    expect(await screen.findByPlaceholderText("/Users/you/project")).toBeTruthy();
    expect(screen.getByText("Checkpoint timeline")).toBeTruthy();
    expect(screen.getByText("Controls")).toBeTruthy();
    expect(screen.queryByText("Checkpoint files")).toBeNull();
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

  it("renders checkpoint timeline details for selected repo", async () => {
    getKnownRepos.mockResolvedValue({
      repos: [{ repo_root: "/Users/dev/repo", branches: [] }],
    });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: [
        "06/e2abdc1ec6/metadata.json",
        "06/e2abdc1ec6/0/metadata.json",
        "06/e2abdc1ec6/0/prompt.txt",
        "06/e2abdc1ec6/0/full.jsonl",
        "06/e2abdc1ec6/0/content_hash.txt",
      ],
      checkpoint_usage: {
        "06/e2abdc1ec6": {
          status: "metadata",
          confidence: "metadata",
          total_tokens: 2993312,
          total_cost_usd: 1.46,
          cost_quality: "checkpoint_metadata",
          models: [
            { model: "gpt-5.3-codex-spark", total_tokens: 2330934, total_cost_usd: 0.95 },
            { model: "gpt-5.5", total_tokens: 662378, total_cost_usd: 0.51 },
          ],
          providers: [{ provider: "codex", total_tokens: 2993312, total_cost_usd: 1.46 }],
          metadata_files: [
            {
              metadata_path: "06/e2abdc1ec6/0/metadata.json",
              model: "gpt-5.5",
              total_tokens: 662378,
              total_cost_usd: 0.51,
            },
          ],
        },
      },
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
    fireEvent.click(await screen.findByRole("button", { name: "Load repo" }));

    expect(await screen.findByText("Checkpoint timeline")).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Checkpoint 06/e2abdc1ec6" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show prompt for 06/e2abdc1ec6" }));
    expect(await screen.findByText(/Quality review/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show captured activity for 06/e2abdc1ec6" }));
    expect(await screen.findByText("2 valid lines")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Show advanced details for 06/e2abdc1ec6" }));
    expect(await screen.findByText("Files")).toBeTruthy();
    expect((await screen.findAllByText("Metadata")).length).toBeGreaterThan(0);
  });

  it("ignores stale results from earlier repo loads", async () => {
    const statusByRepo = new Map();
    const checkpointsByRepo = new Map();

    getKnownRepos.mockResolvedValue({ repos: [] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockImplementation((repo) => {
      const key = String(repo || "");
      if (!statusByRepo.has(key)) statusByRepo.set(key, createDeferred());
      return statusByRepo.get(key).promise;
    });
    getCheckpoints.mockImplementation((repo) => {
      const key = String(repo || "");
      if (!checkpointsByRepo.has(key)) checkpointsByRepo.set(key, createDeferred());
      return checkpointsByRepo.get(key).promise;
    });

    render(<EntirePage />);

    const input = await screen.findByPlaceholderText("/Users/you/project");

    fireEvent.change(input, { target: { value: "/Users/dev/old-repo" } });
    fireEvent.submit(input.closest("form"));

    fireEvent.change(input, { target: { value: "/Users/dev/new-repo" } });
    fireEvent.submit(input.closest("form"));

    statusByRepo.get("/Users/dev/new-repo").resolve({ state: "active", version: "2.0.0" });
    checkpointsByRepo.get("/Users/dev/new-repo").resolve({ available: false, files: [] });

    expect(await screen.findByText("2.0.0")).toBeTruthy();

    statusByRepo.get("/Users/dev/old-repo").resolve({ state: "active", version: "1.0.0" });
    checkpointsByRepo.get("/Users/dev/old-repo").resolve({ available: false, files: [] });

    await waitFor(() => {
      expect(screen.getByText("2.0.0")).toBeTruthy();
      expect(screen.queryByText("1.0.0")).toBeNull();
    });
  });

  it("adds a manually loaded repo to recent repos immediately", async () => {
    getKnownRepos.mockResolvedValue({ repos: [] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({ available: true, files: [] });
    hideKnownRepo.mockResolvedValue({ ok: true });

    render(<EntirePage />);

    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/manual-repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByRole("button", { name: "Load recent repo manual-repo" })).toBeTruthy();
  });

  it("renders recent repos in a side pane and supports removing a repo", async () => {
    getKnownRepos.mockResolvedValue({
      repos: [
        { repo_root: "/Users/dev/workspace/repo-01" },
        { repo_root: "/Users/dev/workspace/repo-02" },
      ],
    });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({ available: true, files: [] });
    hideKnownRepo.mockResolvedValue({ ok: true });

    render(<EntirePage />);

    expect(await screen.findByRole("complementary", { name: /Recent repos/i })).toBeTruthy();
    const repoButton = screen.getByRole("button", { name: "Load recent repo repo-01" });
    expect(repoButton.getAttribute("title")).toBe("/Users/dev/workspace/repo-01");
    expect(screen.getAllByText("workspace").length).toBeGreaterThan(0);

    fireEvent.click(repoButton);

    expect(await screen.findByDisplayValue("/Users/dev/workspace/repo-01")).toBeTruthy();
    expect(getEntireStatus).toHaveBeenLastCalledWith("/Users/dev/workspace/repo-01");
    expect(getCheckpoints).toHaveBeenLastCalledWith("/Users/dev/workspace/repo-01");

    fireEvent.click(screen.getByRole("button", { name: "Remove recent repo repo-02" }));
    expect(hideKnownRepo).toHaveBeenCalledWith("/Users/dev/workspace/repo-02");
  });

  it("shows a remove fallback message when recent repo removal rejects with a non-Error", async () => {
    getKnownRepos.mockResolvedValue({
      repos: [
        { repo_root: "/Users/dev/workspace/repo-01" },
        { repo_root: "/Users/dev/workspace/repo-02" },
      ],
    });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({ available: true, files: [] });
    hideKnownRepo.mockRejectedValue("failed");

    render(<EntirePage />);

    expect(await screen.findByRole("button", { name: "Remove recent repo repo-02" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove recent repo repo-02" }));

    expect(await screen.findByText("Unable to remove recent repository.")).toBeTruthy();
  });

  it("does not render the old checkpoint file browser", async () => {
    getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: [
        "06/e2abdc1ec6/metadata.json",
        "06/e2abdc1ec6/0/metadata.json",
        "06/e2abdc1ec6/0/prompt.txt",
        "06/e2abdc1ec6/0/full.jsonl",
        "06/e2abdc1ec6/0/content_hash.txt",
      ],
      checkpoint_usage: {
        "06/e2abdc1ec6": {
          status: "metadata",
          confidence: "metadata",
          total_tokens: 2993312,
          total_cost_usd: 1.46,
          cost_quality: "checkpoint_metadata",
          models: [
            { model: "gpt-5.3-codex-spark", total_tokens: 2330934, total_cost_usd: 0.95 },
            { model: "gpt-5.5", total_tokens: 662378, total_cost_usd: 0.51 },
          ],
          providers: [{ provider: "codex", total_tokens: 2993312, total_cost_usd: 1.46 }],
          metadata_files: [
            {
              metadata_path: "06/e2abdc1ec6/0/metadata.json",
              model: "gpt-5.5",
              total_tokens: 662378,
              total_cost_usd: 0.51,
            },
          ],
        },
      },
    });

    render(<EntirePage />);
    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByText("Checkpoint timeline")).toBeTruthy();
    expect(screen.queryByText("Checkpoint files")).toBeNull();
    expect(await screen.findByRole("region", { name: "Checkpoint 06/e2abdc1ec6" })).toBeTruthy();
    expect(await screen.findByText("$1.46")).toBeTruthy();
    expect(screen.getAllByText("gpt-5.3-codex-spark").length).toBeGreaterThan(0);
    expect(screen.getAllByText("gpt-5.5").length).toBeGreaterThan(0);
    expect(screen.queryByText("Stored cost")).toBeNull();
    expect(screen.queryByText(/^0$/)).toBeNull();
    expect(screen.queryByText(/Unable to load checkpoint/)).toBeNull();
  });

  it("renders metadata, unmatched, and ambiguous checkpoint usage states without fake zero cost", async () => {
    getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: [
        "e2/linked/metadata.json",
        "e2/unmatched/metadata.json",
        "e2/ambiguous/metadata.json",
      ],
      checkpoint_usage: {
        "e2/linked": {
          status: "metadata",
          confidence: "metadata",
          total_tokens: 12345,
          total_cost_usd: 0.42,
          cost_quality: "checkpoint_metadata",
          models: [{ model: "gpt-5.5", total_tokens: 12345, total_cost_usd: 0.42 }],
          providers: [{ provider: "codex", total_tokens: 12345, total_cost_usd: 0.42 }],
        },
        "e2/unmatched": {
          status: "unmatched",
          confidence: "unmatched",
          total_tokens: null,
          total_cost_usd: null,
          cost_quality: "unknown",
          reason: "no_matching_session",
        },
        "e2/ambiguous": {
          status: "ambiguous",
          confidence: "ambiguous",
          total_tokens: null,
          total_cost_usd: null,
          cost_quality: "unknown",
          reason: "multiple_matching_sessions",
        },
      },
    });
    getCheckpoint.mockResolvedValue({
      path: "e2/linked/metadata.json",
      file_name: "metadata.json",
      kind: "json",
      raw: "{}",
      parsed: {},
    });

    render(<EntirePage />);
    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(screen.queryByText("12,345")).toBeNull();
    expect(screen.queryByText("Stored cost")).toBeNull();
    expect(await screen.findByText("Usage linked")).toBeTruthy();
    expect((await screen.findAllByText("Ambiguous usage")).length).toBeGreaterThan(0);
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows Usage linked for metadata group when checkpoint_usage entry is missing", async () => {
    getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: ["e2/no-usage/metadata.json", "e2/no-usage/0/prompt.txt"],
      checkpoint_usage: {},
    });
    getCheckpoint.mockResolvedValue({
      path: "e2/no-usage/metadata.json",
      file_name: "metadata.json",
      kind: "json",
      raw: "{}",
      parsed: {},
    });

    render(<EntirePage />);
    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(await screen.findByText("Usage linked")).toBeTruthy();
    expect(screen.queryByText("Usage not linked")).toBeNull();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("renders the command center, timeline, and control panel layout", async () => {
    getKnownRepos.mockResolvedValue({ repos: [{ repo_root: "/Users/dev/repo" }] });
    getBranchUsage.mockResolvedValue({ repos: [] });
    getEntireStatus.mockResolvedValue({ state: "active", version: "0.6.1" });
    getCheckpoints.mockResolvedValue({
      available: true,
      files: ["06/e2abdc1ec6/metadata.json", "06/e2abdc1ec6/0/prompt.txt"],
    });
    getCheckpoint.mockResolvedValue({
      path: "06/e2abdc1ec6/metadata.json",
      file_name: "metadata.json",
      kind: "json",
      raw: "{\"branch\":\"publish-main\"}",
      parsed: { branch: "publish-main" },
      parse_error: null,
      size_bytes: 25,
      line_count: 1,
    });

    render(<EntirePage />);
    const input = await screen.findByPlaceholderText("/Users/you/project");
    fireEvent.change(input, { target: { value: "/Users/dev/repo" } });
    fireEvent.click(screen.getByRole("button", { name: "Load repo" }));

    expect(screen.queryByText("Repository")).toBeNull();
    expect(screen.queryByText("Repo command center")).toBeNull();
    expect(screen.getByPlaceholderText("/Users/you/project")).toBeTruthy();
    expect(screen.getByText("Controls")).toBeTruthy();
    expect(screen.getByText("Checkpoint timeline")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run configure" })).toBeTruthy();
    expect(screen.queryByText("Checkpoint files")).toBeNull();
  });
});
