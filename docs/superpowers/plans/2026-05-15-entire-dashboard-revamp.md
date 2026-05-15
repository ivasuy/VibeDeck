# Entire Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the `/entire` dashboard page around a command-center header and checkpoint timeline cards that show accumulated metadata, model/token/cost breakdowns, collapsed prompts, and summarized captured activity.

**Architecture:** Keep the change frontend-first and reuse the existing local API contracts. Add pure checkpoint card data helpers, then build card/timeline components, then compose the page into command-center and main timeline regions without changing backend command behavior.

**Tech Stack:** React 18, Vite, Vitest, Testing Library, Tailwind utility classes, lucide-react icons, existing VibeDeck local API helpers.

---

## File Structure

- Create `dashboard/src/components/entire/checkpoint-card-utils.js`: pure data-shaping helpers for checkpoint cards, display labels, usage/cost/model breakdowns, prompt/jsonl/hash path detection, and JSONL event summaries.
- Create `dashboard/src/components/entire/checkpoint-card-utils.test.js`: unit tests for the card helper contract.
- Create `dashboard/src/components/entire/CheckpointCard.jsx`: one checkpoint card with summary metrics, model/provider breakdowns, collapsed prompt, captured activity summary, and advanced details.
- Create `dashboard/src/components/entire/CheckpointCard.test.jsx`: component tests for collapsed prompt behavior, breakdown rendering, and advanced raw-data gating.
- Create `dashboard/src/components/entire/CheckpointTimeline.jsx`: list-level loading, empty, unavailable, error, and card rendering states.
- Create `dashboard/src/components/entire/CheckpointTimeline.test.jsx`: component tests for page-safe checkpoint timeline states.
- Create `dashboard/src/components/entire/EntireCommandCenter.jsx`: repo selector, recent repo list, status card, and selected-repo shell.
- Create `dashboard/src/components/entire/EntireControlPanel.jsx`: calmer grouped controls for agents/actions/configure/maintenance using existing control components.
- Modify `dashboard/src/pages/EntirePage.jsx`: replace cramped grid with command-center + timeline layout, wire new components, keep existing fetch functions and callbacks.
- Modify existing tests in `dashboard/src/pages/EntirePage.test.jsx` and `dashboard/src/pages/EntirePage.actions.test.jsx` only where assertions depend on old layout text/structure.

## Task 1: Checkpoint Card Data Helpers

**Files:**
- Create: `dashboard/src/components/entire/checkpoint-card-utils.js`
- Create: `dashboard/src/components/entire/checkpoint-card-utils.test.js`
- Read: `dashboard/src/components/entire/checkpoint-file-utils.js`

- [ ] **Step 1: Write failing helper tests**

Create `dashboard/src/components/entire/checkpoint-card-utils.test.js`:

```js
import { describe, expect, it } from "vitest";
import {
  buildCheckpointCards,
  summarizeJsonlPayload,
  usageCostLabel,
  usageStatusLabel,
} from "./checkpoint-card-utils";

describe("checkpoint-card-utils", () => {
  it("builds one card per checkpoint with accumulated usage and important file paths", () => {
    const cards = buildCheckpointCards({
      checkpoints: {
        available: true,
        files: [
          "06/e2abdc1ec6/metadata.json",
          "06/e2abdc1ec6/0/prompt.txt",
          "06/e2abdc1ec6/0/full.jsonl",
          "06/e2abdc1ec6/0/content_hash.txt",
        ],
        checkpoint_usage: {
          "06/e2abdc1ec6": {
            status: "metadata",
            confidence: "metadata",
            branch: "main",
            provider: "codex",
            model: "gpt-5.5",
            total_tokens: 12345,
            total_cost_usd: 0.42,
            cost_quality: "checkpoint_metadata",
            session_count: 2,
            models: [
              { model: "gpt-5.5", total_tokens: 9000, total_cost_usd: 0.3 },
              { model: "claude-sonnet-4-6", total_tokens: 3345, total_cost_usd: 0.12 },
            ],
            providers: [
              { provider: "codex", total_tokens: 9000, total_cost_usd: 0.3 },
              { provider: "claude", total_tokens: 3345, total_cost_usd: 0.12 },
            ],
          },
        },
      },
    });

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: "06/e2abdc1ec6",
      label: "06/e2abdc1ec6",
      metadataPath: "06/e2abdc1ec6/metadata.json",
      promptPath: "06/e2abdc1ec6/0/prompt.txt",
      jsonlPath: "06/e2abdc1ec6/0/full.jsonl",
      hashPath: "06/e2abdc1ec6/0/content_hash.txt",
      branch: "main",
      provider: "codex",
      topModel: "gpt-5.5",
      totalTokens: 12345,
      totalCostUsd: 0.42,
      costQuality: "checkpoint_metadata",
      sessionCount: 2,
    });
    expect(cards[0].modelRows).toEqual([
      { label: "gpt-5.5", tokens: 9000, costUsd: 0.3 },
      { label: "claude-sonnet-4-6", tokens: 3345, costUsd: 0.12 },
    ]);
    expect(cards[0].providerRows).toEqual([
      { label: "codex", tokens: 9000, costUsd: 0.3 },
      { label: "claude", tokens: 3345, costUsd: 0.12 },
    ]);
  });

  it("keeps unmatched and ambiguous usage from rendering as zero-dollar cost", () => {
    expect(usageStatusLabel({ status: "unmatched" })).toBe("Usage not linked");
    expect(usageStatusLabel({ status: "ambiguous" })).toBe("Ambiguous usage");
    expect(usageCostLabel({ total_cost_usd: null, cost_unknown_count: 0 })).toBe("");
    expect(usageCostLabel({ total_cost_usd: null, cost_unknown_count: 1 })).toBe("Unknown cost");
  });

  it("summarizes jsonl parsed payloads into event counts without exposing raw preview lines", () => {
    const summary = summarizeJsonlPayload({
      line_count: 6,
      parsed: {
        valid_lines: 5,
        invalid_lines: 1,
        preview: [
          { line: 1, value: { type: "user", sessionId: "s1" } },
          { line: 2, value: { type: "assistant", sessionId: "s1" } },
          { line: 3, value: { type: "assistant", sessionId: "s1" } },
          { line: 4, value: { type: "attachment", sessionId: "s1" } },
          { line: 5, value: { type: "queue-operation", sessionId: "s1" } },
          { line: 6, error: "Unexpected token", raw: "not-json" },
        ],
      },
    });

    expect(summary).toEqual({
      lineCount: 6,
      validLines: 5,
      invalidLines: 1,
      eventRows: [
        { label: "assistant", count: 2 },
        { label: "attachment", count: 1 },
        { label: "queue-operation", count: 1 },
        { label: "user", count: 1 },
      ],
    });
  });
});
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
npm --prefix dashboard run test -- checkpoint-card-utils.test.js
```

