/* @vitest-environment jsdom */

import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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
});
