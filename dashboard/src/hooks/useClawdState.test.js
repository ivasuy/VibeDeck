import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { resolveClawdState, useClawdState } from "./useClawdState.js";

describe("resolveClawdState", () => {
  it("maps live session count to the DESIGN.md Clawd working states", () => {
    expect(resolveClawdState({ activeSessionCount: 1 })).toBe("working-typing");
    expect(resolveClawdState({ activeSessionCount: 2 })).toBe("working-juggling");
    expect(resolveClawdState({ activeSessionCount: 4 })).toBe("working-overheated");
  });

  it("prioritizes status, sync, operation, and confidence states before idle fallback", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-27T12:00:00Z"));

    expect(resolveClawdState({ hasError: true, activeSessionCount: 3 })).toBe("error");
    expect(resolveClawdState({ isDisconnected: true, activeSessionCount: 3 })).toBe("disconnected");
    expect(resolveClawdState({ syncSucceededAt: "2026-05-27T11:59:58Z" })).toBe("mini-happy");
    expect(resolveClawdState({ hasLowConfidence: true })).toBe("working-confused");
    expect(resolveClawdState({ activeOperation: "optimize scan" })).toBe("working-thinking");
    expect(resolveClawdState({ activeOperation: "plan forecast" })).toBe("working-wizard");
    vi.useRealTimers();
  });

  it("uses idle duration only when no stronger product state is present", () => {
    expect(resolveClawdState({ idleMinutes: 12 })).toBe("idle-doze");
    expect(resolveClawdState({ idleMinutes: 31 })).toBe("sleeping");
    expect(resolveClawdState({ idleMinutes: 31, activeSessionCount: 1 })).toBe("working-typing");
  });
});

describe("useClawdState", () => {
  it("returns the same deterministic state through the hook", () => {
    const { result, rerender } = renderHook((props) => useClawdState(props), {
      initialProps: { activeSessionCount: 0 },
    });

    expect(result.current).toBe("idle-living");
    rerender({ activeSessionCount: 3 });
    expect(result.current).toBe("working-juggling");
  });
});