Expected: fails because `checkpoint-card-utils.js` does not exist.

- [ ] **Step 3: Implement helper module**

Create `dashboard/src/components/entire/checkpoint-card-utils.js`:

```js
import { formatUsdCurrency } from "../../lib/format";
import { checkpointFileLabel, groupCheckpointFiles } from "./checkpoint-file-utils";

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePath(value) {
  return cleanText(value).replace(/\\/g, "/").replace(/^\/+/, "");
}

function basename(filePath) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function isPromptPath(filePath) {
  return basename(filePath).toLowerCase() === "prompt.txt";
}

function isJsonlPath(filePath) {
  return basename(filePath).toLowerCase().endsWith(".jsonl");
}

function isHashPath(filePath) {
  return basename(filePath).toLowerCase() === "content_hash.txt";
}

function isMetadataPath(filePath) {
  return basename(filePath).toLowerCase() === "metadata.json";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function uniqueLabels(values) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const label = cleanText(value);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function usageStatusLabel(usage) {
  const status = cleanText(usage?.status).toLowerCase();
  if (status === "ambiguous") return "Ambiguous usage";
  if (status === "unmatched") return "Usage not linked";
  return "";
}

export function usageCostLabel(usage) {
  const totalCost = usage?.total_cost_usd;
  const unknownCount = Number(usage?.cost_unknown_count || 0);
  if (totalCost == null && unknownCount > 0) return "Unknown cost";
  if (totalCost == null) return "";
  return formatUsdCurrency(Number(totalCost).toFixed(2));
}

function breakdownRows(rows, labelKey) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: cleanText(row?.[labelKey]),
      tokens: numberOrNull(row?.total_tokens),
      costUsd: numberOrNull(row?.total_cost_usd),
    }))
    .filter((row) => row.label);
}

function metadataRows(usage) {
  return (Array.isArray(usage?.metadata_files) ? usage.metadata_files : [])
    .map((row) => ({
      path: normalizePath(row?.metadata_path),
      label: checkpointFileLabel(row?.metadata_path),
      model: cleanText(row?.model),
      provider: cleanText(row?.provider),
      tokens: numberOrNull(row?.total_tokens),
      costUsd: numberOrNull(row?.total_cost_usd),
      status: cleanText(row?.status),
    }))
    .filter((row) => row.path);
}

function topModel(usage) {
  const direct = cleanText(usage?.model);
  if (direct) return direct;
  const modelRows = breakdownRows(usage?.models, "model");
  return modelRows[0]?.label || "";
}

export function summarizeJsonlPayload(payload) {
  const parsed = payload?.parsed && typeof payload.parsed === "object" ? payload.parsed : {};
  const preview = Array.isArray(parsed.preview) ? parsed.preview : [];
  const counts = new Map();

  for (const row of preview) {
    const type = cleanText(row?.value?.type);
    if (!type) continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  return {
    lineCount: Number(payload?.line_count || 0),
    validLines: Number(parsed.valid_lines || 0),
    invalidLines: Number(parsed.invalid_lines || 0),
    eventRows: Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

export function buildCheckpointCards({ checkpoints }) {
  const files = Array.isArray(checkpoints?.files) ? checkpoints.files : [];
  const usageByGroup = checkpoints?.checkpoint_usage && typeof checkpoints.checkpoint_usage === "object"
    ? checkpoints.checkpoint_usage
    : {};

  return groupCheckpointFiles(files).map((group) => {
    const usage = usageByGroup[group.id] && typeof usageByGroup[group.id] === "object"
      ? usageByGroup[group.id]
      : null;
    const normalizedFiles = group.files.map(normalizePath);
    const modelRows = breakdownRows(usage?.models, "model");
    const providerRows = breakdownRows(usage?.providers, "provider");
    const models = uniqueLabels([
      usage?.model,
      ...modelRows.map((row) => row.label),
    ]);

    return {
      id: group.id,
      label: group.label,
      files: normalizedFiles,
      usage,
      metadataPath: normalizedFiles.find(isMetadataPath) || "",
      promptPath: normalizedFiles.find(isPromptPath) || "",
      jsonlPath: normalizedFiles.find(isJsonlPath) || "",
      hashPath: normalizedFiles.find(isHashPath) || "",
      branch: cleanText(usage?.branch),
      provider: cleanText(usage?.provider),
      topModel: topModel(usage),
      models,
      totalTokens: numberOrNull(usage?.total_tokens),
      totalCostUsd: numberOrNull(usage?.total_cost_usd),
      knownCostUsd: numberOrNull(usage?.known_cost_usd),
      costUnknownCount: Number(usage?.cost_unknown_count || 0),
      costQuality: cleanText(usage?.cost_quality),
      sessionCount: Number(usage?.session_count || 0),
      statusLabel: usageStatusLabel(usage),
      costLabel: usageCostLabel(usage),
      confidence: cleanText(usage?.confidence),
      reason: cleanText(usage?.reason),
      checkpointId: cleanText(usage?.checkpoint_id),
      metadataUsagePath: cleanText(usage?.metadata_path),
      modelRows,
      providerRows,
      metadataRows: metadataRows(usage),
    };
  });
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
npm --prefix dashboard run test -- checkpoint-card-utils.test.js
```

