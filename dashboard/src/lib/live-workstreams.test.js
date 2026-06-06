import { describe, expect, it } from "vitest";
import { buildLiveWorkstreams, isActiveLiveSession, liveBranchLabel, liveScopeLabel } from "./live-workstreams.js";

describe("buildLiveWorkstreams fallback ordering", () => {
  it("orders using observed activity instead of updated_at for open sessions", () => {
    const workstreams = buildLiveWorkstreams([
      {
        provider: "claude",
        session_id: "stale-but-mutated",
        repo_root: "/repo/a",
        started_at: "2026-04-01T00:00:00.000Z",
        last_observed_at: "2026-04-01T00:05:00.000Z",
        updated_at: "2026-05-12T00:00:00.000Z",
        total_tokens: 100,
      },
      {
        provider: "claude",
        session_id: "fresh-observed",
        repo_root: "/repo/b",
        started_at: "2026-05-12T00:00:00.000Z",
        last_observed_at: "2026-05-12T00:10:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        total_tokens: 100,
      },
    ]);

    expect(workstreams.map((row) => row.primary_session?.session_id)).toEqual([
      "fresh-observed",
      "stale-but-mutated",
    ]);
  });

  it("labels cwd_only and session_only scopes distinctly", () => {
    expect(liveScopeLabel({ audit_scope: "cwd_only" })).toBe("No Git repo");
    expect(liveScopeLabel({ audit_scope: "session_only" })).toBe("Session only");
    expect(liveScopeLabel({ audit_scope: "project" })).toBe("");
  });

  it("labels branch as unavailable for cwd_only scope", () => {
    expect(liveBranchLabel({ audit_scope: "cwd_only", branches: ["unattributed"] }, { branch: "unattributed" }))
      .toBe("Branch unavailable");
    expect(liveBranchLabel({ branches: ["main"] }, {})).toBe("main");
  });

  it("treats superseded open sessions as stale in frontend fallback grouping", () => {
    const sessions = [
      {
        provider: "codex",
        session_id: "old-cleanup-ui-fix",
        started_at: "2026-05-19T05:00:00.000Z",
        ended_at: null,
        cwd: "/repo/VibeDeck",
        repo_root: "/repo/VibeDeck",
        branch: "cleanup/ui-fix",
        model: "gpt-5.5",
        total_tokens: 100,
        total_cost_usd: 1,
        live_state: "superseded",
        last_observed_at: "2026-05-19T05:10:00.000Z",
      },
      {
        provider: "codex",
        session_id: "new-release",
        started_at: "2026-05-19T05:20:00.000Z",
        ended_at: null,
        cwd: "/repo/VibeDeck",
        repo_root: "/repo/VibeDeck",
        branch: "release/0.1.3",
        model: "gpt-5.5",
        total_tokens: 25,
        total_cost_usd: 0.25,
        last_observed_at: "2026-05-19T05:25:00.000Z",
      },
    ];

    expect(isActiveLiveSession(sessions[0])).toBe(false);
    expect(isActiveLiveSession(sessions[1])).toBe(true);

    const workstreams = buildLiveWorkstreams(sessions, {
      now: Date.parse("2026-05-19T05:30:00.000Z"),
    });

    expect(workstreams).toHaveLength(1);
    expect(workstreams[0].active_session_count).toBe(1);
    expect(workstreams[0].recently_completed_count).toBe(1);

    const cleanup = workstreams[0].branch_groups.find((row) => row.branch === "cleanup/ui-fix");
    const release = workstreams[0].branch_groups.find((row) => row.branch === "release/0.1.3");
    expect(cleanup).toBeTruthy();
    expect(release).toBeTruthy();
    expect(cleanup.active_session_count).toBe(0);
    expect(cleanup.recently_completed_count).toBe(1);
    expect(release.active_session_count).toBe(1);
    expect(release.recently_completed_count).toBe(0);
  });
});
