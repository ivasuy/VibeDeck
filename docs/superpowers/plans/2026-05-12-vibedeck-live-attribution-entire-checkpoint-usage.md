# VibeDeck Live Attribution And Entire Checkpoint Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix live attribution latency, live cost display, SSE backpressure warnings, scoped canonical warnings, live drawer ordering, and add token/cost/model usage summaries to Entire checkpoint metadata cards.

**Architecture:** Keep canonical SQLite as the durable source. Live SSE events should carry the same attribution fields that were just written to `vibedeck_sessions`, while backend rollups remain authoritative for project/worktree/branch audit totals. Entire checkpoint usage should join checkpoint metadata to canonical sessions through persisted Entire links first, with overlap matching only as a fallback.

**Tech Stack:** Node.js CommonJS, `node:sqlite`, existing VibeDeck session pipeline, local API SSE, React/Vite, Vitest, Node test runner, `rtk`.

---

## File Audit

### Live Cost UI

- `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
  - The top cost line uses `Counter` with `digitStyle={{ width: "0.72ch" }}` and `gap={0}`. This can visually squeeze `$597.16`.
  - It appends `<span className="ml-1">project total</span>` beside the cost. The token number above already describes the aggregate scope, so this flag is redundant and visually noisy.
  - The overview tiles still include `Project total` and `Known cost` labels. These are acceptable for secondary tiles, but the headline cost should not repeat scope text.

- `dashboard/src/components/live/LiveSessionList.jsx`
  - Workstream cards label audit totals as `Project tokens` and `Project cost`.
  - The cost is correct semantically, but the card should make tokens and cost look paired, not like two unrelated flags.

- `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
  - Drawer metrics also use `Project tokens` and `Project cost`.
  - The drawer session rows are sorted by backend order. Current active sessions can be mixed with stale sessions inside branch groups when backend branch group order or local fallback order changes.

### Live Attribution Latency And Unversioned Repos

- `src/lib/sessions/pipeline.js`
  - `emitSessionEvent()` sends `tier: latest.branch_resolution_tier` but not `branch_resolution_tier`.
  - The frontend reads `branch_resolution_tier`, so immediate `session:update` rows can display `Tier --` or appear less attributed until a later `rollup:update`.
  - `emitSessionEvent()` also omits `cwd`, `repo_common_dir`, and `parent_repo`, even though the latest DB row has them.
  - `resolveRepo(event.cwd)` returns a status such as `not_in_repo`, but this status is not persisted or surfaced. For directories without `.git`, the backend correctly falls back to `cwd_only`, but the UI labels it as `unattributed`, which looks like a bug instead of an expected unversioned-project state.

- `src/lib/sessions/live-rollups.js`
  - `projectScopeKey()` already distinguishes `audit_scope: "cwd_only"` and `audit_scope: "session_only"`.
  - Frontend components do not use `audit_scope` to present better labels.
  - `branch_groups` are sorted alphabetically. This can put a stale branch above the branch containing the active current session.

- `dashboard/src/lib/live-workstreams.js`
  - The compatibility fallback groups by `repo_root || cwd || provider:session_id`, but its labels do not distinguish unversioned directories from true missing attribution.

- `dashboard/src/components/live/ConfidenceBadge.jsx`
  - Current badge vocabulary is confidence-oriented only. It does not have a state like `No Git repo` or `CWD only`.

### SSE MaxListeners Warning

- `src/lib/local-api.js`
  - In `/functions/vibedeck-sessions-live`, `flushQueue()` calls `res.once("drain", flushQueue)` whenever `res.write()` returns `false`.
  - There is no `waitingForDrain` guard. If more updates arrive before the response drains, multiple one-shot `drain` listeners can be attached to the same `ServerResponse`.
  - This matches the runtime warning:
    `MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 drain listeners added to [ServerResponse]`.

### Canonical Incomplete Warning

- `src/lib/sessions/canonical-completeness.js`
  - Completeness is global: any positive-token session without bucket facts makes `complete: false`.
  - In the current live DB audit, only two old account-level Cursor rows were missing bucket facts, while live project/workstream rows were usable.
  - Live page warning therefore can be too broad: it says Live audit totals may exclude older sessions even when the active workstream scope is complete.