Expected: all tests in `checkpoint-card-utils.test.js` pass.

- [ ] **Step 5: Commit helper contract**

Run:

```bash
git add dashboard/src/components/entire/checkpoint-card-utils.js dashboard/src/components/entire/checkpoint-card-utils.test.js
git commit -m "feat: add entire checkpoint card helpers"
```

Expected: commit succeeds with only helper files staged.

## Task 2: Checkpoint Card Component

**Files:**
- Create: `dashboard/src/components/entire/CheckpointCard.jsx`
- Create: `dashboard/src/components/entire/CheckpointCard.test.jsx`
- Use: `dashboard/src/components/entire/checkpoint-card-utils.js`
- Use: `dashboard/src/lib/vibedeck-api.ts`

- [ ] **Step 1: Write failing card tests**

Create `dashboard/src/components/entire/CheckpointCard.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { CheckpointCard } from "./CheckpointCard";

afterEach(() => {
  cleanup();
});

const card = {
  id: "06/e2abdc1ec6",
  label: "06/e2abdc1ec6",
  metadataPath: "06/e2abdc1ec6/metadata.json",
  promptPath: "06/e2abdc1ec6/0/prompt.txt",
  jsonlPath: "06/e2abdc1ec6/0/full.jsonl",
  hashPath: "06/e2abdc1ec6/0/content_hash.txt",
  branch: "main",
  provider: "codex",
  topModel: "gpt-5.5",
  models: ["gpt-5.5", "claude-sonnet-4-6"],
  totalTokens: 12345,
  totalCostUsd: 0.42,
  costQuality: "checkpoint_metadata",
  sessionCount: 2,
  statusLabel: "",
  costLabel: "$0.42",
  modelRows: [
    { label: "gpt-5.5", tokens: 9000, costUsd: 0.3 },
    { label: "claude-sonnet-4-6", tokens: 3345, costUsd: 0.12 },
  ],
  providerRows: [{ label: "codex", tokens: 12345, costUsd: 0.42 }],
  metadataRows: [],
  files: [
    "06/e2abdc1ec6/metadata.json",
    "06/e2abdc1ec6/0/prompt.txt",
    "06/e2abdc1ec6/0/full.jsonl",
  ],
};

describe("CheckpointCard", () => {
  it("renders accumulated checkpoint metrics and model breakdowns", () => {
    render(<CheckpointCard repo="/tmp/repo" card={card} getCheckpointImpl={vi.fn()} />);

    expect(screen.getByText("06/e2abdc1ec6")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
    expect(screen.getByText("codex")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByText("$0.42")).toBeTruthy();
    expect(screen.getByText("12,345 tokens")).toBeTruthy();
    expect(screen.getByText("checkpoint_metadata")).toBeTruthy();

    const models = screen.getByRole("region", { name: "Model breakdown for 06/e2abdc1ec6" });
    expect(within(models).getByText("claude-sonnet-4-6")).toBeTruthy();
    expect(within(models).getByText("3,345")).toBeTruthy();
    expect(within(models).getByText("$0.12")).toBeTruthy();
  });

  it("keeps prompt collapsed until opened", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      kind: "text",
      raw: "Sensitive prompt body",
      line_count: 1,
      size_bytes: 21,
    });

    render(<CheckpointCard repo="/tmp/repo" card={card} getCheckpointImpl={getCheckpointImpl} />);

    expect(screen.queryByText("Sensitive prompt body")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show prompt for 06/e2abdc1ec6" }));

    await waitFor(() => expect(getCheckpointImpl).toHaveBeenCalledWith("/tmp/repo", card.promptPath));
    expect(screen.getByText("Sensitive prompt body")).toBeTruthy();
  });

  it("shows jsonl activity counts instead of raw preview lines", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      kind: "jsonl",
      line_count: 3,
      parsed: {
        valid_lines: 3,
        invalid_lines: 0,
        preview: [
          { line: 1, value: { type: "user", text: "raw user text" } },
          { line: 2, value: { type: "assistant", text: "raw assistant text" } },
          { line: 3, value: { type: "assistant", text: "raw assistant text 2" } },
        ],
      },
    });

    render(<CheckpointCard repo="/tmp/repo" card={card} getCheckpointImpl={getCheckpointImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Show captured activity for 06/e2abdc1ec6" }));

    await screen.findByText("assistant");
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("user")).toBeTruthy();
    expect(screen.queryByText("raw user text")).toBeNull();
  });

  it("keeps advanced raw details collapsed by default", async () => {
    const getCheckpointImpl = vi.fn().mockResolvedValue({
      kind: "json",
      raw: "{\"branch\":\"main\"}",
      parsed: { branch: "main" },
      parse_error: null,
    });

    render(<CheckpointCard repo="/tmp/repo" card={card} getCheckpointImpl={getCheckpointImpl} />);

    expect(screen.queryByText("{\"branch\":\"main\"}")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show advanced details for 06/e2abdc1ec6" }));

    await waitFor(() => expect(getCheckpointImpl).toHaveBeenCalledWith("/tmp/repo", card.metadataPath));
    expect(screen.getByText("{\"branch\":\"main\"}")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run card tests and verify they fail**

Run:

```bash
npm --prefix dashboard run test -- CheckpointCard.test.jsx
```

Expected: fails because `CheckpointCard.jsx` does not exist.

- [ ] **Step 3: Implement `CheckpointCard.jsx`**

Create `dashboard/src/components/entire/CheckpointCard.jsx` with these exported props:

```jsx
export function CheckpointCard({
  repo = "",
  card,
  getCheckpointImpl = getCheckpoint,
}) {
  // renders one checkpoint card
}
```

Required implementation details:

- Import `React`, `useState`, `ChevronDown`, `Database`, `FileText`, `ListTree`, `ShieldAlert`, `Sparkles`, `formatUsdCurrency`, `cn`, `getCheckpoint`, and `summarizeJsonlPayload`.
- Render a `<section>` with accessible label `Checkpoint ${card.label}`.
- Render summary chips for `card.branch`, `card.provider`, `card.topModel`, `card.costQuality`, `card.sessionCount`.
- Render metric blocks for `card.costLabel || "No cost"`, `card.totalTokens?.toLocaleString() + " tokens"`, and `card.statusLabel || "Usage linked"`.
- Render `modelRows` inside `role="region"` with `aria-label={`Model breakdown for ${card.id}`}`.
- Render `providerRows` only when there is more than one provider row or no model rows.
- Add section buttons with these exact accessible names:
  - `Show prompt for ${card.id}`
  - `Show captured activity for ${card.id}`
  - `Show advanced details for ${card.id}`
- Prompt expansion fetches `card.promptPath` and renders `payload.raw`.
- Captured activity expansion fetches `card.jsonlPath`, calls `summarizeJsonlPayload(payload)`, renders line counts and event rows only.
- Advanced expansion fetches `card.metadataPath` first when present, then renders raw metadata and file list. Do not fetch all files in this task.
- Store loading/error state per section so a failed prompt fetch does not break the card.
- Use current VibeDeck card classes: `vd-card`, `vd-subcard`, `border-[var(--glass-border)]`, `bg-[var(--glass-bg)]`.

- [ ] **Step 4: Run card tests and verify they pass**

Run:

```bash
npm --prefix dashboard run test -- CheckpointCard.test.jsx
```

Expected: all `CheckpointCard` tests pass.

- [ ] **Step 5: Commit card component**

Run:

```bash
git add dashboard/src/components/entire/CheckpointCard.jsx dashboard/src/components/entire/CheckpointCard.test.jsx
git commit -m "feat: add entire checkpoint card"
```

Expected: commit succeeds with card component files staged.

## Task 3: Checkpoint Timeline

**Files:**
- Create: `dashboard/src/components/entire/CheckpointTimeline.jsx`
- Create: `dashboard/src/components/entire/CheckpointTimeline.test.jsx`
- Use: `dashboard/src/components/entire/CheckpointCard.jsx`
- Use: `dashboard/src/components/entire/checkpoint-card-utils.js`

- [ ] **Step 1: Write failing timeline tests**

Create `dashboard/src/components/entire/CheckpointTimeline.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { CheckpointTimeline } from "./CheckpointTimeline";

