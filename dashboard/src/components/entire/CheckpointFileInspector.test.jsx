/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { CheckpointFileInspector } from "./CheckpointFileInspector";

afterEach(() => {
  cleanup();
});

describe("CheckpointFileInspector", () => {
  it("shows only preview and raw tabs for text files", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/0/prompt.txt",
          file_name: "prompt.txt",
          kind: "text",
          raw: "Quality review",
          parsed: null,
          size_bytes: 14,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Raw" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Parsed" })).toBeNull();
  });

  it("shows parse errors in preview mode for json files", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/broken.json",
          file_name: "broken.json",
          kind: "json",
          raw: "{\"broken\":",
          parsed: null,
          parse_error: "Unexpected end of JSON input",
          size_bytes: 10,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByText("Parse error")).toBeTruthy();
    expect(screen.getByText("Unexpected end of JSON input")).toBeTruthy();
  });

  it("shows parsed for hash files", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/0/content_hash.txt",
          file_name: "content_hash.txt",
          kind: "hash",
          raw: "sha256:abc123",
          parsed: { algorithm: "sha256", value: "abc123" },
          size_bytes: 13,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getAllByRole("button", { name: "Parsed" }).length).toBe(1);
  });

  it("renders metadata cost as a preview card without token/model badges", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/metadata.json",
          file_name: "metadata.json",
          kind: "json",
          raw: "{\"branch\":\"publish-main\"}",
          parsed: { branch: "publish-main" },
          usage: {
            status: "metadata",
            total_tokens: 12345,
            total_cost_usd: 0.42,
            cost_quality: "checkpoint_metadata",
            model: "claude-sonnet-4-6",
            provider: "claude",
          },
          size_bytes: 25,
          line_count: 1,
        }}
      />,
    );

    expect(screen.queryByText("Usage preview")).toBeNull();
    expect(screen.getByText("COST")).toBeTruthy();
    expect(screen.getByText("$0.42")).toBeTruthy();
    expect(screen.queryByText("12,345")).toBeNull();
    expect(screen.queryByText("claude-sonnet-4-6")).toBeNull();
    expect(screen.queryByText("claude")).toBeNull();
  });

  it("caps large raw payload rendering and shows a truncation notice", async () => {
    const longRaw = "x".repeat(12050);

    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/large.txt",
          file_name: "large.txt",
          kind: "text",
          raw: longRaw,
          parsed: null,
          size_bytes: longRaw.length,
          line_count: 1,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Raw" }));

    expect(await screen.findByText("Preview truncated to 12,000 characters.")).toBeTruthy();
    expect(screen.queryByText(longRaw)).toBeNull();
  });

  it("caps large text previews in the default preview tab", async () => {
    const longRaw = "y".repeat(12050);

    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/large.txt",
          file_name: "large.txt",
          kind: "text",
          raw: longRaw,
          parsed: null,
          size_bytes: longRaw.length,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toBeTruthy();
    expect(await screen.findByText("Preview truncated to 12,000 characters.")).toBeTruthy();
    expect(screen.queryByText(longRaw)).toBeNull();
  });

  it("renders unmatched and ambiguous usage states without zero-dollar fallback", () => {
    const { rerender } = render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/metadata.json",
          file_name: "metadata.json",
          kind: "json",
          raw: "{}",
          parsed: {},
          usage: {
            status: "unmatched",
            confidence: "unmatched",
            total_tokens: null,
            total_cost_usd: null,
            cost_quality: "unknown",
            reason: "no_matching_session",
          },
          size_bytes: 2,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByText("Usage not linked")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();

    rerender(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/metadata.json",
          file_name: "metadata.json",
          kind: "json",
          raw: "{}",
          parsed: {},
          usage: {
            status: "ambiguous",
            confidence: "ambiguous",
            total_tokens: null,
            total_cost_usd: null,
            cost_quality: "unknown",
            reason: "multiple_matching_sessions",
          },
          size_bytes: 2,
          line_count: 1,
        }}
      />,
    );
    expect(screen.getByText("Ambiguous usage")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows Unknown cost for linked usage with unknown cost", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/metadata.json",
          file_name: "metadata.json",
          kind: "json",
          raw: "{}",
          parsed: {},
          usage: {
            status: "linked",
            confidence: "linked",
            total_tokens: 123,
            total_cost_usd: null,
            known_cost_usd: 0,
            cost_unknown_count: 1,
            cost_quality: "unknown",
            models: [{ model: "gpt-5.5", total_tokens: 123, total_cost_usd: null }],
            providers: [{ provider: "codex", total_tokens: 123, total_cost_usd: null }],
          },
          size_bytes: 2,
          line_count: 1,
        }}
      />,
    );
    expect(screen.getByText("Unknown cost")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows Usage not linked for metadata file with no usage object", () => {
    render(
      <CheckpointFileInspector
        file={{
          path: "06/e2abdc1ec6/metadata.json",
          file_name: "metadata.json",
          kind: "json",
          raw: "{}",
          parsed: {},
          size_bytes: 2,
          line_count: 1,
        }}
      />,
    );

    expect(screen.getByText("Usage not linked")).toBeTruthy();
    expect(screen.queryByText("$0.00")).toBeNull();
  });

  it("shows copied status when clipboard writeText resolves", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;

    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <CheckpointFileInspector
          file={{
            path: "06/e2abdc1ec6/prompt.txt",
            file_name: "prompt.txt",
            kind: "text",
            raw: "Quality review",
            parsed: null,
            size_bytes: 14,
            line_count: 1,
          }}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      expect(writeText).toHaveBeenCalledWith("Quality review");
      await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });

  it("shows copy failed status when clipboard writeText rejects", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    const originalClipboard = navigator.clipboard;

    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText },
      });

      render(
        <CheckpointFileInspector
          file={{
            path: "06/e2abdc1ec6/prompt.txt",
            file_name: "prompt.txt",
            kind: "text",
            raw: "Quality review",
            parsed: null,
            size_bytes: 14,
            line_count: 1,
          }}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));

      expect(writeText).toHaveBeenCalledWith("Quality review");
      await waitFor(() => expect(screen.getByText("Copy failed")).toBeTruthy());
    } finally {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: originalClipboard,
      });
    }
  });
});
