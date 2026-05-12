import { describe, expect, it } from "vitest";
import { buildLiveWorkstreams, liveBranchLabel, liveScopeLabel } from "./live-workstreams.js";

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
});