- `src/lib/local-api.js`
  - `readLiveSessionsSnapshot()` sets `canonical_incomplete: !canonical.complete` from the global check.
  - This should become scope-aware for Live while preserving the global diagnostic details.

- `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
  - Warning text is hard-coded instead of using `copy.csv`.
  - It has only one severity. It should not show for unrelated global backfill gaps.

### Entire Checkpoint Usage

- `src/lib/sessions/tier-a-entire.js`
  - Tier A can resolve `entire_session_id` and `checkpoint_ids`, but callers do not persist these links.

- `src/lib/db/migrations/003-entire-links-and-repos.js`
  - `vibedeck_session_entire_links` already exists and is the right durable place to store checkpoint/session joins.

- `src/lib/sessions/pipeline.js`
  - `resolveBranchForSession()` can return `entire_link`, but `processSessionEvent()` does not write `vibedeck_session_entire_links`.

- `src/lib/entire-bridge.js`
  - `readCheckpoint()` parses metadata JSON and JSONL summaries but does not enrich payloads with VibeDeck token/cost/model usage.
  - `listCheckpointsCached()` returns only file paths.

- `src/lib/local-api.js`
  - `/functions/vibedeck-checkpoints` returns `{ available, files }`.
  - `/functions/vibedeck-checkpoint` returns one file payload.
  - Both endpoints can be extended without breaking existing callers by adding optional `checkpoint_usage` fields.

- `dashboard/src/components/entire/CheckpointList.jsx`
  - Groups checkpoint files and renders each file row.
  - It currently fetches only selected file details; list rows have no usage preview.

- `dashboard/src/components/entire/CheckpointFileInspector.jsx`
  - Metadata preview renders primitive JSON fields only.
  - It can render an added `usage` block above metadata fields.

---

## Data Contract

### Live SSE Session Payload

Every `session:start`, `session:update`, and `session:end` emitted after DB write should include:

```js
{
  provider,
  session_id,
  cwd,
  repo_root,
  repo_common_dir,
  parent_repo,
  branch,
  branch_resolution_tier,
  confidence,
  model,
  total_tokens,
  total_cost_usd,
  estimated_total_cost_usd,
  cost_quality,
  last_observed_at,
  updated_at,
  started_at,
  ended_at
}
```

`tier` may remain for backwards compatibility, but `branch_resolution_tier` must be present.

### Live Canonical Status

Live snapshot should return both:

```js
{
  canonical: { complete: false, sessions_missing_bucket_facts: 2, ... },
  live_canonical: { complete: true, scoped_session_count: 9, scoped_missing_bucket_facts: 0, ... },
  canonical_incomplete: false
}
```

For Live UI, `canonical_incomplete` should represent active workstream scope, not unrelated global gaps.

### Entire Checkpoint Usage

`/functions/vibedeck-checkpoints?repo=...` should keep `files` and add:

```js
{
  available: true,
  files: ["06/e2abdc1ec6/metadata.json", "..."],
  checkpoint_usage: {
    "06/e2abdc1ec6": {
      checkpoint_id: "e2abdc1ec6",
      metadata_path: "06/e2abdc1ec6/metadata.json",
      agent: "claude-code",
      branch: "main",
      total_tokens: 12345,
      total_cost_usd: 0.42,
      cost_unknown_count: 0,
      models: [{ model: "claude-sonnet-4-6", total_tokens: 12345, total_cost_usd: 0.42 }],
      providers: [{ provider: "claude", total_tokens: 12345, total_cost_usd: 0.42 }],
      session_count: 1,
      confidence: "linked"
    }
  }
}
```

`/functions/vibedeck-checkpoint?repo=...&path=...metadata.json` should add the matching `usage` object to the file payload.

---

## Task 1: Fix Immediate Live Attribution Payloads

**Files:**
- Modify: `src/lib/sessions/pipeline.js`
- Test: `test/session-live-current-log.test.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Add failing backend test**

Add a test that processes a session event from a real git repo and listens to the live bus. Assert the emitted event contains `branch_resolution_tier`, `cwd`, `repo_root`, `repo_common_dir`, `parent_repo`, `branch`, and `confidence`.

Run:

```bash
rtk node --test test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js
```