afterEach(() => {
  cleanup();
});

describe("CheckpointTimeline", () => {
  it("shows a calm empty state before a repo is selected", () => {
    render(<CheckpointTimeline repo="" checkpoints={null} />);
    expect(screen.getByText("Load a repo to view checkpoint usage.")).toBeTruthy();
  });

  it("shows branch-not-fetched state without file-browser language", () => {
    render(
      <CheckpointTimeline
        repo="/tmp/repo"
        checkpoints={{ available: false, reason: "branch_not_fetched" }}
      />,
    );
    expect(screen.getByText(/checkpoint branch/i)).toBeTruthy();
    expect(screen.queryByText("Checkpoint files")).toBeNull();
  });

  it("renders one card per checkpoint", () => {
    render(
      <CheckpointTimeline
        repo="/tmp/repo"
        getCheckpointImpl={vi.fn()}
        checkpoints={{
          available: true,
          files: [
            "06/e2abdc1ec6/metadata.json",
            "06/e2abdc1ec6/0/prompt.txt",
            "23/183a892518/metadata.json",
          ],
          checkpoint_usage: {
            "06/e2abdc1ec6": { status: "metadata", model: "gpt-5.5", total_tokens: 10 },
            "23/183a892518": { status: "unmatched", reason: "no_matching_session" },
          },
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "Checkpoint timeline" })).toBeTruthy();
    expect(screen.getByLabelText("Checkpoint 06/e2abdc1ec6")).toBeTruthy();
    expect(screen.getByLabelText("Checkpoint 23/183a892518")).toBeTruthy();
    expect(screen.queryByText("metadata.json")).toBeNull();
  });
});
```

- [ ] **Step 2: Run timeline tests and verify they fail**

Run:

```bash
npm --prefix dashboard run test -- CheckpointTimeline.test.jsx
```

Expected: fails because `CheckpointTimeline.jsx` does not exist.

- [ ] **Step 3: Implement `CheckpointTimeline.jsx`**

Create `dashboard/src/components/entire/CheckpointTimeline.jsx`:

```jsx
import React from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { CheckpointCard } from "./CheckpointCard";
import { buildCheckpointCards } from "./checkpoint-card-utils";

