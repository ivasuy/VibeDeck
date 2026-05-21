// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectUsageSummary } from "./use-project-usage-summary";

const getProjectUsageSummary = vi.fn();

vi.mock("../lib/api", () => ({
  getProjectUsageSummary: (...args: any[]) => getProjectUsageSummary(...args),
}));

describe("useProjectUsageSummary", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    getProjectUsageSummary.mockReset();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("hydrates from the last good project usage while a refresh is pending", async () => {
    getProjectUsageSummary.mockResolvedValueOnce({
      entries: [{ project_key: "VibeDeck", total_tokens: 100 }],
    });

    const first = renderHook(() =>
      useProjectUsageSummary({
        baseUrl: "http://127.0.0.1:7690",
        from: "2026-05-01",
        to: "2026-05-17",
        limit: 10,
      }),
    );

    await waitFor(() => {
      expect(first.result.current.entries).toEqual([{ project_key: "VibeDeck", total_tokens: 100 }]);
    });
    first.unmount();

    getProjectUsageSummary.mockImplementationOnce(() => new Promise(() => {}));

    const second = renderHook(() =>
      useProjectUsageSummary({
        baseUrl: "http://127.0.0.1:7690",
        from: "2026-05-01",
        to: "2026-05-17",
        limit: 10,
      }),
    );

    await waitFor(() => {
      expect(second.result.current.entries).toEqual([{ project_key: "VibeDeck", total_tokens: 100 }]);
      expect(second.result.current.hasData).toBe(true);
      expect(second.result.current.initialLoading).toBe(false);
      expect(second.result.current.refreshing).toBe(true);
      expect(second.result.current.stale).toBe(true);
    });
  });
});
