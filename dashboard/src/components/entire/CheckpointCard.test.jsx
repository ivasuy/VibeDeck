/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { CheckpointCard } from "./CheckpointCard.jsx";

afterEach(() => {
  cleanup();
});

describe("CheckpointCard", () => {
  it("renders accumulated checkpoint metrics and model breakdowns", () => {
    render(
      <CheckpointCard
        repo="/Users/dev/repo"
        card={{
          id: "06/e2abdc1ec6",
          label: "06/e2abdc1ec6",
          files: ["06/e2abdc1ec6/metadata.json", "06/e2abdc1ec6/0/prompt.txt"],
          branch: "main",
          provider: "codex",
          topModel: "gpt-5.5",
          costQuality: "checkpoint_metadata",
          sessionCount: 2,
          totalTokens: 12345,
          costLabel: "$1.46",
          statusLabel: "Usage not linked",
          modelRows: [
            { label: "gpt-5.5", tokens: 9000, costUsd: 0.3 },
            { label: "claude-sonnet-4-6", tokens: 3345, costUsd: 0.12 },
          ],
          providerRows: [
            { label: "codex", tokens: 9000, costUsd: 0.3 },
            { label: "claude", tokens: 3345, costUsd: 0.12 },
          ],
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Checkpoint 06/e2abdc1ec6" })).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getAllByText("codex").length).toBeGreaterThan(0);
    expect(screen.getByText("checkpoint_metadata")).toBeTruthy();
    expect(screen.getByText("2 sessions")).toBeTruthy();
    expect(screen.getByText("$1.46")).toBeTruthy();
    expect(screen.getByText("12,345 tokens")).toBeTruthy();
    expect(screen.getByText("Usage not linked")).toBeTruthy();

    const modelRegion = screen.getByRole("region", { name: "Model breakdown for 06/e2abdc1ec6" });
    expect(within(modelRegion).getByText("gpt-5.5")).toBeTruthy();
    expect(within(modelRegion).getByText("9,000 tokens")).toBeTruthy();
    expect(within(modelRegion).getByText("$0.30")).toBeTruthy();
    expect(within(modelRegion).getByText("claude-sonnet-4-6")).toBeTruthy();
    expect(within(modelRegion).getByText("3,345 tokens")).toBeTruthy();
    expect(within(modelRegion).getByText("$0.12")).toBeTruthy();

    expect(screen.getByRole("region", { name: "Provider breakdown for 06/e2abdc1ec6" })).toBeTruthy();
  });

  it("keeps prompt collapsed until requested and loads prompt raw text through the injected fetcher", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      raw: "Quality review\nLine two",
    });

    render(
      <CheckpointCard
        repo="/Users/dev/repo"
        getCheckpointImpl={getCheckpointImpl}
        card={{
          id: "06/e2abdc1ec6",
          label: "06/e2abdc1ec6",
          promptPath: "06/e2abdc1ec6/0/prompt.txt",
          files: [],
        }}
      />,
    );

    expect(screen.queryByText("Quality review")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show prompt for 06/e2abdc1ec6" }));

    await waitFor(() => {
      expect(getCheckpointImpl).toHaveBeenCalledWith("/Users/dev/repo", "06/e2abdc1ec6/0/prompt.txt");
    });
    expect(await screen.findByText(/Quality review/i)).toBeTruthy();
    expect(screen.getByText(/Line two/i)).toBeTruthy();
  });

  it("summarizes captured activity without rendering the raw preview text", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      raw: "{\"type\":\"secret\"}",
      parsed: {
        valid_lines: 3,
        invalid_lines: 1,
        preview: [
          { line: 1, value: { type: "assistant" } },
          { line: 2, value: { type: "assistant" } },
          { line: 3, value: { type: "user" } },
        ],
      },
    });

    render(
      <CheckpointCard
        repo="/Users/dev/repo"
        getCheckpointImpl={getCheckpointImpl}
        card={{
          id: "06/e2abdc1ec6",
          label: "06/e2abdc1ec6",
          jsonlPath: "06/e2abdc1ec6/0/full.jsonl",
          files: [],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Show captured activity for 06/e2abdc1ec6" }));

    await waitFor(() => {
      expect(getCheckpointImpl).toHaveBeenCalledWith("/Users/dev/repo", "06/e2abdc1ec6/0/full.jsonl");
    });
    const activityRegion = await screen.findByRole("region", { name: "Captured activity for 06/e2abdc1ec6" });
    expect(within(activityRegion).getByText(/3 valid lines/i)).toBeTruthy();
    expect(within(activityRegion).getByText(/1 invalid line/i)).toBeTruthy();
    expect(within(activityRegion).getByText("assistant")).toBeTruthy();
    expect(within(activityRegion).getByText(/2 events/i)).toBeTruthy();
    expect(within(activityRegion).getByText("user")).toBeTruthy();
    expect(within(activityRegion).getByText(/1 event/i)).toBeTruthy();
    expect(screen.queryByText("{\"type\":\"secret\"}")).toBeNull();
  });

  it("keeps advanced raw details collapsed until requested and shows metadata raw content with the file list", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      raw: "{\"branch\":\"publish-main\"}",
      parsed: { branch: "publish-main" },
    });

    render(
      <CheckpointCard
        repo="/Users/dev/repo"
        getCheckpointImpl={getCheckpointImpl}
        card={{
          id: "06/e2abdc1ec6",
          label: "06/e2abdc1ec6",
          metadataPath: "06/e2abdc1ec6/metadata.json",
          files: ["06/e2abdc1ec6/metadata.json", "06/e2abdc1ec6/0/prompt.txt", "06/e2abdc1ec6/0/full.jsonl"],
        }}
      />,
    );

    expect(screen.queryByText("{\"branch\":\"publish-main\"}")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced details for 06/e2abdc1ec6" }));

    await waitFor(() => {
      expect(getCheckpointImpl).toHaveBeenCalledWith("/Users/dev/repo", "06/e2abdc1ec6/metadata.json");
    });
    expect(await screen.findByText(/"branch":"publish-main"/i)).toBeTruthy();
    expect(screen.getByText("06/e2abdc1ec6/metadata.json")).toBeTruthy();
    expect(screen.getByText("06/e2abdc1ec6/0/prompt.txt")).toBeTruthy();
    expect(screen.getByText("06/e2abdc1ec6/0/full.jsonl")).toBeTruthy();
  });
});
