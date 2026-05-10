// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reduceLiveSessionEvent,
  useVibeDeckLiveSessions,
} from "./use-vibedeck-live-sessions";

class MockEventSource {
  static instances: MockEventSource[] = [];

  args: any[];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  close = vi.fn();

  constructor(...args: any[]) {
    this.args = args;
    MockEventSource.instances.push(this);
  }

  emitOpen() {
    this.onopen?.(new Event("open"));
  }

  emitMessage(data: string) {
    this.onmessage?.({ data } as MessageEvent);
  }

  emitError() {
    this.onerror?.(new Event("error"));
  }
}

describe("reduceLiveSessionEvent", () => {
  it("loads sessions from a snapshot event", () => {
    const state = reduceLiveSessionEvent(
      [{ provider: "codex", session_id: "stale" }],
      {
        type: "snapshot",
        sessions: [{ provider: "codex", session_id: "s1", total_tokens: 10 }],
      },
    );
    expect(state).toEqual([{ provider: "codex", session_id: "s1", total_tokens: 10, state: "live" }]);
  });

  it("creates or upserts a session for session:start", () => {
    const state = reduceLiveSessionEvent([], {
      type: "session:start",
      provider: "codex",
      session_id: "s1",
      total_tokens: 1,
    });
    expect(state).toHaveLength(1);
    expect(state[0]).toMatchObject({ provider: "codex", session_id: "s1", total_tokens: 1, state: "live" });
  });

  it("updates an existing row for session:update", () => {
    const state = reduceLiveSessionEvent(
      [{ provider: "codex", session_id: "s1", total_tokens: 1, model: "gpt-5" }],
      {
        type: "session:update",
        provider: "codex",
        session_id: "s1",
        total_tokens: 2,
      },
    );
    expect(state[0]).toMatchObject({ provider: "codex", session_id: "s1", total_tokens: 2, model: "gpt-5" });
  });

  it("keeps ended rows and marks ended state or preserves ended_at", () => {
    const state = reduceLiveSessionEvent(
      [{ provider: "codex", session_id: "s1", total_tokens: 2 }],
      {
        type: "session:end",
        provider: "codex",
        session_id: "s1",
        ended_at: "2026-05-10T10:00:00.000Z",
      },
    );
    expect(state).toHaveLength(1);
    expect(state[0].ended_at || state[0].state === "ended").toBeTruthy();
  });
});

describe("useVibeDeckLiveSessions", () => {
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    // @ts-expect-error test stub
    globalThis.EventSource = MockEventSource;
  });

  afterEach(() => {
    globalThis.EventSource = originalEventSource;
    vi.restoreAllMocks();
  });

  it("starts idle when disabled", () => {
    const { result } = renderHook(() => useVibeDeckLiveSessions({ enabled: false }));
    expect(result.current.status).toBe("idle");
    expect(result.current.sessions).toEqual([]);
    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("connects to the live endpoint and transitions connecting -> connected", () => {
    const { result } = renderHook(() => useVibeDeckLiveSessions());
    expect(result.current.status).toBe("connecting");
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].args[0]).toBe("/functions/vibedeck-sessions-live");
    expect(MockEventSource.instances[0].args).toHaveLength(1);

    act(() => {
      MockEventSource.instances[0].emitOpen();
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.error).toBeNull();
  });

  it("parses message payloads and reduces session state", () => {
    const { result } = renderHook(() => useVibeDeckLiveSessions());
    const source = MockEventSource.instances[0];

    act(() => {
      source.emitMessage(JSON.stringify({
        type: "snapshot",
        sessions: [{ provider: "codex", session_id: "s1", total_tokens: 1 }],
      }));
    });
    expect(result.current.sessions[0]).toMatchObject({ provider: "codex", session_id: "s1", total_tokens: 1 });

    act(() => {
      source.emitMessage(JSON.stringify({
        type: "session:update",
        provider: "codex",
        session_id: "s1",
        total_tokens: 2,
      }));
    });
    expect(result.current.sessions[0].total_tokens).toBe(2);
  });

  it("marks degraded state for invalid JSON", () => {
    const { result } = renderHook(() => useVibeDeckLiveSessions());
    const source = MockEventSource.instances[0];

    act(() => {
      source.emitMessage("{bad json");
    });

    expect(result.current.status).toBe("degraded");
    expect(result.current.error).toBeTruthy();
  });

  it("marks degraded state on stream errors", () => {
    const { result } = renderHook(() => useVibeDeckLiveSessions());
    const source = MockEventSource.instances[0];

    act(() => {
      source.emitError();
    });

    expect(result.current.status).toBe("degraded");
    expect(result.current.error).toBeTruthy();
  });

  it("closes EventSource on cleanup", () => {
    const { unmount } = renderHook(() => useVibeDeckLiveSessions());
    const source = MockEventSource.instances[0];
    unmount();
    expect(source.close).toHaveBeenCalledTimes(1);
  });
});
