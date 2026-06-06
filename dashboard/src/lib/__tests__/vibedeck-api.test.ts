import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalApiAuthToken } from "../local-api-auth";
import {
  getAttributionStats,
  getBranchUsage,
  getCurrencyRates,
  getForecastView,
  getOptimizeFindings,
  getPlanView,
  getSyncStatus,
  postAttribute,
} from "../vibedeck-api";

describe("vibedeck-api", () => {
  afterEach(() => {
    clearLocalApiAuthToken();
  });

  it("fetches attribution stats without local auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ totals: {} }) });

    await getAttributionStats(fetchMock as any);

    expect(fetchMock).toHaveBeenCalledWith("/functions/vibedeck-attribution-stats", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  });

  it("fetches sync status without local auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sync_enabled: true }) });

    await getSyncStatus(fetchMock as any);

    expect(fetchMock).toHaveBeenCalledWith("/functions/vibedeck-sync-status", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
  });

  it("fetches branch usage with include_sessions", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ repos: [] }) });

    await getBranchUsage({ repo: "/repo", includeSessions: true }, fetchMock as any);

    expect(fetchMock.mock.calls[0][0]).toContain("/functions/vibedeck-branch-usage");
    expect(fetchMock.mock.calls[0][0]).toContain("repo=%2Frepo");
    expect(fetchMock.mock.calls[0][0]).toContain("include_sessions=1");
  });

  it("fetches Phase 5 optimize plan currency and forecast endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await getOptimizeFindings({}, fetchMock as any);
    await getPlanView({}, fetchMock as any);
    await getCurrencyRates({ currency: "EUR" }, fetchMock as any);
    await getForecastView({}, fetchMock as any);

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual(expect.arrayContaining([
      expect.stringContaining("/functions/vibedeck-optimize/findings"),
      expect.stringContaining("/functions/vibedeck-plan"),
      expect.stringContaining("/functions/vibedeck-currency-rates"),
      expect.stringContaining("/functions/vibedeck-forecast"),
    ]));
  });

  it("posts attribution with local auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "abc" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    await postAttribute({ provider: "codex", session_id: "s1", branch: "main" }, fetchMock as any);

    expect(fetchMock.mock.calls[1][0]).toBe("/functions/vibedeck-attribute");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].headers["x-vibedeck-local-auth"]).toBe("abc");
  });
});
