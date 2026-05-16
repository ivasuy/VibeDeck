# VibeDeck self-audit — token capture, cost capture, project→branch→session attribution

**Scope:** Find real correctness gaps in the token/cost/attribution path. Not bug-hunting for sport. Every finding cites the exact file and line. Where I looked and found *nothing* wrong is recorded too, so the audit is falsifiable.

**Method:** Read every link in the chain from JSONL parsing → event emission → SQLite writes → rollups → SSE/HTTP responses. Cross-checked with codeburn's equivalents (the reference implementation) to flag known footguns.

**Files audited:**
- `src/lib/rollout.js` (token normalization at the source)
- `src/lib/sessions/extractors.js` (event shaping)
- `src/lib/sessions/event-ledger.js` (per-event persistence)
- `src/lib/sessions/writer.js` (session-level upsert)
- `src/lib/sessions/bucket-facts.js` (half-hour bucket rollup)
- `src/lib/sessions/branch-windows.js` (branch attribution)
- `src/lib/sessions/live-rollups.js` (live SSE rollup)
- `src/lib/cost-estimation.js` (cost resolution)
- `src/lib/pricing/index.js`, `src/lib/pricing/matcher.js`
- `src/lib/branch-usage.js`, `src/lib/project-usage.js`
- `src/lib/db/migrations/001-vibedeck-sessions.js`, `002-session-buckets-and-windows.js`

---

## 1. Verdict up front

The token capture pipeline is **solid at the lowest layer** — the normalizers in `rollout.js` are careful, documented, and handle real edge cases (Codex cumulative-vs-delta migration, Codex's cached-inside-input subtraction, Claude messageId+requestId dedup).

The **attribution layer above it is internally inconsistent**. Three different code paths attribute tokens to branches, and they disagree. Two are mathematically wrong; the third is only available in one report.

The **pricing layer has two silent under-billing bugs** (1h cache TTL, web search) that depend on whether the user actually uses those features — but the bugs are present in code, not just speculation.

This is not "your itch is wrong." There are real, citable problems. None are catastrophic. Several quietly understate cost and misattribute usage to the wrong branch.

---

## 2. Findings (high-confidence, with citations)

### Finding A — Three different branch-attribution paths disagree
**Severity:** high. **Confidence:** confirmed by reading all three call sites.

There are three places that report "tokens per branch" and they use three different rules:

1. **`branch-usage.js:115–161`** — joins `vibedeck_session_branch_windows`. Uses time-prorated per-window totals. The math is wrong (see Finding B) but at least attempts per-window attribution.
2. **`live-rollups.js:169` + `:244–249`** — SSE live byBranch panel. Reads `row.branch` (a single column on `vibedeck_sessions`) and dumps the entire session's `total_tokens` and cost into that one branch.
3. **`project-usage.js:495,517`** — project rollup. Same as above: takes `row.branch` from `vibedeck_sessions`, creates a `branches: [branchName]` array of length 1 per session, treats the whole session as belonging to one branch.

**Concrete consequence.** A Claude Code session that started on `main`, switched to `feature/x`, did 80% of its work there, switched back to `main` for one final checkpoint:

- The dedicated branch report shows tokens time-prorated across windows (probably wrong, see B).
- The dashboard's live byBranch panel attributes 100% of the session to `main` (because the writer's "last non-null" rule picks the final branch).
- The project rollup attributes 100% to `main` too.

Three views of the same data give three different answers. The DB has the right data (`vibedeck_session_branch_windows` exists per migration 002), but only one consumer uses it.

**Evidence:**
- `live-rollups.js:166–170`:
  ```js
  for (const row of rows) {
    const provider = text(row?.provider) || 'unknown';
    const model = safeModel(row?.model);
    const branch = safeBranch(row?.branch);
    const tokens = Number(row?.total_tokens || 0) || 0;
  ```
- `project-usage.js:495,517`:
  ```js
  const branchName = typeof row?.branch === 'string' && row.branch.trim() ? row.branch.trim() : null;
  ...
  branches: branchName ? [branchName] : [],
  ```

---

### Finding B — Branch attribution uses wall-clock proration, not actual usage
**Severity:** high. **Confidence:** confirmed.

Even the one path that uses branch windows (`branch-usage.js`) gets the math wrong, because the windows themselves are built by time-proration in `branch-windows.js:78–91`:

