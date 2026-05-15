/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { AdvancedConfigurePanel } from "./AdvancedConfigurePanel.jsx";
import { postEntireCommand } from "../../lib/vibedeck-api";

vi.mock("../../lib/vibedeck-api", () => ({
  postEntireCommand: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdvancedConfigurePanel", () => {
  it("preserves simple whitespace configure args", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" onActionSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "--agent codex --mode careful" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("configure", {
        repo: "/tmp/project",
        args: ["--agent", "codex", "--mode", "careful"],
      });
    });
  });

  it("parses quoted configure values", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" onActionSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: '--label "Product Review" --agent codex' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("configure", {
        repo: "/tmp/project",
        args: ["--label", "Product Review", "--agent", "codex"],
      });
    });
  });

  it("shows a parse error for unmatched quotes and skips the backend call", async () => {
    render(<AdvancedConfigurePanel repo="/tmp/project" onActionSuccess={vi.fn()} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: '--label "Product Review' },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run configure" }));

    expect(await screen.findByText(/Unmatched quote in configure arguments\./)).toBeTruthy();
    expect(postEntireCommand).not.toHaveBeenCalled();
  });
});