Expected before implementation: fail because emitted event has `tier` but not `branch_resolution_tier`.

- [ ] **Step 2: Update emitSessionEvent()**

In `src/lib/sessions/pipeline.js`, extend the payload from `latest`:

```js
cwd: latest ? latest.cwd : event.cwd,
repo_root: latest ? latest.repo_root : null,
repo_common_dir: latest ? latest.repo_common_dir : null,
parent_repo: latest ? latest.parent_repo : null,
branch: latest ? latest.branch : null,
branch_resolution_tier: latest ? latest.branch_resolution_tier : null,
tier: latest ? latest.branch_resolution_tier : null,
confidence: latest ? latest.confidence : null,
last_observed_at: latest ? latest.last_observed_at : event.observed_at,
started_at: latest ? latest.started_at : event.started_at,
updated_at: latest ? latest.updated_at : null,
```

- [ ] **Step 3: Verify**

Run:

```bash
rtk node --test test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js
```

- [ ] **Step 4: Commit**

```bash
rtk git add src/lib/sessions/pipeline.js test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "fix: emit complete live attribution payloads"
```

---

## Task 2: Distinguish Unversioned CWD Projects From True Unattributed Sessions

**Files:**
- Modify: `dashboard/src/lib/live-workstreams.js`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Modify: `dashboard/src/components/live/ConfidenceBadge.jsx`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/lib/live-workstreams.test.js`
- Test: `dashboard/src/components/live/LiveSessionList.test.jsx`
- Test: `dashboard/src/components/live/LiveWorkbenchOverview.test.jsx`

- [ ] **Step 1: Add failing frontend tests**

Add cases for a backend workstream with:

```js
{
  audit_scope: "cwd_only",
  cwd: "/Users/dev/no-git-project",
  repo_root: null,
  branches: ["unattributed"],
  confidence: "unattributed"
}
```

Expected UI copy:

- Workstream card shows `No Git repo` or `CWD only`, not only `Unattributed`.
- Branch line explains `Branch unavailable`.
- It does not count this as a broken attribution gap in the same way as a missing `cwd`.

- [ ] **Step 2: Add label helpers**

In `dashboard/src/lib/live-workstreams.js`, export helpers:

```js
export function liveScopeLabel(workstream) {
  if (workstream?.audit_scope === "cwd_only") return "No Git repo";
  if (workstream?.audit_scope === "session_only") return "Session only";
  return "";
}

export function liveBranchLabel(workstream, row) {
  if (workstream?.audit_scope === "cwd_only") return "Branch unavailable";
  const branch = String(row?.branch || workstream?.branches?.[0] || "").trim();
  return branch || "Unattributed";
}
```

- [ ] **Step 3: Use labels in cards and drawer**

Use `audit_scope` to show expected unversioned state instead of making no-git projects look like accidental attribution failures.

- [ ] **Step 4: Verify**

Run:

```bash
rtk npm --prefix dashboard run test -- src/lib/live-workstreams.test.js src/components/live/LiveSessionList.test.jsx src/components/live/LiveWorkbenchOverview.test.jsx
```

- [ ] **Step 5: Commit**

```bash
rtk git add dashboard/src/lib/live-workstreams.js dashboard/src/components/live/LiveSessionList.jsx dashboard/src/components/live/LiveWorkstreamDrawer.jsx dashboard/src/components/live/ConfidenceBadge.jsx dashboard/src/content/copy.csv dashboard/src/lib/live-workstreams.test.js dashboard/src/components/live/LiveSessionList.test.jsx dashboard/src/components/live/LiveWorkbenchOverview.test.jsx
rtk git commit -m "fix: label unversioned live workstreams"
```

---

## Task 3: Clean Up Live Cost Display And Spacing

**Files:**
- Modify: `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
- Modify: `dashboard/src/components/live/LiveSessionList.jsx`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Test: `dashboard/src/components/live/LiveWorkbenchOverview.test.jsx`
- Test: `dashboard/src/pages/LivePage.test.jsx`

- [ ] **Step 1: Add failing tests**

Assert:

- Headline cost does not render `project total` next to the dollar amount.
- Headline cost still renders the same aggregate value from `totals.audit_cost_usd`.
- Workstream cards and drawer still show token/cost pairs.