```js
for (let i = 0; i < boundsIso.length - 1; i++) {
  const durMs = boundsMs[i + 1] - boundsMs[i];
  ...
  tokens = Math.round((totalTokens * durMs) / totalMs);
  cost = hasKnownCost ? (totalCost * durMs) / totalMs : null;
```

Tokens are not spent uniformly over wall-clock time. A user who spends 30 minutes idle on `branch-A` and then 5 minutes hammering `branch-B` with heavy edits will see `branch-A` charged 6× the tokens it actually used.

**The fix data already exists.** `vibedeck_session_events` (migration 008) stores each event with branch attribution at insert time (`event-ledger.js:50–55`). The correct implementation would sum per-event tokens by branch instead of proration. Today, that data is written but never read by branch attribution.

---

### Finding C — Claude 1-hour cache TTL is priced at 5-minute rate
**Severity:** medium-high (cost-correctness). **Confidence:** confirmed.

Anthropic's API distinguishes `cache_creation.ephemeral_5m_input_tokens` and `cache_creation.ephemeral_1h_input_tokens`. The 1h tier is billed at ~2× input rate; the 5m tier at ~1.25× input rate.

`normalizeClaudeUsage` in `rollout.js:2487–2501` takes only the flat `cache_creation_input_tokens` field and treats the entire amount as a single cache_write bucket priced at the 5m rate:

```js
function normalizeClaudeUsage(u) {
  ...
  const cacheCreation = toNonNegativeInt(u?.cache_creation_input_tokens);
  ...
  return {
    cache_creation_input_tokens: cacheCreation,
    ...
  };
}
```

`grep -rn "ephemeral_1h\|ephemeral_5m" src/` returns nothing. There is no code path that reads the per-TTL breakdown.

For users who use 1h cache on system prompts (a common pattern for long-running coding sessions), this **systematically under-bills cache writes by ~60%**. Codeburn explicitly bumped `DAILY_CACHE_VERSION` to 6 to fix this exact bug — see `codeburn/src/daily-cache.ts:9–16`.

---

### Finding D — Web search / `server_tool_use` tokens are missing
**Severity:** medium (cost-correctness). **Confidence:** confirmed (negative — no code path exists).

Anthropic bills `server_tool_use.web_search_requests` separately ($10 / 1k queries plus a token charge). `grep -rn "web_search\|server_tool_use" src/` returns nothing. Sessions that used `WebSearch` show $0 for that portion. Codeburn handles this; we don't.

---

### Finding E — Reverse-substring fuzzy pricing can match new models to old prices
**Severity:** medium (cost-correctness). **Confidence:** mechanism confirmed; impact depends on which new model hits it.

`matcher.js:88–98` falls back to reverse-substring matching for unknown models, longest key first:

```js
const sorted = getSortedKeys(litellm);
for (const key of sorted) {
  const keyLower = key.toLowerCase();
  if (lower.includes(keyLower)) {
    return { hit: true, source: "litellm:fuzzy", value: litellm[key] };
  }
}
```

A future model whose name isn't in the snapshot will match the longest substring that *is*. Today this is unlikely to bite because the snapshot has `claude-opus-4-7`, `gpt-5-pro`, etc. But the next time Anthropic ships a model before the snapshot updates, that model will silently price at the next-closest older model's rate.

Codeburn defends against this by hard-coding fallback rates for every Claude/GPT model line — see codeburn's `src/models.ts` references to "hardcoded fallbacks for all Claude and GPT models to prevent mispricing." We rely on the matcher; codeburn doesn't trust it.

**Mitigation cost is small:** add curated fallbacks for the *model line* (e.g. any `claude-opus-*` → latest opus rate as a floor). Today we have curated overrides for kiro-* and hy3-* only — see `pricing/curated-overrides.json`.

---

### Finding F — Negative `delta_tokens` drops the whole update
**Severity:** low-medium. **Confidence:** confirmed.

`extractors.js:19`:

```js
if (delta_tokens != null && (!Number.isInteger(delta_tokens) || delta_tokens < 0)) return null;
```

If a provider ever reports a negative delta — which happens with usage corrections, integer overflow on stale counters, or upstream parser bugs that compute `current - previous` against a stale previous — the **entire update is silently discarded**, including its `input_tokens`, `cached_input_tokens`, `cache_creation_input_tokens`, `output_tokens`, and `reasoning_output_tokens` buckets.

This is defensible as a defensive measure, but the discard is silent. There's no counter, no warning. A pipeline regression that produced negative deltas would manifest as "VibeDeck reports 30% lower tokens than the provider's own UI" with no diagnostic trail.