function unavailableReasonText(checkpoints) {
  const reason = String(checkpoints?.reason || "").trim();
  if (reason === "branch_not_fetched") return copy("entire.checkpoints.reason.branch_not_fetched");
  if (reason === "git_error") {
    const detail = String(checkpoints?.detail || "").trim();
    return detail
      ? copy("entire.checkpoints.reason.git_error_detail", { detail })
      : copy("entire.checkpoints.reason.git_error");
  }
  return copy("entire.checkpoints.none");
}

export function CheckpointTimeline({
  repo = "",
  checkpoints = null,
  loading = false,
  error = "",
  className = "",
  getCheckpointImpl,
}) {
  const cards = buildCheckpointCards({ checkpoints });

  return (
    <section className={cn("vd-card min-h-[420px] rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-glass", className)}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-oai-black dark:text-white">Checkpoint timeline</h2>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Accumulated metadata, usage, cost, prompts, and captured activity per checkpoint.
          </p>
        </div>
        {cards.length > 0 ? (
          <span className="rounded-md bg-oai-black/[0.06] px-2 py-1 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            {cards.length} checkpoints
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.loading")}</p>
      ) : error ? (
        <p className="text-sm text-red-700 dark:text-red-300">{copy("entire.checkpoints.error", { error })}</p>
      ) : !repo ? (
        <p className="rounded-xl border border-dashed border-oai-gray-300 p-5 text-sm text-oai-gray-500 dark:border-oai-gray-700 dark:text-oai-gray-400">
          Load a repo to view checkpoint usage.
        </p>
      ) : !checkpoints?.available || cards.length === 0 ? (
        <p className="rounded-xl border border-dashed border-oai-gray-300 p-5 text-sm text-oai-gray-500 dark:border-oai-gray-700 dark:text-oai-gray-400">
          {unavailableReasonText(checkpoints)}
        </p>
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <CheckpointCard
              key={card.id}
              repo={repo}
              card={card}
              getCheckpointImpl={getCheckpointImpl}
            />
          ))}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run timeline tests and verify they pass**

Run:

```bash
npm --prefix dashboard run test -- CheckpointTimeline.test.jsx CheckpointCard.test.jsx checkpoint-card-utils.test.js
```

Expected: all checkpoint card/timeline tests pass.

- [ ] **Step 5: Commit timeline**

Run:

```bash
git add dashboard/src/components/entire/CheckpointTimeline.jsx dashboard/src/components/entire/CheckpointTimeline.test.jsx
git commit -m "feat: add entire checkpoint timeline"
```

Expected: commit succeeds with timeline files staged.

## Task 4: Command Center and Control Panel

**Files:**
- Create: `dashboard/src/components/entire/EntireCommandCenter.jsx`
- Create: `dashboard/src/components/entire/EntireControlPanel.jsx`
- Test: `dashboard/src/components/entire/EntireCommandCenter.test.jsx`
- Test: `dashboard/src/components/entire/EntireControlPanel.test.jsx`
- Use: `RepoPathSelector.jsx`, `RecentReposPane.jsx`, `EntireStatusCard.jsx`, `EntireActionsPanel.jsx`, `AdvancedConfigurePanel.jsx`, `EntireMaintenancePanel.jsx`

- [ ] **Step 1: Write command-center tests**

Create `dashboard/src/components/entire/EntireCommandCenter.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "../../test/test-utils";
import { EntireCommandCenter } from "./EntireCommandCenter";

afterEach(() => {
  cleanup();
});

describe("EntireCommandCenter", () => {
  it("groups repo loading, recent repos, and status in one command area", () => {
    const onSubmit = vi.fn();
    const onRemoveRepo = vi.fn();

    render(
      <EntireCommandCenter
        repoInput="/tmp/repo"
        onRepoInputChange={vi.fn()}
        onRepoSubmit={onSubmit}
        repoSuggestions={["/tmp/repo", "/tmp/other"]}
        selectedRepo="/tmp/repo"
        onRecentRepoSelect={onSubmit}
        onRecentRepoRemove={onRemoveRepo}
        status={{ state: "active", version: "1.2.3" }}
      />,
    );

    expect(screen.getByText("Repo command center")).toBeTruthy();
    expect(screen.getByText("repo")).toBeTruthy();
    expect(screen.getByText("other")).toBeTruthy();
    expect(screen.getByText("Active")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove recent repo other"));
    expect(onRemoveRepo).toHaveBeenCalledWith("/tmp/other");
  });
});
```

- [ ] **Step 2: Write control-panel tests**

Create `dashboard/src/components/entire/EntireControlPanel.test.jsx`:

```jsx
/* @vitest-environment jsdom */

import React from "react";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../../test/test-utils";
import { EntireControlPanel } from "./EntireControlPanel";

afterEach(() => {
  cleanup();
});

describe("EntireControlPanel", () => {
  it("shows a quiet empty state when no repo is selected", () => {
    render(<EntireControlPanel repo="" />);
    expect(screen.getByText("Select a repo to manage Entire controls.")).toBeTruthy();
  });

  it("groups normal actions, configure, and maintenance separately", () => {
    render(<EntireControlPanel repo="/tmp/repo" />);
    expect(screen.getByRole("heading", { name: "Agents and status" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Configure" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Maintenance" })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run command/control tests and verify they fail**

Run:

```bash
npm --prefix dashboard run test -- EntireCommandCenter.test.jsx EntireControlPanel.test.jsx
```

Expected: fails because the new components do not exist.

- [ ] **Step 4: Implement `EntireCommandCenter.jsx`**

Create `dashboard/src/components/entire/EntireCommandCenter.jsx`:

```jsx
import React from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { RepoPathSelector } from "./RepoPathSelector";
import { RecentReposPane } from "./RecentReposPane";
import { EntireStatusCard } from "./EntireStatusCard";

export function EntireCommandCenter({
  repoInput = "",
  onRepoInputChange,
  onRepoSubmit,
  repoSuggestions = [],
  selectedRepo = "",
  onRecentRepoSelect,
  onRecentRepoRemove,
  repoLoading = false,
  repoError = "",
  status = null,
  statusLoading = false,
  statusError = "",
  className = "",
}) {
  return (
    <section className={cn("vd-card rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-glass", className)}>
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-oai-black dark:text-white">Repo command center</h1>
        <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          Load a project, check Entire status, and pick recent repos before reviewing checkpoints.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_280px_320px]">
        <div className="min-w-0">
          <RepoPathSelector
            value={repoInput}
            onChange={onRepoInputChange}
            onSubmit={onRepoSubmit}
            suggestions={repoSuggestions}
            loading={repoLoading}
            error={repoError}
            description={copy("entire.repo.subtitle")}
          />
        </div>
        <RecentReposPane
          className="h-[220px] min-h-0"
          repos={repoSuggestions}
          selectedRepo={selectedRepo}
          onSelect={onRecentRepoSelect}
          onRemove={onRecentRepoRemove}
        />
        <div className="rounded-xl border border-[var(--vd-border)] p-4">
          <EntireStatusCard status={status} loading={statusLoading} error={statusError} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Implement `EntireControlPanel.jsx`**

Create `dashboard/src/components/entire/EntireControlPanel.jsx`:

```jsx
import React from "react";
import { cn } from "../../lib/cn";
import { EntireActionsPanel } from "./EntireActionsPanel";
import { AdvancedConfigurePanel } from "./AdvancedConfigurePanel";
import { EntireMaintenancePanel } from "./EntireMaintenancePanel";

function ControlSection({ title, children }) {
  return (
    <section className="rounded-xl border border-[var(--vd-border)] p-4">
      <h2 className="mb-3 text-sm font-semibold text-oai-black dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

export function EntireControlPanel({ repo = "", onActionSuccess, className = "" }) {
  return (
    <aside className={cn("vd-card rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-5 shadow-glass", className)}>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-oai-black dark:text-white">Controls</h2>
        <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          Manage agents, configuration, and maintenance without crowding checkpoint usage.
        </p>
      </div>

      {!repo ? (
        <p className="rounded-xl border border-dashed border-oai-gray-300 p-4 text-sm text-oai-gray-500 dark:border-oai-gray-700 dark:text-oai-gray-400">
          Select a repo to manage Entire controls.
        </p>
      ) : (
        <div className="space-y-4">
          <ControlSection title="Agents and status">
            <EntireActionsPanel repo={repo} onActionSuccess={onActionSuccess} />
          </ControlSection>
          <ControlSection title="Configure">
            <AdvancedConfigurePanel repo={repo} onActionSuccess={onActionSuccess} />
          </ControlSection>
          <ControlSection title="Maintenance">
            <EntireMaintenancePanel repo={repo} onActionSuccess={onActionSuccess} />
          </ControlSection>
        </div>
      )}
    </aside>
  );
}
```

- [ ] **Step 6: Run command/control tests and verify they pass**

Run:

```bash
npm --prefix dashboard run test -- EntireCommandCenter.test.jsx EntireControlPanel.test.jsx
```

Expected: all command-center/control-panel tests pass.

- [ ] **Step 7: Commit command-center controls**

Run:

```bash
git add dashboard/src/components/entire/EntireCommandCenter.jsx dashboard/src/components/entire/EntireControlPanel.jsx dashboard/src/components/entire/EntireCommandCenter.test.jsx dashboard/src/components/entire/EntireControlPanel.test.jsx
git commit -m "feat: streamline entire command controls"
```

Expected: commit succeeds with the new command/control component files staged.

## Task 5: Page Integration

**Files:**
- Modify: `dashboard/src/pages/EntirePage.jsx`
- Modify: `dashboard/src/pages/EntirePage.test.jsx`
- Modify: `dashboard/src/pages/EntirePage.actions.test.jsx`
- Use: `dashboard/src/components/entire/EntireCommandCenter.jsx`
- Use: `dashboard/src/components/entire/EntireControlPanel.jsx`
- Use: `dashboard/src/components/entire/CheckpointTimeline.jsx`

- [ ] **Step 1: Write or update page assertions for new layout**

Update `dashboard/src/pages/EntirePage.test.jsx` with assertions that the page now renders:

```jsx
expect(await screen.findByText("Repo command center")).toBeTruthy();
expect(screen.getByRole("heading", { name: "Checkpoint timeline" })).toBeTruthy();
expect(screen.getByText("Controls")).toBeTruthy();
expect(screen.queryByText("Checkpoint files")).toBeNull();
```

Keep existing fetch mocks and repo-load assertions intact. Do not remove tests for load repo, status, checkpoint loading, or unavailable checkpoint states.

- [ ] **Step 2: Run page tests and verify they fail on old layout**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx
```

Expected: fails because `EntirePage.jsx` still renders the old `CheckpointList` and old control grid.

- [ ] **Step 3: Replace page composition**

Modify `dashboard/src/pages/EntirePage.jsx`:

- Remove imports for `RepoPathSelector`, `EntireStatusCard`, `CheckpointList`, `EntireActionsPanel`, `AdvancedConfigurePanel`, `EntireMaintenancePanel`, and `RecentReposPane`.
- Add imports:

```js
import { EntireCommandCenter } from "../components/entire/EntireCommandCenter";
import { EntireControlPanel } from "../components/entire/EntireControlPanel";
import { CheckpointTimeline } from "../components/entire/CheckpointTimeline";
```

- Keep existing state and data loading callbacks.
- Add a request version guard with `useRef` so old repo loads cannot overwrite newer repo selections:

```js
const loadSeqRef = useRef(0);
```

Inside `loadRepo` before starting requests:

```js
const seq = loadSeqRef.current + 1;
loadSeqRef.current = seq;
```

After `Promise.allSettled`, before writing results:

```js
if (loadSeqRef.current !== seq) return;
```

- Replace the old return body with:

```jsx
return (
  <PageFrame hideHeader compact maxWidth="max-w-[1760px]">
    <div className="flex h-full min-h-0 max-h-full flex-col gap-5 overflow-y-auto overflow-x-hidden pr-1">
      <EntireCommandCenter
        repoInput={repoInput}
        onRepoInputChange={setRepoInput}
        onRepoSubmit={loadRepo}
        repoSuggestions={repoSuggestions}
        selectedRepo={selectedRepo}
        onRecentRepoSelect={loadRepo}
        onRecentRepoRemove={removeRepo}
        repoLoading={statusLoading || checkpointsLoading}
        repoError={repoError}
        status={statusData}
        statusLoading={statusLoading}
        statusError={statusError}
      />

      <div className="grid min-h-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <CheckpointTimeline
          repo={selectedRepo}
          checkpoints={checkpointsData}
          loading={checkpointsLoading}
          error={checkpointsError}
        />
        <EntireControlPanel
          repo={selectedRepo}
          onActionSuccess={refreshSelectedRepo}
          className="xl:sticky xl:top-0 xl:self-start"
        />
      </div>
    </div>
  </PageFrame>
);
```

- Delete the local `WorkspacePanel` helper from `EntirePage.jsx` if it becomes unused.

- [ ] **Step 4: Run page tests and fix assertion drift**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx
```

Expected: tests pass after updating assertions that depended on old layout positions.

- [ ] **Step 5: Run checkpoint and command/control tests together**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx CheckpointTimeline.test.jsx CheckpointCard.test.jsx checkpoint-card-utils.test.js EntireCommandCenter.test.jsx EntireControlPanel.test.jsx
```

Expected: all listed tests pass.

- [ ] **Step 6: Commit page integration**

Run:

```bash
git add dashboard/src/pages/EntirePage.jsx dashboard/src/pages/EntirePage.test.jsx dashboard/src/pages/EntirePage.actions.test.jsx
git commit -m "feat: revamp entire dashboard layout"
```

Expected: commit succeeds with page integration files staged.

## Task 6: Full Verification and Polish

**Files:**
- Modify only files touched in Tasks 1-5 if verification finds bugs.
- Do not edit backend destructive-command paths in this task.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
npm --prefix dashboard run test -- EntirePage.test.jsx EntirePage.actions.test.jsx CheckpointTimeline.test.jsx CheckpointCard.test.jsx checkpoint-card-utils.test.js EntireCommandCenter.test.jsx EntireControlPanel.test.jsx CheckpointFileInspector.test.jsx checkpoint-file-utils.test.js
```

Expected: all focused Entire dashboard tests pass.

- [ ] **Step 2: Run dashboard build**

Run:

```bash
npm --prefix dashboard run build
```

Expected: Vite build completes successfully.

- [ ] **Step 3: Manual local smoke test**

Start the dashboard:

```bash
npm --prefix dashboard run dev
```

Expected: Vite prints a local URL, usually `http://localhost:5173`.

In the browser:

- Open `/entire`.
- Load `/Users/vasuyadav/Downloads/Projects/VibeDeck`.
- Confirm the top area reads as repo command center.
- Confirm controls are not squeezed into the same row as checkpoint usage.
- Confirm checkpoint timeline does not show raw file rows.
- Expand a prompt and confirm it was collapsed before the click.
- Expand captured activity and confirm it shows counts, not raw JSONL preview lines.
- Expand advanced details and confirm raw metadata appears only there.

- [ ] **Step 4: Stop dev server**

Stop the Vite dev server with `Ctrl+C` in the running terminal session.

Expected: dev server exits cleanly.

- [ ] **Step 5: Commit verification fixes**

If Step 1, Step 2, or Step 3 required code fixes, commit only those fixes:

```bash
git add dashboard/src/components/entire dashboard/src/pages/EntirePage.jsx dashboard/src/pages/EntirePage.test.jsx dashboard/src/pages/EntirePage.actions.test.jsx
git commit -m "fix: polish entire dashboard revamp"
```

Expected: commit succeeds only when verification produced actual file changes.

## Final Acceptance

- `/entire` uses command-center + checkpoint timeline layout.
- Repo selection, recent repos, status, agents, configure, and maintenance controls are separated into calmer regions.
- Checkpoints render as cards, not file tree rows.
- Current metadata and usage are preserved and accumulated.
- Multiple models/providers show token and cost breakdown rows.
- Prompts are collapsed by default.
- JSONL data is summarized as captured activity counts.
- Raw files and parse errors are available only under advanced details.
- Focused tests and dashboard build pass.