- [ ] **Step 2: Replace headline cost Counter**

In `LiveWorkbenchOverview.jsx`, use a plain tabular number for cost or a wider `Counter`. Preferred implementation:

```jsx
<div className="mt-3 text-base font-semibold tabular-nums tracking-[0.03em] text-oai-brand dark:text-oai-brand-300">
  {costDisplay}
</div>
```

Remove:

```jsx
<span className="ml-1">project total</span>
```

- [ ] **Step 3: Rename paired labels where needed**

Keep user meaning clear:

- Top number remains audit tokens.
- Cost underneath is the matching audit cost.
- Workstream card can use `Tokens` and `Cost` when displayed side-by-side, while detailed drawer can use `Audit tokens`, `Audit cost`, `Live tokens`, `Live cost`.

- [ ] **Step 4: Verify**

Run:

```bash
rtk npm --prefix dashboard run test -- src/components/live/LiveWorkbenchOverview.test.jsx src/pages/LivePage.test.jsx
rtk npm --prefix dashboard run lint
```

- [ ] **Step 5: Commit**

```bash
rtk git add dashboard/src/components/live/LiveWorkbenchOverview.jsx dashboard/src/components/live/LiveSessionList.jsx dashboard/src/components/live/LiveWorkstreamDrawer.jsx dashboard/src/components/live/LiveWorkbenchOverview.test.jsx dashboard/src/pages/LivePage.test.jsx
rtk git commit -m "fix: simplify live cost display"
```

---

## Task 4: Prevent Duplicate SSE Drain Listeners

