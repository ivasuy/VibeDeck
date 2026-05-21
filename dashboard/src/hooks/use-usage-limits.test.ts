// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUsageLimits } from "./use-usage-limits";

const getUsageLimits = vi.fn();

vi.mock("../lib/api", () => ({
  getUsageLimits: (...args: any[]) => getUsageLimits(...args),
}));

describe("useUsageLimits", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    getUsageLimits.mockReset();
  });

  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("shows cached limit data immediately and refreshes in the background", async () => {
    getUsageLimits.mockResolvedValueOnce({
      fetched_at: "2026-05-17T00:00:00.000Z",
      claude: { configured: true, five_hour: { utilization: 12 } },
    });

    const first = renderHook(() => useUsageLimits({ initialRefresh: true }));

    await waitFor(() => {
      expect(first.result.current.data?.claude?.five_hour?.utilization).toBe(12);
    });
    first.unmount();

    getUsageLimits.mockImplementationOnce(() => new Promise(() => {}));

    const second = renderHook(() => useUsageLimits({ initialRefresh: true }));

    expect(second.result.current.data?.claude?.five_hour?.utilization).toBe(12);
    expect(second.result.current.isLoading).toBe(false);
    expect(second.result.current.isRefreshing).toBe(true);
    expect(second.result.current.hasData).toBe(true);
    expect(second.result.current.stale).toBe(true);
  });
});
