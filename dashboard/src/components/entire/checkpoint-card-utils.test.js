import { describe, expect, it } from "vitest";
import {
  buildCheckpointCards,
  summarizeJsonlPayload,
  usageCostLabel,
  usageStatusLabel,
} from "./checkpoint-card-utils";

describe("checkpoint-card-utils", () => {
  it("builds one card per checkpoint with accumulated usage and important file paths", () => {
    const cards = buildCheckpointCards({
      checkpoints: {
        available: true,
        files: [
          "06/e2abdc1ec6/metadata.json",
          "06/e2abdc1ec6/0/prompt.txt",
          "06/e2abdc1ec6/0/full.jsonl",
          "06/e2abdc1ec6/0/content_hash.txt",
        ],
        checkpoint_usage: {
          "06/e2abdc1ec6": {
            status: "metadata",
            confidence: "metadata",
            branch: "main",
            provider: "codex",
            model: "gpt-5.5",
            total_tokens: 12345,
            total_cost_usd: 0.42,
            cost_quality: "checkpoint_metadata",
            session_count: 2,
            models: [
              { model: "gpt-5.5", total_tokens: 9000, total_cost_usd: 0.3 },
              { model: "claude-sonnet-4-6", total_tokens: 3345, total_cost_usd: 0.12 },
            ],
            providers: [
              { provider: "codex", total_tokens: 9000, total_cost_usd: 0.3 },
              { provider: "claude", total_tokens: 3345, total_cost_usd: 0.12 },
            ],
          },
        },
      },
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "06/e2abdc1ec6",
      label: "06/e2abdc1ec6",
      metadataPath: "06/e2abdc1ec6/metadata.json",
      promptPath: "06/e2abdc1ec6/0/prompt.txt",
      jsonlPath: "06/e2abdc1ec6/0/full.jsonl",
      hashPath: "06/e2abdc1ec6/0/content_hash.txt",
      branch: "main",
      provider: "codex",
      topModel: "gpt-5.5",
      totalTokens: 12345,
      totalCostUsd: 0.42,
      costQuality: "checkpoint_metadata",
      sessionCount: 2,
    });
    expect(cards[0].modelRows).toEqual([
      { label: "gpt-5.5", tokens: 9000, costUsd: 0.3 },
      { label: "claude-sonnet-4-6", tokens: 3345, costUsd: 0.12 },
    ]);
    expect(cards[0].providerRows).toEqual([
      { label: "codex", tokens: 9000, costUsd: 0.3 },
      { label: "claude", tokens: 3345, costUsd: 0.12 },
    ]);
  });

  it("prefers checkpoint root metadata over child metadata files", () => {
    const cards = buildCheckpointCards({
      checkpoints: {
        available: true,
        files: [
          "06/e2abdc1ec6/0/metadata.json",
          "06/e2abdc1ec6/metadata.json",
          "06/e2abdc1ec6/0/prompt.txt",
        ],
      },
    });

    expect(cards).toHaveLength(1);
    expect(cards[0].metadataPath).toBe("06/e2abdc1ec6/metadata.json");
  });

  it("returns no cards for empty outer input", () => {
    expect(buildCheckpointCards()).toEqual([]);
    expect(buildCheckpointCards(null)).toEqual([]);
  });

  it("keeps unmatched and ambiguous usage from rendering as zero-dollar cost", () => {
    expect(usageStatusLabel({ status: "unmatched" })).toBe("Usage not linked");
    expect(usageStatusLabel({ status: "ambiguous" })).toBe("Ambiguous usage");
    expect(usageCostLabel({ total_cost_usd: null, cost_unknown_count: 0 })).toBe("");
    expect(usageCostLabel({ total_cost_usd: null, cost_unknown_count: 1 })).toBe("Unknown cost");
  });

  it("summarizes jsonl parsed payloads into event counts without exposing raw preview lines", () => {
    const summary = summarizeJsonlPayload({
      line_count: 6,
      parsed: {
        valid_lines: 5,
        invalid_lines: 1,
        preview: [
          { line: 1, value: { type: "user", sessionId: "s1" } },
          { line: 2, value: { type: "assistant", sessionId: "s1" } },
          { line: 3, value: { type: "assistant", sessionId: "s1" } },
          { line: 4, value: { type: "attachment", sessionId: "s1" } },
          { line: 5, value: { type: "queue-operation", sessionId: "s1" } },
          { line: 6, error: "Unexpected token", raw: "not-json" },
        ],
      },
    });

    expect(summary).toEqual({
      lineCount: 6,
      validLines: 5,
      invalidLines: 1,
      eventRows: [
        { label: "assistant", count: 2 },
        { label: "attachment", count: 1 },
        { label: "queue-operation", count: 1 },
        { label: "user", count: 1 },
      ],
    });
  });

  it("summarizes jsonl event counts from full raw content when preview is capped", () => {
    const summary = summarizeJsonlPayload({
      line_count: 7,
      raw: [
        JSON.stringify({ type: "user" }),
        JSON.stringify({ value: { type: "assistant" } }),
        JSON.stringify({ type: "assistant" }),
        JSON.stringify({ value: { type: "tool" } }),
        "",
        "not-json",
        JSON.stringify({ type: "user" }),
      ].join("\n"),
      parsed: {
        valid_lines: 5,
        invalid_lines: 1,
        preview: [
          { line: 1, value: { type: "user" } },
          { line: 2, value: { type: "assistant" } },
        ],
      },
    });

    expect(summary).toEqual({
      lineCount: 7,
      validLines: 5,
      invalidLines: 1,
      eventRows: [
        { label: "assistant", count: 2 },
        { label: "user", count: 2 },
        { label: "tool", count: 1 },
      ],
    });
  });
});