**Files:**
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-sessions-live.test.js`

- [ ] **Step 1: Add failing SSE backpressure test**

Create a mock response where `write()` returns `false` until `drain` is emitted. Emit more than 10 live updates before drain and assert:

```js
assert.equal(res.listenerCount("drain"), 1);
```

Expected before implementation: more than one drain listener is attached.

- [ ] **Step 2: Add waitingForDrain state**

Inside the SSE client object add:

```js
waitingForDrain: false,
```

Update `flushQueue()`:

```js
if (client.waitingForDrain) return;
...
if (!ok) {
  client.waitingForDrain = true;
  res.once("drain", () => {
    client.waitingForDrain = false;
    flushQueue();
  });
  return;
}
```

Also avoid direct heartbeat writes while waiting for drain:

```js
if (!client.waitingForDrain) writeChunk(": heartbeat\n\n");
```

- [ ] **Step 3: Verify warning reproduction no longer triggers**

Run:

```bash
rtk node --test test/local-api-vibedeck-sessions-live.test.js
```

Then run a manual serve smoke and open the dashboard with multiple tabs:

```bash
rtk node bin/vibedeck.js serve --port 7690
```

Expected: no `MaxListenersExceededWarning`.

- [ ] **Step 4: Commit**

```bash
rtk git add src/lib/local-api.js test/local-api-vibedeck-sessions-live.test.js
rtk git commit -m "fix: guard live sse drain listeners"
```

---

## Task 5: Make Live Canonical Warning Scope-Aware

**Files:**
- Modify: `src/lib/sessions/canonical-completeness.js`
- Modify: `src/lib/sessions/live-rollups.js`
- Modify: `src/lib/local-api.js`
- Modify: `dashboard/src/components/live/LiveWorkbenchOverview.jsx`
- Modify: `dashboard/src/hooks/use-vibedeck-live-sessions.ts`
- Test: `test/canonical-completeness.test.js`
- Test: `test/local-api-vibedeck-live-rollups.test.js`
- Test: `dashboard/src/hooks/use-vibedeck-live-sessions.test.ts`

- [ ] **Step 1: Add failing tests for unrelated global gaps**

Create DB rows where:

- One active VibeDeck session has bucket facts and stored cost.
- Two old Cursor account-level sessions have positive tokens and no bucket facts.

Expected live snapshot:

```js
body.canonical.complete === false
body.live_canonical.complete === true
body.canonical_incomplete === false
```

- [ ] **Step 2: Compute scoped completeness**

Add a helper that accepts session identities used by active workstream audit rows:

```js
function summarizeCanonicalCompletenessForSessions(dbPath, identities) { ... }
```

It should check only `(provider, session_id)` pairs in the active workstream audit scope.

- [ ] **Step 3: Return live_canonical from rollups or snapshot**

`readLiveSessionsSnapshot()` should preserve global `canonical` but set:

```js
live_canonical: scopedCompleteness,
canonical_incomplete: !scopedCompleteness.complete,
```

- [ ] **Step 4: Keep usage DB-first gating unchanged unless explicitly scoped**

Do not weaken global usage read-model safety in `src/lib/usage-read-models.js` in this task.

- [ ] **Step 5: Verify**

Run:

```bash
rtk node --test test/canonical-completeness.test.js test/local-api-vibedeck-live-rollups.test.js
rtk npm --prefix dashboard run test -- src/hooks/use-vibedeck-live-sessions.test.ts
```

- [ ] **Step 6: Commit**

```bash
rtk git add src/lib/sessions/canonical-completeness.js src/lib/sessions/live-rollups.js src/lib/local-api.js dashboard/src/hooks/use-vibedeck-live-sessions.ts test/canonical-completeness.test.js test/local-api-vibedeck-live-rollups.test.js dashboard/src/hooks/use-vibedeck-live-sessions.test.ts
rtk git commit -m "fix: scope live canonical completeness"
```

---

## Task 6: Put Current Active Session First In Workstream Drawer

**Files:**
- Modify: `src/lib/sessions/live-rollups.js`
- Modify: `dashboard/src/components/live/LiveWorkstreamDrawer.jsx`
- Test: `test/sessions-live-rollups.test.js`
- Test: `dashboard/src/components/live/LiveSessionList.test.jsx`

- [ ] **Step 1: Add failing ordering tests**

Backend expected order:

- Branch groups with active sessions first.
- Inside each branch group, active sessions first.
- Within active and stale groups, newest `last_observed_at` first.

Frontend expected order:

- The selected/current active session appears above stale history in the drawer.

- [ ] **Step 2: Sort branch groups and sessions**

In `src/lib/sessions/live-rollups.js`, sort branch groups by:

1. `active_session_count > 0`
2. newest active `liveSortIso`
3. newest audit `liveSortIso`
4. branch label

Sort `group.sessions` by:

1. active before ended/stale
2. `liveSortIso` descending

- [ ] **Step 3: Add frontend defensive sort**

In `LiveWorkstreamDrawer.jsx`, derive displayed sessions with the same active-first rule in case older backend payloads are used.

- [ ] **Step 4: Verify**

Run:

```bash
rtk node --test test/sessions-live-rollups.test.js
rtk npm --prefix dashboard run test -- src/components/live/LiveSessionList.test.jsx
```

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/sessions/live-rollups.js dashboard/src/components/live/LiveWorkstreamDrawer.jsx test/sessions-live-rollups.test.js dashboard/src/components/live/LiveSessionList.test.jsx
rtk git commit -m "fix: show current live session first"
```

---

## Task 7: Persist Entire Checkpoint Session Links

**Files:**
- Create: `src/lib/sessions/entire-links.js`
- Modify: `src/lib/sessions/pipeline.js`
- Test: `test/sessions-entire-links.test.js`

- [ ] **Step 1: Add failing link persistence test**

Process an event whose Tier A branch resolver returns:

```js
{
  branch: "main",
  tier: "A",
  confidence: "high",
  entire_link: "entire-session-1",
  checkpoint_ids: ["e2abdc1ec6"]
}
```

Assert `vibedeck_session_entire_links` contains that provider/session/link.

- [ ] **Step 2: Implement upsert helper**

Create `src/lib/sessions/entire-links.js`:

