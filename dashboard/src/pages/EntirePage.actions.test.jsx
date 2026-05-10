/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../test/test-utils";
import { EntirePage } from "./EntirePage.jsx";

const getEntireStatus = vi.fn();
const getCheckpoints = vi.fn();
const getCheckpoint = vi.fn();
const getBranchUsage = vi.fn();
const postEntireCommand = vi.fn();
const confirmDestructive = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getEntireStatus: (...args) => getEntireStatus(...args),
  getCheckpoints: (...args) => getCheckpoints(...args),
  getCheckpoint: (...args) => getCheckpoint(...args),
  getBranchUsage: (...args) => getBranchUsage(...args),
  postEntireCommand: (...args) => postEntireCommand(...args),
  confirmDestructive: (...args) => confirmDestructive(...args),
}));

async function loadRepo(repo = "/Users/dev/repo") {
  const input = await screen.findByPlaceholderText("/Users/you/project");
  fireEvent.change(input, { target: { value: repo } });
  fireEvent.click(screen.getByRole("button", { name: "Load repo" }));
  await screen.findByText("Active");
}

beforeEach(() => {
  getEntireStatus.mockReset();
  getCheckpoints.mockReset();
  getCheckpoint.mockReset();
  getBranchUsage.mockReset();
  postEntireCommand.mockReset();
  confirmDestructive.mockReset();

  getBranchUsage.mockResolvedValue({ repos: [] });
  getEntireStatus.mockResolvedValue({ state: "active" });
  getCheckpoints.mockResolvedValue({ available: true, files: [] });
  postEntireCommand.mockResolvedValue({ ok: true, stdout: "ok" });
});

afterEach(() => {
  cleanup();
});

describe("EntirePage write actions", () => {
  it("enables Entire with selected agents", async () => {
    render(<EntirePage />);
    await loadRepo();

    fireEvent.click(screen.getByLabelText("codex"));
    fireEvent.click(screen.getByLabelText("gemini"));
    fireEvent.click(screen.getByRole("button", { name: "Enable" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("enable", {
        repo: "/Users/dev/repo",
        agents: expect.arrayContaining(["codex", "gemini"]),
      });
    });
  });

  it("disables Entire for selected repo", async () => {
    render(<EntirePage />);
    await loadRepo();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenCalledWith("disable", { repo: "/Users/dev/repo" });
    });
  });

  it("runs doctor and status and renders command output", async () => {
    postEntireCommand
      .mockResolvedValueOnce({ ok: true, stdout: "doctor: healthy" })
      .mockResolvedValueOnce({ ok: true, stdout: "status: active" });

    render(<EntirePage />);
    await loadRepo();

    fireEvent.click(screen.getByRole("button", { name: "Doctor" }));
    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenNthCalledWith(1, "doctor", { repo: "/Users/dev/repo" });
    });
    fireEvent.click(screen.getByRole("button", { name: "Status" }));

    await waitFor(() => {
      expect(postEntireCommand).toHaveBeenNthCalledWith(1, "doctor", { repo: "/Users/dev/repo" });
      expect(postEntireCommand).toHaveBeenNthCalledWith(2, "status", { repo: "/Users/dev/repo" });
    });

    expect(await screen.findByText("status: active")).toBeTruthy();
  });

  it("keeps configure behind advanced disclosure", async () => {
    render(<EntirePage />);
    await loadRepo();

    expect(screen.queryByRole("button", { name: "Run configure" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced raw configure" }));
    expect(await screen.findByRole("button", { name: "Run configure" })).toBeTruthy();
  });

  it("confirms destructive actions before rewind/clean commands", async () => {
    confirmDestructive
      .mockResolvedValueOnce({ token: "rewind-token" })
      .mockResolvedValueOnce({ token: "clean-token" });
    postEntireCommand
      .mockResolvedValueOnce({ ok: true, stdout: "rewound" })
      .mockResolvedValueOnce({ ok: true, stdout: "cleaned" });

    render(<EntirePage />);
    await loadRepo();

    fireEvent.change(screen.getByPlaceholderText("checkpoint-id"), { target: { value: "cp-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
    await waitFor(() => {
      expect(confirmDestructive).toHaveBeenNthCalledWith(1, "rewindCheckpoint");
      expect(postEntireCommand).toHaveBeenNthCalledWith(1, "rewind", {
        repo: "/Users/dev/repo",
        checkpointId: "cp-001",
        confirm_token: "rewind-token",
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));

    await waitFor(() => {
      expect(confirmDestructive).toHaveBeenNthCalledWith(2, "cleanEntire");
      expect(postEntireCommand).toHaveBeenNthCalledWith(2, "clean", {
        repo: "/Users/dev/repo",
        all: false,
        confirm_token: "clean-token",
      });
    });

    expect(confirmDestructive.mock.invocationCallOrder[0]).toBeLessThan(
      postEntireCommand.mock.invocationCallOrder[0],
    );
    expect(confirmDestructive.mock.invocationCallOrder[1]).toBeLessThan(
      postEntireCommand.mock.invocationCallOrder[1],
    );
  });
});
