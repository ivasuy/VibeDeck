/* @vitest-environment jsdom */

import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../test/test-utils";
import { CheckpointTimeline } from "./CheckpointTimeline.jsx";

afterEach(() => {
  cleanup();
});

describe("CheckpointTimeline", () => {
  it("shows the repo selection empty state before a repo is chosen", () => {
    render(<CheckpointTimeline repo="" checkpoints={null} />);

    expect(screen.getByText("Load a repo to view checkpoint usage.")).toBeTruthy();
    expect(screen.getByText("Checkpoint timeline")).toBeTruthy();
  });

  it("uses the current unavailable copy for branch_not_fetched and does not show old file-browser wording", () => {
    render(
      <CheckpointTimeline
        repo="/Users/dev/repo"
        checkpoints={{ available: false, reason: "branch_not_fetched" }}
      />,
    );

    expect(screen.getByText("Checkpoint branch is not fetched for this repository.")).toBeTruthy();
    expect(screen.queryByText("Checkpoint files")).toBeNull();
  });

  it("renders one checkpoint card per grouped checkpoint without exposing metadata.json as primary text", () => {
    render(
      <CheckpointTimeline
        repo="/Users/dev/repo"
        checkpoints={{
          available: true,
          files: [
            "06/e2abdc1ec6/metadata.json",
            "06/e2abdc1ec6/0/prompt.txt",
            "06/e2abdc1ec6/0/full.jsonl",
            "23/183a892518/metadata.json",
            "23/183a892518/0/prompt.txt",
            "23/183a892518/0/full.jsonl",
          ],
          checkpoint_usage: {
            "06/e2abdc1ec6": {
              status: "metadata",
              branch: "main",
              provider: "codex",
              model: "gpt-5.5",
              total_tokens: 12345,
              total_cost_usd: 0.42,
              session_count: 2,
              models: [{ model: "gpt-5.5", total_tokens: 12345, total_cost_usd: 0.42 }],
              providers: [{ provider: "codex", total_tokens: 12345, total_cost_usd: 0.42 }],
            },
            "23/183a892518": {
              status: "unmatched",
              branch: "main",
              provider: "codex",
              model: "gpt-5.5",
              total_tokens: 6789,
              total_cost_usd: 0.21,
              session_count: 1,
              models: [{ model: "gpt-5.5", total_tokens: 6789, total_cost_usd: 0.21 }],
              providers: [{ provider: "codex", total_tokens: 6789, total_cost_usd: 0.21 }],
            },
          },
        }}
      />,
    );

    expect(screen.getByRole("region", { name: "Checkpoint 06/e2abdc1ec6" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Checkpoint 23/183a892518" })).toBeTruthy();
    expect(screen.queryByText(/metadata\.json/i)).toBeNull();
  });
});