```js
'use strict';

function upsertEntireLink(db, { provider, session_id, entire_session_id, checkpoint_ids = [], match_confidence = 'high' } = {}) {
  if (!provider || !session_id || !entire_session_id) return false;
  db.prepare(`
    INSERT INTO vibedeck_session_entire_links (
      provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(provider, session_id, entire_session_id) DO UPDATE SET
      entire_checkpoint_ids = excluded.entire_checkpoint_ids,
      match_confidence = excluded.match_confidence
  `).run(provider, session_id, entire_session_id, JSON.stringify(checkpoint_ids || []), match_confidence);
  return true;
}

module.exports = { upsertEntireLink };
```

- [ ] **Step 3: Call helper from pipeline**

After `updateBranchResolution()`, if `branchRes.entire_link` exists, call `upsertEntireLink()`.

- [ ] **Step 4: Verify**

Run:

```bash
rtk node --test test/sessions-entire-links.test.js test/sessions-tier-a.test.js
```

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/sessions/entire-links.js src/lib/sessions/pipeline.js test/sessions-entire-links.test.js
rtk git commit -m "feat: persist entire checkpoint session links"
```

---

## Task 8: Add Backend Entire Checkpoint Usage Rollups

**Files:**
- Create: `src/lib/entire-checkpoint-usage.js`
- Modify: `src/lib/local-api.js`
- Test: `test/local-api-vibedeck-checkpoints.test.js`

- [ ] **Step 1: Add failing API tests**

Build a DB with:

- One `vibedeck_sessions` row linked through `vibedeck_session_entire_links`.
- `total_tokens`, `total_cost_usd`, `model`, and `provider` set.
- A stub `listCheckpointsCached()` returning one `metadata.json`.

Expected `/functions/vibedeck-checkpoints` includes `checkpoint_usage[groupId]`.

Expected `/functions/vibedeck-checkpoint` for that metadata file includes `usage`.

- [ ] **Step 2: Implement read model**

`src/lib/entire-checkpoint-usage.js` responsibilities:

- Normalize checkpoint group id with the same rules as frontend.
- Read linked sessions from `vibedeck_session_entire_links`.
- Sum tokens and cost from `vibedeck_sessions`.
- Group provider and model breakdowns.
- Return `null` cost when any linked session has unknown cost.
- Fallback to metadata overlap only when no persisted link exists and metadata has `agent`, `started_at`, and `ended_at`.

- [ ] **Step 3: Extend local API**

In `/functions/vibedeck-checkpoints`, add:

```js
const checkpoint_usage = readCheckpointUsageSummary(dbPath, repoRoot, result.files, bridge);
json(res, { ...result, checkpoint_usage });
```

In `/functions/vibedeck-checkpoint`, if the path is metadata, add:

```js
json(res, { ...data, usage: usageByGroup[groupId] || null });
```

- [ ] **Step 4: Verify**

Run:

```bash
rtk node --test test/local-api-vibedeck-checkpoints.test.js
```

- [ ] **Step 5: Commit**

```bash
rtk git add src/lib/entire-checkpoint-usage.js src/lib/local-api.js test/local-api-vibedeck-checkpoints.test.js
rtk git commit -m "feat: expose entire checkpoint usage"
```

---

## Task 9: Show Entire Checkpoint Tokens, Cost, And Models In UI

**Files:**
- Modify: `dashboard/src/components/entire/CheckpointList.jsx`
- Modify: `dashboard/src/components/entire/CheckpointFileInspector.jsx`
- Modify: `dashboard/src/components/entire/checkpoint-file-utils.js`
- Modify: `dashboard/src/lib/vibedeck-api.ts`
- Modify: `dashboard/src/content/copy.csv`
- Test: `dashboard/src/pages/EntirePage.test.jsx`
- Test: `dashboard/src/components/entire/CheckpointFileInspector.test.jsx`

- [ ] **Step 1: Add failing UI tests**

Mock `getCheckpoints()` with:

```js
{
  available: true,
  files: ["06/e2abdc1ec6/metadata.json", "06/e2abdc1ec6/0/prompt.txt"],
  checkpoint_usage: {
    "06/e2abdc1ec6": {
      total_tokens: 12345,
      total_cost_usd: 0.42,
      models: [{ model: "claude-sonnet-4-6", total_tokens: 12345, total_cost_usd: 0.42 }],
      providers: [{ provider: "claude", total_tokens: 12345, total_cost_usd: 0.42 }]
    }
  }
}
```

Assert the checkpoint card shows:

- `12,345`
- `$0.42`
- `claude-sonnet-4-6`

Mock `getCheckpoint()` for `metadata.json` with `usage` and assert inspector shows model/provider breakdown.

- [ ] **Step 2: Attach usage to groups**

In `CheckpointList.jsx`, lookup usage by `group.id` and render compact stats below group label.

- [ ] **Step 3: Render metadata usage panel**

In `CheckpointFileInspector.jsx`, if `file.usage` exists, render a top preview block with:

- Total tokens.
- Total cost or `Unknown`.
- Model chips.
- Provider breakdown rows.

- [ ] **Step 4: Verify**

Run:

```bash
rtk npm --prefix dashboard run test -- src/pages/EntirePage.test.jsx src/components/entire/CheckpointFileInspector.test.jsx
rtk npm --prefix dashboard run typecheck
```

- [ ] **Step 5: Commit**

```bash
rtk git add dashboard/src/components/entire/CheckpointList.jsx dashboard/src/components/entire/CheckpointFileInspector.jsx dashboard/src/components/entire/checkpoint-file-utils.js dashboard/src/lib/vibedeck-api.ts dashboard/src/content/copy.csv dashboard/src/pages/EntirePage.test.jsx dashboard/src/components/entire/CheckpointFileInspector.test.jsx
rtk git commit -m "feat: show entire checkpoint usage"
```

---

## Task 10: Verification And Stress Test

**Files:**
- No planned code changes.

- [ ] **Step 1: Focused backend**

```bash
rtk node --test test/session-live-current-log.test.js test/local-api-vibedeck-sessions-live.test.js test/local-api-vibedeck-live-rollups.test.js test/sessions-live-rollups.test.js test/canonical-completeness.test.js test/local-api-vibedeck-checkpoints.test.js test/sessions-entire-links.test.js
```

- [ ] **Step 2: Focused dashboard**

```bash
rtk npm --prefix dashboard run test -- src/hooks/use-vibedeck-live-sessions.test.ts src/components/live/LiveWorkbenchOverview.test.jsx src/components/live/LiveSessionList.test.jsx src/pages/LivePage.test.jsx src/pages/EntirePage.test.jsx src/components/entire/CheckpointFileInspector.test.jsx
```

- [ ] **Step 3: Full checks**

```bash
rtk node --test test/*.test.js
rtk npm --prefix dashboard run lint
rtk npm --prefix dashboard run typecheck
rtk npm --prefix dashboard run test
rtk npm --prefix dashboard run build
```

- [ ] **Step 4: Manual serve smoke**

```bash
rtk node bin/vibedeck.js sync
rtk node bin/vibedeck.js serve --port 7690
```

Acceptance:

- No `MaxListenersExceededWarning`.
- Live headline cost has no `project total` suffix and does not overlap.
- Git repos get branch/tier immediately after a live update, not only after delayed rollup.
- Non-git directories show `No Git repo` or `CWD only` instead of ambiguous `Unattributed`.
- Canonical warning does not appear when only unrelated global sessions are missing bucket facts.
- Drawer shows active current session before stale history.
- Entire checkpoint cards and metadata preview show tokens, cost, and model breakdown when canonical links exist.

- [ ] **Step 5: Commit only if verification required small fixes**

```bash
rtk git status --short
rtk git add <exact changed files>
rtk git commit -m "test: verify live attribution and checkpoint usage"
```

---

## Acceptance Criteria

- Immediate SSE session updates include `branch_resolution_tier`, repo fields, branch, confidence, and activity timestamps from the latest DB row.
- Existing git repos no longer sit in temporary unattributed UI state because of missing frontend field names.
- Repos/directories without `.git` are shown as unversioned/cwd-only, not as a mysterious broken project.
- Top live cost no longer has the `project total` suffix and has enough spacing to avoid digit overlap.
- SSE backpressure cannot add more than one pending `drain` listener per response.
- Live canonical warning is scoped to active workstream audit rows.
- Active/current session appears first in the drawer, with stale sessions treated as history.
- Entire checkpoint listing shows tokens, cost, and model preview when linked usage exists.
- Metadata inspector shows token/cost/model/provider breakdown for the selected checkpoint.
- Full backend and dashboard checks pass.

## Known Non-Goals

- Do not change parser math, token normalization, or provider pricing in `src/lib/rollout.js`.
- Do not force every cwd-only directory to become a fake git repo.
- Do not hide truly unattributed sessions; only label expected unversioned cwd scopes more accurately.
- Do not make `/usage` DB-first gating less safe in the same task as Live warning scoping.
