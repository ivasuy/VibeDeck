import { afterEach, describe, expect, it, vi } from "vitest";
import { clearLocalApiAuthToken } from "../local-api-auth";
import {
  confirmDestructive,
  getAttributionStats,
  getBranchUsage,
  getCheckpoint,
  getCheckpoints,
  getEntireStatus,
  getSyncStatus,
  postAttribute,
  postEntireCommand,
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

  it("fetches Entire status and checkpoints with repo parameters", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

    await getEntireStatus("/repo", fetchMock as any);
    await getCheckpoints("/repo", fetchMock as any);
    await getCheckpoint("/repo", "checkpoint.json", fetchMock as any);

    expect(fetchMock.mock.calls[0][0]).toContain("/functions/vibedeck-entire-status");
    expect(fetchMock.mock.calls[0][0]).toContain("repo=%2Frepo");
    expect(fetchMock.mock.calls[0][0]).toContain("cached=1");
    expect(fetchMock.mock.calls[1][0]).toContain("/functions/vibedeck-checkpoints");
    expect(fetchMock.mock.calls[2][0]).toContain("/functions/vibedeck-checkpoint");
    expect(fetchMock.mock.calls[2][0]).toContain("path=checkpoint.json");
  });

  it("posts attribution and Entire commands with local auth headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "abc" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ exitCode: 0 }) });

    await postAttribute({ provider: "codex", session_id: "s1", branch: "main" }, fetchMock as any);
    await postEntireCommand("status", { repo: "/repo" }, fetchMock as any);

    expect(fetchMock.mock.calls[1][0]).toBe("/functions/vibedeck-attribute");
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
    expect(fetchMock.mock.calls[1][1].headers["x-tokentracker-local-auth"]).toBe("abc");
    expect(fetchMock.mock.calls[2][0]).toBe("/functions/vibedeck-entire/status");
    expect(fetchMock.mock.calls[2][1].method).toBe("POST");
    expect(fetchMock.mock.calls[2][1].headers["x-tokentracker-local-auth"]).toBe("abc");
  });

  it("issues destructive confirm tokens", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "abc" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "confirm", op: "cleanEntire" }) });

    const out = await confirmDestructive("cleanEntire", fetchMock as any);

    expect(out.token).toBe("confirm");
    expect(fetchMock.mock.calls[1][0]).toBe("/functions/vibedeck-confirm-destructive");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ op: "cleanEntire" });
  });
});
