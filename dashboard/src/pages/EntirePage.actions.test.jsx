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
const getKnownRepos = vi.fn();
const postEntireCommand = vi.fn();
const confirmDestructive = vi.fn();

vi.mock("../lib/vibedeck-api", () => ({
  getEntireStatus: (...args) => getEntireStatus(...args),
  getCheckpoints: (...args) => getCheckpoints(...args),
  getCheckpoint: (...args) => getCheckpoint(...args),
  getBranchUsage: (...args) => getBranchUsage(...args),
  getKnownRepos: (...args) => getKnownRepos(...args),
  postEntireCommand: (...args) => postEntireCommand(...args),
  confirmDestructive: (...args) => confirmDestructive(...args),
}));

function createStorage() {
  const data = new Map();
  return {
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => {
      data.set(String(key), String(value));
    }),
    removeItem: vi.fn((key) => {
      data.delete(key);
    }),
    clear: vi.fn(() => {
      data.clear();
    }),
  };
}

async function loadRepo(repo = "/Users/dev/repo") {
  const input = await screen.findByPlaceholderText("/Users/you/project");
  fireEvent.change(input, { target: { value: repo } });
  fireEvent.click(screen.getByRole("button", { name: "Load repo" }));
  await screen.findByText("Active");
}

async function openActionsPanel() {
  await screen.findByText("Actions");
}

async function openConfigurePanel() {
  await screen.findByText("Configure");
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: createStorage(),
  });

  getEntireStatus.mockReset();
  getCheckpoints.mockReset();
  getCheckpoint.mockReset();
  getBranchUsage.mockReset();
  getKnownRepos.mockReset();
  postEntireCommand.mockReset();
  confirmDestructive.mockReset();
  window.localStorage.clear();

  getKnownRepos.mockResolvedValue({ repos: [] });
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
    await openActionsPanel();

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
    await openActionsPanel();

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
    await openActionsPanel();

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

  it("renders configure controls in the fixed workspace tile", async () => {
    render(<EntirePage />);
    await loadRepo();

    expect(await screen.findByRole("button", { name: "Run configure" })).toBeTruthy();
  });

  it("remembers action controls per repo", async () => {
    render(<EntirePage />);
    await loadRepo("/Users/dev/repo");
    await openActionsPanel();

    fireEvent.click(screen.getByLabelText("codex"));
    fireEvent.change(screen.getByPlaceholderText("checkpoint-id"), { target: { value: "cp-001" } });
    fireEvent.click(screen.getByLabelText("Clean all checkpoints"));

    await waitFor(() => {
      expect(window.localStorage.getItem("vibedeck:entire:actions:/Users/dev/repo")).toContain("cp-001");
    });

    cleanup();
    render(<EntirePage />);
    await loadRepo("/Users/dev/repo");
    await openActionsPanel();

    expect(screen.getByLabelText("codex").checked).toBe(true);
    expect(screen.getByPlaceholderText("checkpoint-id").value).toBe("cp-001");
    expect(screen.getByLabelText("Clean all checkpoints").checked).toBe(true);
  });

  it("loads saved configure args for the selected repo", async () => {
    render(<EntirePage />);
    await loadRepo("/Users/dev/repo");

    await openConfigurePanel();
    fireEvent.change(await screen.findByPlaceholderText("--arg value --flag"), {
      target: { value: "--agent codex --mode careful" },
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("vibedeck:entire:configure:/Users/dev/repo")).toContain("--agent codex");
    });

    cleanup();
    render(<EntirePage />);
    await loadRepo("/Users/dev/repo");
    await openConfigurePanel();

    expect(await screen.findByDisplayValue("--agent codex --mode careful")).toBeTruthy();
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
    await openActionsPanel();

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
