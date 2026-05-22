/* @vitest-environment jsdom */

import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { LiveSessionList } from "./LiveSessionList";

describe("LiveSessionList", () => {
  it("prefers backend workstream audit totals over locally rebuilt active rows", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:active"
        onSelectSession={() => {}}
        sessions={[
          {
            provider: "codex",
            session_id: "active",
            repo_root: "/repo/VibeDeck",
            branch: "main",
            total_tokens: 100,
            total_cost_usd: 0.5,
          },
        ]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["main", "feature/past"],
            primary_session: { provider: "codex", session_id: "active", model: "gpt-5.5" },
            sessions: [{ provider: "codex", session_id: "active", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 100,
            active_total_cost_usd: 0.5,
            audit_total_tokens: 1100,
            audit_total_cost_usd: 5.5,
            audit_cost_unknown_count: 0,
            branch_groups: [],
          },
        ]}
      />,
    );

    expect(screen.getByText("1,100")).toBeTruthy();
    expect(screen.getByText("$5.50")).toBeTruthy();
    expect(screen.getByText(/feature\/past, main|main, feature\/past/)).toBeTruthy();
  });

  it("renders repo workstream cards with branch-separated active and recently ended session breakdown", () => {
    const onSelectSession = vi.fn();
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:main-live"
        onSelectSession={onSelectSession}
        sessions={[
          {
            provider: "codex",
            session_id: "main-live",
            repo_root: "/repo/VibeDeck",
            branch: "publish-main",
            confidence: "high",
            branch_resolution_tier: "A",
            model: "gpt-5.5",
            total_tokens: 1000,
            total_cost_usd: 0.5,
            started_at: "2026-05-11T01:00:00.000Z",
            updated_at: "2026-05-11T01:20:00.000Z",
          },
          {
            provider: "codex",
            session_id: "related-ended",
            repo_root: "/repo/VibeDeck",
            branch: "dashboard",
            confidence: "medium",
            branch_resolution_tier: "B",
            model: "gpt-5.3-codex-spark",
            total_tokens: 500,
            total_cost_usd: 0.2,
            started_at: "2026-05-11T01:05:00.000Z",
            updated_at: "2026-05-11T01:10:00.000Z",
            ended_at: "2026-05-11T01:10:00.000Z",
            state: "ended",
          },
        ]}
      />,
    );

    expect(screen.getByText("Active workstreams")).toBeTruthy();
    expect(screen.getByText("1 workstream")).toBeTruthy();
    expect(screen.getByText("VibeDeck")).toBeTruthy();
    expect(screen.getByText(/dashboard, publish-main|publish-main, dashboard/)).toBeTruthy();
    expect(screen.queryByText("Primary session")).toBeNull();
    expect(screen.getByText("Related sessions")).toBeTruthy();
    expect(screen.getByText("Live now")).toBeTruthy();
    expect(screen.getByText("1 stale")).toBeTruthy();
    expect(screen.getByText("1,500")).toBeTruthy();
    expect(screen.getByText("$0.70")).toBeTruthy();

    const workstreamCard = screen.getByRole("button", { name: /select VibeDeck workstream/i });
    expect(workstreamCard.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(workstreamCard);
    expect(onSelectSession).toHaveBeenCalledWith("codex:main-live");

    const breakdownButton = screen.getByRole("button", { name: /view breakdown for VibeDeck/i });
    fireEvent.click(breakdownButton);

    expect(screen.getByRole("dialog", { name: /workstream breakdown/i })).toBeTruthy();
    expect(screen.getByText("Primary session")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByText("gpt-5.3-codex-spark")).toBeTruthy();

    const relatedRow = screen.getByText("gpt-5.3-codex-spark").closest("button");
    expect(relatedRow).toBeTruthy();
    fireEvent.click(relatedRow);
    expect(onSelectSession).toHaveBeenCalledWith("codex:related-ended");
  });

  it("restores provider and model breakdown visibility in the workstream drawer", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:main-live"
        onSelectSession={() => {}}
        sessions={[]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["main"],
            primary_session: { provider: "codex", session_id: "main-live", model: "gpt-5.5" },
            sessions: [{ provider: "codex", session_id: "main-live", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 100,
            active_total_cost_usd: 0.5,
            audit_total_tokens: 1100,
            audit_total_cost_usd: 5.5,
            audit_cost_unknown_count: 0,
            providers: [
              {
                provider: "codex",
                session_count: 2,
                audit_total_tokens: 1000,
                active_total_tokens: 100,
                audit_total_cost_usd: 5,
                active_total_cost_usd: 0.5,
              },
            ],
            models: [
              {
                model: "gpt-5.5",
                session_count: 2,
                audit_total_tokens: 1000,
                active_total_tokens: 100,
                audit_total_cost_usd: 5,
                active_total_cost_usd: 0.5,
              },
              {
                model: "claude-opus-4-7",
                session_count: 1,
                audit_total_tokens: 500,
                active_total_tokens: 0,
                audit_total_cost_usd: 2.5,
                active_total_cost_usd: 0,
              },
            ],
            branch_groups: [],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view breakdown for VibeDeck/i }));

    expect(screen.getByText("Model breakdown")).toBeTruthy();
    expect(screen.getByText("Provider breakdown")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByText("claude-opus-4-7")).toBeTruthy();
    expect(screen.getByLabelText("Model provider codex")).toBeTruthy();
    expect(screen.getByLabelText("Model provider claude")).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
    expect(screen.getAllByText("1,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$5.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("2 sessions").length).toBeGreaterThan(0);
  });

  it("shows enriched usage in workstream breakdown rows, branch groups, and sessions", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:fact-backed"
        onSelectSession={() => {}}
        sessions={[]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["feature/fact"],
            primary_session: { provider: "codex", session_id: "fact-backed", model: "gpt-5.5" },
            sessions: [{ provider: "codex", session_id: "fact-backed", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 300,
            active_total_cost_usd: 0.3,
            audit_total_tokens: 300,
            audit_total_cost_usd: 0.3,
            audit_cost_unknown_count: 0,
            providers: [
              {
                provider: "codex",
                session_count: 1,
                audit_total_tokens: 300,
                active_total_tokens: 300,
                audit_total_cost_usd: 0.3,
                active_total_cost_usd: 0.3,
                cache_creation_5m_input_tokens: 10,
                cache_creation_1h_input_tokens: 20,
                web_search_requests: 3,
                tool_call_count: 5,
                tools_json: '{"Read":1,"WebSearch":3,"Write":1}',
                activity_json: '{"review":1,"edit":2}',
              },
            ],
            models: [
              {
                model: "gpt-5.5",
                provider: "codex",
                session_count: 1,
                audit_total_tokens: 300,
                active_total_tokens: 300,
                audit_total_cost_usd: 0.3,
                active_total_cost_usd: 0.3,
                cache_creation_5m_input_tokens: 10,
                cache_creation_1h_input_tokens: 20,
                web_search_requests: 3,
                tool_call_count: 5,
                tools_json: '{"Read":1,"WebSearch":3,"Write":1}',
                activity_json: '{"review":1,"edit":2}',
              },
            ],
            branch_groups: [
              {
                branch: "feature/fact",
                active_session_count: 1,
                recently_completed_count: 0,
                audit_total_tokens: 75,
                audit_total_cost_usd: 0.25,
                cache_creation_5m_input_tokens: 10,
                cache_creation_1h_input_tokens: 20,
                web_search_requests: 7,
                tool_call_count: 11,
                tools_json: '{"FactTool":3}',
                activity_json: '{"fact":4}',
                sessions: [
                  {
                    provider: "codex",
                    session_id: "fact-backed",
                    branch: "feature/fact",
                    confidence: "medium",
                    branch_resolution_tier: "B",
                    model: "gpt-5.5",
                    total_tokens: 75,
                    estimated_total_cost_usd: 0.25,
                    updated_at: "2026-05-12T01:15:00.000Z",
                    cache_creation_5m_input_tokens: 10,
                    cache_creation_1h_input_tokens: 20,
                    web_search_requests: 7,
                    tool_call_count: 11,
                    tools_json: '{"FactTool":3}',
                    activity_json: '{"fact":4}',
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view breakdown for VibeDeck/i }));

    expect(screen.getAllByText("5m cache").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1h cache").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Web searches").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Tool calls").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Top tools").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Activity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("WebSearch 3 · Read 1 · Write 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("edit 2 · review 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("FactTool 3").length).toBeGreaterThan(0);
    expect(screen.getAllByText("fact 4").length).toBeGreaterThan(0);
  });

  it("does not show live enrichment noise for bad JSON and zero-only fields", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:zero-only"
        onSelectSession={() => {}}
        sessions={[]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["main"],
            primary_session: { provider: "codex", session_id: "zero-only", model: "gpt-5.5" },
            sessions: [{ provider: "codex", session_id: "zero-only", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 100,
            active_total_cost_usd: 0.1,
            audit_total_tokens: 100,
            audit_total_cost_usd: 0.1,
            audit_cost_unknown_count: 0,
            providers: [
              {
                provider: "codex",
                session_count: 1,
                audit_total_tokens: 100,
                active_total_tokens: 100,
                audit_total_cost_usd: 0.1,
                active_total_cost_usd: 0.1,
                cache_creation_5m_input_tokens: 0,
                cache_creation_1h_input_tokens: 0,
                web_search_requests: 0,
                tool_call_count: 0,
                tools_json: "{bad",
                activity_json: '{"edit":0}',
              },
            ],
            models: [],
            branch_groups: [
              {
                branch: "main",
                active_session_count: 1,
                recently_completed_count: 0,
                audit_total_tokens: 100,
                audit_total_cost_usd: 0.1,
                cache_creation_5m_input_tokens: 0,
                cache_creation_1h_input_tokens: 0,
                web_search_requests: 0,
                tool_call_count: 0,
                tools_json: "{bad",
                activity_json: null,
                sessions: [
                  {
                    provider: "codex",
                    session_id: "zero-only",
                    branch: "main",
                    confidence: "high",
                    branch_resolution_tier: "A",
                    model: "gpt-5.5",
                    total_tokens: 100,
                    total_cost_usd: 0.1,
                    updated_at: "2026-05-12T01:15:00.000Z",
                    cache_creation_5m_input_tokens: 0,
                    cache_creation_1h_input_tokens: 0,
                    web_search_requests: 0,
                    tool_call_count: 0,
                    tools_json: "{bad",
                    activity_json: null,
                  },
                ],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view breakdown for VibeDeck/i }));

    expect(screen.queryByText("5m cache")).toBeNull();
    expect(screen.queryByText("1h cache")).toBeNull();
    expect(screen.queryByText("Web searches")).toBeNull();
    expect(screen.queryByText("Tool calls")).toBeNull();
    expect(screen.queryByText("Top tools")).toBeNull();
    expect(screen.queryByText("Activity")).toBeNull();
  });

  it("shows cwd_only workstreams as no-git scope with branch unavailable", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:nogit"
        onSelectSession={() => {}}
        sessions={[
          {
            provider: "codex",
            session_id: "nogit",
            cwd: "/Users/dev/no-git-project",
            repo_root: null,
            branch: "unattributed",
            confidence: "unattributed",
            branch_resolution_tier: "D",
            model: "gpt-5.5",
            total_tokens: 123,
          },
        ]}
        workstreams={[
          {
            id: "cwd:no-git",
            audit_scope: "cwd_only",
            cwd: "/Users/dev/no-git-project",
            repo_root: null,
            branches: ["unattributed"],
            confidence: "unattributed",
            primary_session: {
              provider: "codex",
              session_id: "nogit",
              model: "gpt-5.5",
              confidence: "unattributed",
            },
            sessions: [{ provider: "codex", session_id: "nogit", model: "gpt-5.5" }],
            active_session_count: 1,
            recently_completed_count: 0,
            active_total_tokens: 123,
            active_total_cost_usd: 0.12,
            audit_total_tokens: 123,
            audit_total_cost_usd: 0.12,
            audit_cost_unknown_count: 0,
            branch_groups: [],
          },
        ]}
      />,
    );

    expect(screen.getByText(/No Git repo/)).toBeTruthy();
    expect(screen.getByText("Branch unavailable")).toBeTruthy();
  });

  it("shows current active session above stale history in drawer even with unsorted backend payload", () => {
    render(
      <LiveSessionList
        streamStatus="connected"
        selectedKey="codex:active-main"
        onSelectSession={() => {}}
        sessions={[
          {
            provider: "codex",
            session_id: "active-main",
            repo_root: "/repo/VibeDeck",
            branch: "main",
            confidence: "high",
            branch_resolution_tier: "A",
            model: "active-model",
            total_tokens: 300,
            total_cost_usd: 0.3,
            updated_at: "2026-05-12T01:15:00.000Z",
          },
        ]}
        workstreams={[
          {
            id: "project:vibedeck",
            repo_root: "/repo/VibeDeck",
            branches: ["main", "feature/old"],
            primary_session: { provider: "codex", session_id: "active-main", model: "active-model" },
            sessions: [{ provider: "codex", session_id: "active-main", model: "active-model" }],
            active_session_count: 1,
            recently_completed_count: 1,
            active_total_tokens: 300,
            active_total_cost_usd: 0.3,
            audit_total_tokens: 800,
            audit_total_cost_usd: 0.8,
            audit_cost_unknown_count: 0,
            branch_groups: [
              {
                branch: "feature/old",
                active_session_count: 0,
                recently_completed_count: 1,
                audit_total_tokens: 500,
                audit_total_cost_usd: 0.5,
                sessions: [{
                  provider: "codex",
                  session_id: "ended-feature",
                  branch: "feature/old",
                  confidence: "medium",
                  branch_resolution_tier: "B",
                  model: "stale-model",
                  total_tokens: 500,
                  total_cost_usd: 0.5,
                  ended_at: "2026-05-12T01:20:00.000Z",
                  updated_at: "2026-05-12T01:20:00.000Z",
                }],
              },
              {
                branch: "main",
                active_session_count: 1,
                recently_completed_count: 0,
                audit_total_tokens: 300,
                audit_total_cost_usd: 0.3,
                sessions: [{
                  provider: "codex",
                  session_id: "active-main",
                  branch: "main",
                  confidence: "high",
                  branch_resolution_tier: "A",
                  model: "active-model",
                  total_tokens: 300,
                  total_cost_usd: 0.3,
                  updated_at: "2026-05-12T01:15:00.000Z",
                }],
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /view breakdown for VibeDeck/i }));
    const activeModel = screen.getByText("active-model");
    const staleModel = screen.getByText("stale-model");
    const pos = activeModel.compareDocumentPosition(staleModel);
    expect(Boolean(pos & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryAllByText("Branches").length).toBe(1);
  });
});