---

### Finding G — `total_tokens` and bucket-sum can disagree per row
**Severity:** medium (consistency). **Confidence:** confirmed.

Two independent code paths write token counts to `vibedeck_sessions`:

1. **`writer.js:189–201`** sums `input_tokens / cached_input_tokens / cache_creation_input_tokens / output_tokens / reasoning_output_tokens` across `update` events into separate columns.
2. **`writer.js:179–187`** computes `total_tokens` independently: prefer `end.total_tokens` (authoritative), else sum `delta_tokens`.

Then **`bucket-facts.js:153–204`** (`recomputeSessionLedger`) overwrites `vibedeck_sessions.total_tokens` and `total_cost_usd` with the sum of bucket rows.

The bucket rows themselves have a fork at `bucket-facts.js:58–61`:

```js
const bucketTotalTokens =
  event.delta_tokens == null
    ? inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens + reasoningOutputTokens
    : Number(event.delta_tokens || 0) || 0;
```

If `delta_tokens` is present, it's used as `total_tokens`. The individual buckets are *still* stored alongside it and used for cost computation (`bucketCostPayload` line 33–45).

**Consequence:** If a provider reports `delta_tokens = 1000` but the buckets sum to 950 (e.g. delta includes some category we don't break out, like web search), the row stores `total_tokens = 1000` and cost computed from `950 worth of priced buckets`. The token total and the cost total tell different stories. Today the discrepancy is small for Claude/Codex, but the divergence is real and not asserted anywhere.

---

### Finding H — Two write paths, the second silently wins
**Severity:** low (smell, not bug). **Confidence:** confirmed.

`pipeline.js:387–398`:
```js
const inserted = insertSessionEvent(db, event, {...});
if (inserted) {
  upsertBucketFact(db, latest, event);
}
recomputeSessionLedger(db, latest);
```

The flow is: write event → write bucket → overwrite session totals from buckets. The writer's own `total_tokens / input_tokens / ...` sums are computed and stored but then **always** overwritten by the bucket-derived totals on the next event.

This is the intended design — bucket-derived totals are authoritative — but it means `writer.js`'s arithmetic on session-level token columns is dead-code-grade reasoning that runs on every event. If the two ever drift (e.g. an event dedupes at one layer but not the other), the bucket layer wins silently and the writer's sums are quietly discarded.

Not a correctness bug today. A complexity tax that makes future changes risky.

---

### Finding I — Half-hour bucket key collapses concurrent-but-distinct calls
**Severity:** low (granularity). **Confidence:** confirmed.

`bucket-facts.js:10–15`:
```js
function toUtcHalfHourStart(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return d.toISOString();
}
```

All updates in the same UTC half-hour for the same `(provider, session_id, bucket_model)` accumulate into one row. Multiple distinct API calls in the same 30-minute slot are summed. Fine for cost; loses information for per-call analytics (which is exactly what Phase B of the parity plan would want to recover). Worth knowing before we build the activity-breakdown layer.

---

## 3. Things I checked and found correct

These are positive findings — they go in the audit so it doesn't read as one-sided.

- **Codex `cached-inside-input` subtraction.** `rollout.js:2483` correctly subtracts cached tokens from Codex's `input_tokens` field before storing. Comment block 2471–2484 documents the bug it fixes (~6–7× cost inflation on cache-heavy Codex sessions, verified against ccusage). Solid work.
- **Codex cumulative-vs-delta migration.** `sync.js:1449–1508` documents and retracts a prior bug where cumulative usage was being stored as deltas, double-counting tokens. The retraction logic emits zero-out records into the queue and clears affected buckets. This was the right way to fix a historical correctness bug.
- **Claude message dedup.** `rollout.js:1048–1055` dedupes by `messageId:requestId`. Streaming partials of the same message don't double-count. `collectClaudeMessageHashes` in `sync.js:1601` walks every JSONL once to populate the dedup set.
- **Event-level dedup at SQL layer.** `event-ledger.js:37` uses `ON CONFLICT(provider, session_id, event_key) DO NOTHING`. If the same event arrives twice from two paths, the second is a no-op.
- **Event-key includes meaningful fields.** `event-ledger.js:3–13` builds keys from `kind|timestamp|delta_tokens|conversation_count` (or `total_tokens|end_reason` for end events). Re-reading the same JSONL line produces the same key. Solid.
- **Pricing snapshot covers current frontier models.** `seed-snapshot.json` contains exact entries for `claude-opus-4-7`, `claude-sonnet-4-6`, `gpt-5`, `gpt-5-codex`, etc. Today's models are priced via exact match, not fuzzy. Finding E is a future-tense risk, not a present-tense bug.
- **Reasoning-token folding for Codex/every-code.** `pricing/index.js:110–113` correctly skips charging `reasoning_output_tokens` for Codex/every-code because those providers fold reasoning into `output_tokens`. Avoids double-charging.
- **Negative pricing rejected.** `pricing/index.js:70–86` rejects negative per-token rates from a tampered LiteLLM JSON.

---

## 4. Severity-ordered remediation backlog

Each item ends with the smallest change that closes the gap. Do not bundle these with the codeburn parity plan — they are correctness fixes, not features.

| # | Finding | Suggested change |
|--|--|--|
| 1 | A (three disagreeing branch paths) | Make `live-rollups` and `project-usage` read from `vibedeck_session_branch_windows`, same as `branch-usage`. Single source of truth. |
| 2 | B (time-prorated windows) | Rebuild `vibedeck_session_branch_windows` from `vibedeck_session_events` summed by branch, not by elapsed-time math. The event-level branch is already there. |
| 3 | C (1h cache TTL) | In `normalizeClaudeUsage`, extract `usage.cache_creation?.ephemeral_5m_input_tokens` and `…ephemeral_1h_input_tokens`. Add a `cache_creation_1h_input_tokens` column; price at the 1h rate. Backfill from raw JSONL gated behind a flag. |
| 4 | D (web search) | Capture `usage.server_tool_use.web_search_requests` and price at Anthropic's documented rate. |
| 5 | E (fuzzy mis-pricing) | Add curated *line* fallbacks to `curated-overrides.json`: `claude-opus-* → latest known opus`, `gpt-5-* → gpt-5`, `gemini-2.5-* → gemini-2.5-pro`. Floor against fuzzy substring matches. |
| 6 | F (negative delta swallow) | Log a warning + counter when a negative-delta update is dropped. Aggregate count in a single warning per sync run. |
| 7 | G (total_tokens vs bucket-sum) | Pick one source of truth per row. Recommend: drop `delta_tokens` storage and compute `total_tokens` from bucket sum. Document the convention. |
| 8 | H (two write paths) | After (G) lands, delete the per-update token summing in `writer.js:189–201`. Session totals come only from `recomputeSessionLedger`. |
| 9 | I (half-hour granularity) | Keep 30-min buckets for rollups but add a `vibedeck_session_turn_events` table at full-resolution before Phase B of the parity plan starts — Phase B will need it anyway. |

---

## 4a. Finding J — Sticky-null repo attribution hides 88% of sessions
**Severity:** high. **Confidence:** confirmed against live data on this machine.

### What the data says

A fresh-install run of `vibedeck sync` on this machine produced:

```
Total sessions:     863
NULL repo_root:     757 (88%)
NULL branch:        758 (88%)
```

Per provider:

| Provider | Sessions | NULL repo_root | NULL cwd |
|--|--|--|--|
| codex | 524 | 435 (83%) | 0 |
| cursor | 242 | 242 (100%) | 242 |
| claude | 95 | 78 (82%) | 0 |
| gemini | 2 | 2 (100%) | 2 |

The 100% null rates for `cursor` and `gemini` are by design — those extractors set `cwd: null` (`extractors.js:143,159`-style for cursor; gemini batches don't carry cwd). The 82–83% rates for `codex` and `claude` are **not** by design — these providers do carry `cwd`, yet ~5 in 6 sessions end up with no resolved repo.

### Why the dashboard looks empty after first sync

Every project/branch consumer hides null-repo rows:

- `branch-usage.js:162` — `.filter((row) => repoRootExists(row.repo_root))`
- `project-usage.js:407` — `WHERE repo_root IS NOT NULL AND repo_root <> ''`
- live SSE `byBranch` groups by `branch`, which is null when repo isn't resolved

Combined effect: on a fresh install, 88% of historical sessions are filtered out before they hit any user-facing surface. Branches page, project page, live view — all show a fraction of reality. The data isn't missing from the DB; it's hidden by the filters.

### Two distinct sub-causes

**Sub-cause 1 — `cwd` no longer exists on disk** (`repo-resolver.js:42–44`):
```js
if (e.code === 'ENOENT' || e.code === 'ENOTDIR') {
  return nullResult('cwd_missing');
}
```
The user deleted the project after running sessions there. The Claude/Codex JSONLs still reference the old cwd, but `fs.realpathSync` can't find it. Sampling this machine: `/Users/vasuyadav/Downloads/cursor-sm`, `/Users/vasuyadav/Downloads/CodexBar`, `/Users/vasuyadav/Downloads/OSS/steel/browser`, `/Users/vasuyadav/Downloads/Projects/TokenTracker` — all referenced by sessions, all missing today.

**Sub-cause 2 — `git init` happened after the session, or never** (the user's own hypothesis).

Verified by this row pair in the data:
```
cwd=/Users/vasuyadav/Downloads/Projects/VibeDeck  repo_root=NULL                                                  (10 sessions)
cwd=/Users/vasuyadav/Downloads/Projects/VibeDeck  repo_root=/Users/vasuyadav/Downloads/Projects/VibeDeck          (1 session)
```

Same directory. Same cwd. Eleven sessions. Ten resolved to null; one resolved correctly. The directory has `.git` today. The most plausible explanation: those 10 sessions ran when the directory was either not yet a git repo or before the `.git` directory was in its current shape; the 11th ran after.

### The sticky-null mechanism

Even when conditions later improve (`git init` happens, deleted dir gets restored), historical sessions stay null forever. Two reasons:

**Reason 1 — `updateRepoMeta` only writes on success** (`pipeline.js:127–138`):
```js
function updateRepoMeta(db, { provider, session_id, repo } = {}) {
  if (!repo || typeof repo !== 'object') return;
  if (!isNonEmptyString(repo.repo_root)) return;
  // ... only reaches the UPDATE if repo_root is set
}
```
A null resolution is a silent no-op, not a marker. There's no `last_resolution_attempt_at`, no `resolution_status` column. Just absent data.

**Reason 2 — no re-resolution job.** Once `processSessionEvent` has run for a session, the session is ledgered and complete. No further events arrive for a terminated session, so the resolver is never re-invoked. The user can `git init` the directory tomorrow and the dashboard will still show those old sessions as unattributed.

### Consequence for the parity plan

This bug is upstream of the audit findings in §2. Even if Findings A and B (branch attribution) are fixed perfectly, **the fix only helps the 12% of sessions that resolved a repo in the first place**. The other 88% are unattributable at any layer.

It's also worse on first-time users than on long-term users. A long-term user has a growing tail of resolved-recent sessions diluting the legacy nulls. A new install with months of pre-existing JSONLs sees the worst-case ratio immediately — exactly what the user observed.

### Remediation

Two changes, both modest:

1. **Periodic re-resolution sweep.** New scheduled task (or run during every `sync`): for every session row where `repo_root IS NULL` and `cwd IS NOT NULL` and `fs.existsSync(cwd) && fs.existsSync(path.join(cwd,'.git'))`, re-run `resolveRepo(cwd)`. If it now resolves, update the row + recompute branch + rebuild that session's branch_windows. Cheap (88% of 863 sessions = ~760 to retry on this machine, mostly cache hits), idempotent.
2. **Stop hiding null-repo rows in default views.** Bucket them under a synthetic project key like `unattributed:${basename(cwd)}` so they show up. Add a "Resolve repo" affordance per-row so the user can manually point a session at a project (this also gives codeburn parity for projects that aren't git repos at all). Update `branch-usage.js`, `project-usage.js`, `live-rollups.js` filters.

The fix order matters: re-resolution sweep first, then UI changes. That way the user sees the 12%→~50%+ jump from re-resolution before having to look at unattributed buckets.

---

## 5. Honest summary

Your itch was right. There are real problems:

- **Branch attribution is the worst offender.** Three views, three answers, all of them missing the right answer that the data already supports. This affects the marquee "project → branch → session" pitch directly.
- **Two cost buckets are silently underbilled** (Claude 1h cache, web search). Whether this matters in dollars depends on the user, but the code is wrong.
- **The pricing matcher has no defensive floor.** Today's models are fine. Tomorrow's depend on whether you ship a snapshot update before users start hitting them.
- **The data plumbing has one redundant path** that's harmless today and a refactoring trap tomorrow.

What you got right is the hard, careful work at the bottom: token normalization per provider, dedup, idempotent migrations, documented prior bugs. That's the foundation. The bugs above are all *above* that foundation — fixable without rewriting any of the careful work.

This audit is the proof. Pick the order from §4.

---

## 6. Per-provider capture matrix

For each provider VibeDeck wires up (per `extractors.js` and the parser dispatch in `rollout.js`), this section lists the billing buckets the provider actually has, whether VibeDeck captures each one, and whether it's priced correctly. Sourced from the parsers, not from documentation guesses. Where the column says "not captured," that's a `grep` negative — the field name does not appear anywhere in `src/`.

**Legend:**
- ✓ — captured and priced correctly
- ⚠ — captured but priced incorrectly or with caveats
- ✗ — not captured at all (silent zero)
- N/A — provider doesn't expose this bucket

---

### 6.1 Claude Code & Claude Desktop  (`provider: claude`)

Parser: `rollout.js:973` (`parseClaudeFile`). Normalizer: `rollout.js:2487` (`normalizeClaudeUsage`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input_tokens (non-cached) | ✓ | ✓ | `rollout.js:2488`, `pricing/index.js:115` |
| output_tokens | ✓ | ✓ | `rollout.js:2489`, `pricing/index.js:116` |
| cache_read_input_tokens | ✓ | ✓ | `rollout.js:2491`, priced at `cache_read` rate |
| cache_creation 5-minute | ✓ | ✓ | flat `cache_creation_input_tokens` priced at `cache_write` (=5m) rate |
| cache_creation 1-hour | ✗ | ✗ | **Finding C.** No code reads `cache_creation.ephemeral_1h_input_tokens`. Under-bills by ~60% of any 1h cache writes |
| server_tool_use.web_search_requests | ✗ | ✗ | **Finding D.** $10/1k unbilled |
| Fast-mode multiplier | ✗ | ⚠ | codeburn applies a fast-mode multiplier for Claude; we don't. Affects users on `claude-opus-4-7` with fast tier |

---

### 6.2 Codex / OpenAI (`provider: codex`, `every-code`)

Parser: `rollout.js:811` (`parseRolloutFile`). Delta-derivation: `rollout.js:2416` (`pickDelta`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input_tokens (uncached prompt) | ✓ | ✓ | `rollout.js:2483` subtracts cached from input. Documented prior bug fix. |
| cached_input_tokens | ✓ | ✓ | Priced at `cache_read` rate |
| output_tokens | ✓ | ✓ | |
| reasoning_output_tokens | ✓ | ✓ | Folded into output for cost (`pricing/index.js:110`). Correct for Codex's billing model. |
| Reasoning effort tiers (`-low`/`-medium`/`-high`/`-fast`) | ⚠ | ✗ | **Matcher strips the suffix** (`matcher.js:12–22`) and prices all at the base rate. If LiteLLM has separate entries for `gpt-5-codex-high`, you'd be pricing high as base. |
| Responses API `web_search` tool | ✗ | ✗ | Same blind spot as Claude. No `web_search_call` capture. |
| Cumulative-vs-delta confusion | ✓ | ✓ | Historical bug fixed via `migrateRolloutCumulativeDeltaBuckets` (`sync.js:1449`). |
| Reasoning summary tokens | partial | ✓ | Folded into output. No separate visibility but pricing is right. |

---

### 6.3 Gemini CLI (`provider: gemini`)

Parser: `rollout.js:1122` (`parseGeminiFile`). Diff: `rollout.js:2370` (`diffGeminiTotals`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input_tokens | ✓ | ✓ | |
| output_tokens | ✓ | ✓ | |
| cached_content_tokens | ✓ | ✓ | Mapped to `cached_input_tokens`, priced at `cache_read` rate |
| thinking / thoughts tokens | ✓ | ⚠ | Captured as `reasoning_output_tokens`, priced at output rate. Happens to be the same rate for current Gemini 2.5 models, so **correct by coincidence**, not by design. Wrong if Google ever splits the price. |
| Google Search grounding tool | ✗ | ✗ | $35/1k grounded queries above free tier — unbilled. Equivalent of Finding D for Gemini. |
| cwd capture | ✗ | N/A | Gemini batches do not carry cwd → 100% null repo_root for Gemini sessions on this machine (2/2). Finding J. |

---

### 6.4 Cursor (`provider: cursor`)

Parsers: `rollout.js:2631` (`parseOpencodeDbIncremental` is OpenCode), `rollout.js:2810` (`parseCursorApiIncremental`). Reads Cursor's SQLite + API.

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Per-model token counts | ✓ | ⚠ | Captured from Cursor's DB. |
| "Auto" mode model identity | N/A | ⚠ | Cursor hides which model Auto used. Codeburn labels this "Auto (Sonnet est.)". VibeDeck silently prices at whatever the row's model field says — if Auto, the dollar number is fiction. **Known limitation, not a bug, but not labeled in the dashboard.** |
| cwd | ✗ | N/A | `extractors.js:143` sets `cwd: null` for cursor. **100% of cursor sessions have null repo_root** on this machine (242/242). Finding J. |
| Pro/Ultra subscription quota | N/A | ⚠ | Cursor's pricing is request-quota, not token-cost. The dollar number shown is API-rate equivalent, not what the user actually paid. Should be labeled. |
| Cursor's per-call tool usage | ✗ | N/A | Cursor doesn't log tool calls — readme of codeburn confirms. Equivalent to the activity-breakdown gap in the codeburn parity plan. |

---

### 6.5 OpenCode (`provider: opencode`)

Parser: `rollout.js:464` (`parseOpencodeIncremental`), `rollout.js:1241` (`parseOpencodeMessageFile`), `rollout.js:2631` (SQLite).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input/output/cache tokens | ✓ | ✓ | Standard buckets. |
| Per-model identity | ✓ | ✓ | OpenCode logs the actual model. |
| Tool calls | partial | N/A | `rollout.js:3560` checks for `c.kind === "toolUse"` — code knows about toolUse, but extracted into character counts (`rollout.js:3654`), not into tool-call rows. No per-tool tally. |
| cwd | ✓ | ✓ | |

---

### 6.6 OpenClaw (`provider: openclaw`)

Parser: `rollout.js:608`, `rollout.js:697`.

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input/output/cache tokens | ✓ | ✓ | `rollout.js:749–761` constructs full delta. total_tokens re-derived as sum. |
| Model identity | ✓ | ✓ | Falls back to `DEFAULT_MODEL` if absent. |
| cwd | ✗ | N/A | `rollout.js:785–786` — "Project-level OpenClaw attribution is not supported yet (no stable cwd info)." Documented as a known gap. |

---

### 6.7 Kiro (`provider: kiro`)

Two parsers: `rollout.js:3098` (DB-based), `rollout.js:3822` (`parseKiroCliIncremental`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Token counts | ⚠ | ⚠ | Codeburn parity: Kiro stores conversations as `.chat` JSON, token counts are **estimated from content length**. Same here. |
| Model identity | ⚠ | ⚠ | Underlying model not exposed. Labeled `kiro-auto`, priced at Sonnet rate via `curated-overrides.json`. **Known fake-precision** — exact dollar figures are estimates, should be labeled in UI. |
| cache_read | partial | ⚠ | `rollout.js:4234` reads `cache_read_input_tokens ?? cached_input_tokens` — field aliasing handled, but only if Kiro logs it. |

---

### 6.8 Copilot (`provider: copilot`)

Parser: `rollout.js:5684` (`parseCopilotIncremental`). Reads OTEL traces.

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Token counts (per model) | ✓ | ⚠ | Captured from OTEL traces. Model inferred from tool call ID prefixes. |
| **Premium request model** | ✗ | ✗ | **Largest gap.** Copilot's current pricing is per-"premium-request", not per-token. A premium request can be 0.25× to 1.0× of a quota unit depending on model. Token-equivalent cost shown is fiction for Copilot Pro/Pro+ users. Codeburn has the same blind spot — neither tool models the actual billing. |
| cwd | partial | ⚠ | `extractors.js:227` sets cwd to null for copilot. VS Code's `workspaceStorage` path does identify the project but it's not parsed into cwd. Affected by Finding J. |

---

### 6.9 Kimi (`provider: kimi`)

Parser: `rollout.js:4336` (`parseKimiIncremental`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Token counts | ✓ | ⚠ | Captured. Pricing depends on Kimi K2 entries in snapshot — likely fuzzy-matched via Finding E. |
| Model identity | ✓ | ⚠ | If model name doesn't exact-match the snapshot, fuzzy substring will price as closest match. |
| cwd | ✗ | N/A | `extractors.js:241` sets cwd to null. Finding J applies. |

---

### 6.10 OMP / Oh My Pi (`provider: omp`)

Parser: `rollout.js:4869` (`parseOmpIncremental`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Token counts | ✓ | ⚠ | Captured into standard buckets. |
| Model identity | ⚠ | ⚠ | Subject to fuzzy-match (Finding E). |
| cwd | ✗ | N/A | `extractors.js:255` sets cwd to null. Finding J applies. |

---

### 6.11 Codebuddy (`provider: codebuddy`)

Parser: `rollout.js:4544` (`parseCodebuddyIncremental`). Format documented at `rollout.js:4490–4496`:

```
input_tokens               = prompt_tokens - prompt_tokens_details.cached_tokens
cached_input_tokens        = prompt_tokens_details.cached_tokens
output_tokens              = completion_tokens
reasoning_output_tokens    = prompt_tokens_details.reasoning_tokens || 0
```

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| input/cached/output | ✓ | ✓ | Explicit conversion comment. Mirrors OpenAI format. |
| reasoning_output_tokens | ✓ | ⚠ | Captured but **not folded into output** like Codex is (`pricing/index.js:110` only folds for `codex` and `every-code`). If Codebuddy follows OpenAI's "reasoning is already in output" billing, this **double-charges reasoning**. Unverified; depends on Codebuddy's billing convention. |
| cache_creation | ⚠ | ⚠ | Not captured separately. If Codebuddy charges for cache writes distinctly, missed. |
| Tool calls | ✗ | N/A | Same gap as everywhere else. |

---

### 6.12 Hermes (`provider: hermes`)

Parser: `rollout.js:3283` (`parseHermesIncremental`).

| Billable bucket | Captured? | Priced correctly? | Evidence |
|--|--|--|--|
| Token counts | ✓ | ⚠ | Standard buckets. |
| Model identity | ⚠ | ⚠ | Fuzzy-match risk. |
| cwd | ✗ | N/A | `extractors.js` Hermes provider — cwd handling not enforced. |

---

### 6.13 every-code (`provider: every-code`)

Shares Codex's parser (`rollout.js:811`). Same findings as §6.2. Sessions are split out by source name only; all of §6.2 applies including the cached-inside-input fix and the cumulative-delta migration retraction.

---

## 7. Provider-matrix summary

What this matrix shows that the earlier findings didn't quite spell out:

1. **`cwd` capture is the dominant attribution killer.** Six of thirteen providers set `cwd: null` at the extractor — cursor, gemini, copilot, kimi, omp, hermes (partial). Plus openclaw which documents it. That's roughly half your providers structurally unable to be project-attributed today. Finding J's 88% null-repo rate is partially a consequence of this.

2. **Web search is missing across the board, not just Claude.** Claude's `server_tool_use`, OpenAI's `web_search_call`, Gemini's grounding — three different field names, three independent captures needed. Finding D is one bug name, three implementations.

3. **Reasoning-effort pricing only matters for Codex today**, but the matcher's `-high/-low/-fast` suffix-strip is a foot-gun for any future provider that ships effort tiers with distinct prices. Finding E generalizes here.

4. **Two providers ship known-fake precision: Cursor Auto and Kiro.** Both estimate model+tokens, neither is labeled in the dashboard. Codeburn at least prints "(Sonnet est.)" — we should too.

5. **Copilot's premium-request model is unmodeled.** This is the largest single dollar discrepancy for Copilot Pro/Pro+ users. Token-equivalent cost is not what they pay.

6. **Codebuddy's reasoning token folding is unverified.** Code captures reasoning_output_tokens but pricing only folds it for codex/every-code (`pricing/index.js:110`). If Codebuddy follows OpenAI's convention (reasoning already in output), we double-charge. One-line fix once verified.

7. **OpenCode and OpenClaw both have decent token capture but no tool-call extraction.** OpenCode at least sees `toolUse` events (`rollout.js:3560`) but discards them as character counts. Closest providers to being ready for the codeburn parity plan's Phase B.

The provider-specific items above are not all severity-high. They split roughly:

| Severity | Items |
|--|--|
| High (real money missing) | Web search across Claude/OpenAI/Gemini (D); Copilot premium-request unmodeled; Codebuddy potential reasoning double-charge |
| Medium (correctness drift) | Claude fast-mode multiplier; Codex reasoning-effort suffix strip; cache_creation_1h (already C) |
| Low (label/UX) | Cursor Auto mode silent; Kiro estimation silent |
| Structural (covered by other findings) | Six providers can't attribute project (J); fuzzy pricing for non-snapshot models (E) |

The fix order from §4 still holds. Add this matrix as the "did we miss anything per-provider" checklist before declaring any of those fixes done.
