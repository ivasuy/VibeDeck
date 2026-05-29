import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
import { WidgetsPage } from "./WidgetsPage.jsx";

const api = vi.hoisted(() => ({
  getStartupSnapshot: vi.fn(),
}));

vi.mock("../lib/vibedeck-api", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getStartupSnapshot: api.getStartupSnapshot,
  };
});

function installNativeBridge(settings) {
  const messages = [];
  window.history.pushState({}, "", "/widgets?app=1");
  window.webkit = {
    messageHandlers: {
      nativeBridge: {
        postMessage(message) {
          messages.push(message);
        },
      },
    },
  };
  return {
    messages,
    pushSettings() {
      window.dispatchEvent(new CustomEvent("native:settings", { detail: settings }));
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  window.history.pushState({}, "", "/");
  if (typeof window.localStorage?.removeItem === "function") {
    window.localStorage.removeItem("vibedeck_native_app");
  }
  delete window.webkit;
});

beforeEach(() => {
  api.getStartupSnapshot.mockReset();
  api.getStartupSnapshot.mockResolvedValue({
    freshness: {
      mode: "complete",
      recent_ready: true,
      historical_ready: true,
      active_rebuild: false,
      complete_through: "2026-05-29T03:00:00.000Z",
      indexing_providers: [],
      failed_shards: [],
    },
  });
});

describe("WidgetsPage menu bar configurator", () => {
  it("renders concrete widget gallery labels instead of unresolved copy keys", () => {
    render(<WidgetsPage />);

    expect(screen.getAllByText("Summary").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Heatmap").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Top Models").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Usage Limits").length).toBeGreaterThan(0);
    expect(screen.queryByText("widgets.summary.name")).toBeNull();
    expect(screen.queryByText("widgets.heatmap.name")).toBeNull();
    expect(screen.queryByText("widgets.topModels.name")).toBeNull();
    expect(screen.queryByText("widgets.limits.name")).toBeNull();
  });

  it("shows historical indexing readiness without blocking widget previews", async () => {
    api.getStartupSnapshot.mockResolvedValue({
      freshness: {
        mode: "partial",
        recent_ready: true,
        historical_ready: false,
        active_rebuild: true,
        complete_through: null,
        indexing_providers: ["codex"],
        failed_shards: [],
      },
    });

    render(<WidgetsPage />);

    expect(await screen.findByText("Indexing historical data")).toBeTruthy();
    expect(screen.getAllByText("Summary").length).toBeGreaterThan(0);
  });

  it("renders provider logos inside the desktop widget previews", () => {
    render(<WidgetsPage />);

    expect(screen.getAllByRole("img", { name: "Claude logo" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Codex logo" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Cursor logo" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Gemini logo" }).length).toBeGreaterThan(0);
  });

  it("renders the widget configuration workbench controls", () => {
    render(<WidgetsPage />);

    const providerSelect = screen.getByLabelText("Highlighted Provider");

    expect(screen.getByText("Widget Configuration")).toBeTruthy();
    expect(screen.getByText("Size")).toBeTruthy();
    expect(screen.getByText("Refresh")).toBeTruthy();
    expect(screen.getByText("Highlighted Provider")).toBeTruthy();
    expect(screen.getByLabelText("Refresh")).toHaveValue("5m");
    expect(providerSelect).toHaveValue("claude");
    expect([...providerSelect.options].map((option) => option.value)).toEqual([
      "antigravity",
      "claude",
      "codex",
      "copilot",
      "cursor",
      "factoryai",
      "gemini",
      "hermes",
      "kimi",
      "kiro",
      "openclaw",
      "opencode",
    ]);
  });

  it("edits the two menu bar preview slots through NativeBridge", async () => {
    const user = userEvent.setup();
    const bridge = installNativeBridge({
      showStats: true,
      menuBarItems: ["todayTokens", "claude5h"],
      menuBarMaxItems: 2,
      menuBarAvailableItems: [
        { id: "todayTokens", label: "Today Tokens", shortLabel: "Tokens", category: "tokens" },
        { id: "todayCost", label: "Today Cost", shortLabel: "Cost", category: "cost" },
        { id: "claude5h", label: "Claude 5h Limit", shortLabel: "Cl 5h", category: "limits" },
      ],
    });

    render(<WidgetsPage />);
    act(() => bridge.pushSettings());

    const primary = await screen.findByLabelText(copy("menubar.slot.primary"));
    const secondary = screen.getByLabelText(copy("menubar.slot.secondary"));

    expect(primary).toHaveValue("todayTokens");
    expect(secondary).toHaveValue("claude5h");
    expect([...secondary.options].map((option) => option.value)).not.toContain("todayTokens");

    await act(async () => {
      await user.selectOptions(secondary, "todayCost");
    });

    await waitFor(() => {
      expect(bridge.messages).toContainEqual({
        type: "setSetting",
        key: "menuBarItems",
        value: ["todayTokens", "todayCost"],
      });
    });
  });
});
