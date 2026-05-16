# Codeburn parity — gap & phased execution plan

Audit reference: comparison of VibeDeck backend vs `codeburn/` (vendored at repo root). Scope excludes Entire, GitHub sync, and local skill surfaces — focus is on live tracking, project tracking, token usage, cost, and performance parity for the "where did my tokens go" pitch.

---

## 1. What we already match or beat

- **Live tracking** — SSE + chokidar HEAD watcher + live-bus pipeline (codeburn is poll-only at 30s).
- **Project tracking** — branch/worktree/workstream attribution via `repo-resolver`, `branch-windows`, `head-history` (codeburn is flat per-folder).
- **Token & cost engine** — LiteLLM seed snapshot + curated overrides + matcher; SQLite-backed canonical summary.
- **Persistence & query performance** — own SQLite (WAL, migrations, event ledger, bucket facts); queries are indexed SQL, not file re-parses.

## 2. What's missing vs codeburn

| # | Feature | One-line gap |
|--|--|--|
| 1 | Activity / tool / MCP / shell breakdown | Pipeline does not record per-turn tool calls, MCP server tags, or bash commands |
| 2 | Task classifier (13 deterministic categories) | No classification layer at all |
| 3 | One-shot rate | No retry detection on edit turns |
| 4 | `models` report with `--by-task / --top / --provider / --format markdown` | No pivot view over the model table |
| 5 | CSV / JSON export (today + 7d + 30d in one command) | No single export entrypoint |
| 6 | Compare (side-by-side model comparison) | UI panel missing |
| 7 | Context-budget tracking | No per-turn context-window accumulator |
| 8 | Plan-usage (Claude plan limit awareness) | No plan-tier lookup or cumulative tally |
| 9 | Yield (productive vs reverted/abandoned spend) | Needs edit→revert correlation; partial inputs only |
| 10 | Optimize (re-read detection, low Read:Edit, bash cap, unused MCP, ghost agents) | Five sub-scanners, none implemented |
| 11 | Provider coverage breadth | Missing: pi, ibm-bob, droid, roo-code, kilo-code, qwen, goose, antigravity, crush, cursor-agent |

*Not a gap: TUI (we are CLI + web dashboard by design), menubar / widgets (already shipped in `VibeDeckMac/` with `EmbeddedServer` + `VibeDeckWidget`).*

## 3. Root blocker

Items 1, 2, 3, 4, 9, 10 all read from the same data layer that **does not exist yet**: per-turn tool calls. `extractors.js` today captures `session_id / model / tokens / cwd` and stops. Without a `session_tool_calls` (or per-turn) table, no downstream analytics can be built.

Therefore the sequencing rule is: **easy reporting/export work first (no schema change), then the capture layer, then the analytics that depend on capture.**

---

## 4. Phased execution

Each phase is self-contained, independently shippable, and does not break the current ingest contract until Phase B. Land in order — every later phase assumes the earlier ones are merged.

### Phase A — Export & reports over existing data
*No schema change. No pipeline change. Pure read-side work over what we already store.*

- CSV + JSON export command that emits today / 7d / 30d windows in one call.
- `models` pivot report with `--by-task` (stub task=unknown until Phase C), `--top`, `--provider`, `--format markdown|json|csv`.
- Provider filter flag (`--provider <name>`) wired across existing report endpoints.

**Why first:** zero risk to the live pipeline, gives us a stable formatter layer that Phases C–F will reuse, and lets us validate output shapes against codeburn before deeper changes.

**Done when:** `vibedeck export -f json|csv` and `vibedeck models --top 10 --format markdown` produce parity output to codeburn for token + cost columns.

---

### Phase B — Tool-call capture (the root unlock)
*Schema migration + extractor extension. This is the only phase that changes the ingest contract.*

- New migration: `session_turns(turn_id, session_id, ts, edit_count, retry_count, category nullable)` and `session_tool_calls(turn_id, tool_name, mcp_server nullable, bash_cmd nullable, is_retry)`.
- Extend `extractors.js` to emit tool-use blocks per turn for all currently-supported providers (claude, codex, gemini, cursor, opencode, openclaw, every-code, kiro, hermes, copilot, kimi, omp, codebuddy).
- `writer.js` fans tool blocks into the new tables; existing rollups untouched.
- Backfill script for historical sessions already on disk (idempotent, gated behind a flag).

**Why this order:** schema lives in its own migration; old code paths keep working because the new tables are additive. Live rollups and SSE keep emitting unchanged events. Backfill is opt-in so users can defer cost.

**Done when:** new tables populate in real time as sessions arrive, existing dashboard renders identically, backfill is reversible.

---

### Phase C — Classifier, one-shot rate, activity & tool breakdown
*Pure read-side analytics over Phase B's tables. No further schema work.*

- Port codeburn's `classifier.ts` (13 deterministic categories) as a pure function over a turn row.
- Populate `session_turns.category` on insert (and via backfill).
- One-shot rate aggregation: % of edit turns with `retry_count == 0` per category.
- Activity breakdown view: per-session and per-project tallies of core tools, MCP servers (grouped by server, not tool), and bash commands.
- Wire all of the above into the existing dashboard panels and the Phase A formatters (`models --by-task` now returns real categories).

**Why this order:** classifier is a pure function, easy to test in isolation; one-shot is a one-line aggregation once retries are tracked; activity breakdown is the highest-value user-facing surface and unlocks the "compare" view in Phase D.

**Done when:** dashboard shows codeburn-equivalent activity / core-tools / MCP / bash panels and the `models --by-task` output is real.

---

### Phase D — Compare, context-budget, plan-usage
*Aggregation + UI on top of Phase C. No new ingest data needed.*

- Compare view: side-by-side model comparison panel in the web dashboard (we already have React + SSE, no TUI rebuild needed).
- Context-budget: per-turn running context-window estimate from existing token counts; surface as a session-level series.
- Plan-usage: lookup table for Claude plan tiers + cumulative tally against current window; warning thresholds.

**Why grouped:** all three are read-side analytics with no new ingest dependency, all three are surfaced as new dashboard panels, and they share the same query/formatter scaffolding from Phase A.

**Done when:** three new dashboard panels render real data and the same data is exposed via the existing JSON API for headless use.

---

### Phase E — Optimize & Yield (waste detection)
*Heaviest analytics work. Cross-session correlation. Read-only over Phases B + C.*

- Optimize sub-scanners (each independently feature-flagged):
  - Re-read detection — same file, same content hash, repeated reads across sessions (needs a file-content index in cache; new table `file_read_index` is acceptable, isolated to this feature).
  - Low Read:Edit ratio per session.
  - Uncapped `BASH_MAX_OUTPUT_LENGTH` scan of `~/.claude/settings*.json`.
  - Unused MCP servers — installed in config but never invoked in tool calls.
  - Ghost agents / skills / slash commands defined under `~/.claude/` but never invoked.
- Yield: correlate edit turns with `head-history` revert/abandon signals to bucket spend into productive vs reverted vs abandoned.

**Why last among analytics:** Optimize is five scanners that share little code; landing them behind flags one at a time keeps risk low. Yield needs `head-history` correlation, which is mature but non-trivial.

**Done when:** `vibedeck optimize` returns codeburn-equivalent findings and `vibedeck yield` reports productive/reverted/abandoned split.

---

### Phase F — Provider breadth
*Distribution / surface area. Independent of analytics phases.*

- Add provider extractors for codeburn-only providers: pi, ibm-bob, droid, roo-code, kilo-code, qwen, goose, antigravity, crush, cursor-agent (each is one extractor file following the Phase B contract).
- Confirm the existing `VibeDeckMac/` menubar + `VibeDeckWidget` surface picks up the new providers automatically via `EmbeddedServer` — no Swift changes expected, just a smoke pass.

**Why last:** extra providers add surface but don't unblock any analytic; safer once the capture contract from Phase B is stable.

**Done when:** provider coverage matches codeburn's supported list and the Mac menubar/widget reflects the new providers without code changes.

---

## 5. Flow guarantees (don't break the current app)

- **Phase A** is read-only and adds new commands/flags only — zero pipeline risk.
- **Phase B** is additive at the schema level (new tables, no column changes on existing ones) and additive at the extractor level (new event types, existing events unchanged). Old rollups keep computing from the same inputs.
- **Phases C–E** are read-side on the new tables; if any analytic regresses, the existing dashboard panels are unaffected.
- **Phase F** plugs into the stable API surface from Phases A–C.
- Every phase ships behind a feature flag where it touches the dashboard, so a partially-merged phase never blocks a release.

## 6. Out of scope (per audit constraints)

Entire integration, GitHub sync, local skill management. The capture and analytics layers built here are agnostic to those surfaces and must not pull in their dependencies.

---

## 7. Vibe-coding vulnerabilities per phase

Risk catalogue for executing each phase with Claude Code / Codex. These are the failure modes an LLM is statistically likely to introduce, plus the parts that look easy in autocomplete but will break the live system if shipped without review. Every phase below assumes the LLM has `codeburn/` open as reference — even with that, the items below are not free.

### Phase A — Export + models pivot
**Surface area:** read-side only, lowest risk phase.

- **Number formatting drift.** LLM will silently default to its own currency/locale formatter instead of reusing `canonical-cost-summary` formatters. Output will look right but totals won't reconcile with the dashboard.
- **Date-range off-by-one.** "Today / 7d / 30d" boundaries differ between codeburn (UTC midnight) and VibeDeck (local midnight). LLM will copy codeburn's logic verbatim and rows will shift by a day.
- **Column header churn.** Markdown output that doesn't match codeburn's column order will fail any side-by-side parity test the user runs later.
- **Mitigation:** snapshot-test the JSON output against a frozen fixture before merging.

### Phase B — Tool-call capture (highest risk in the whole plan)
**Surface area:** schema + 13 provider extractors + writer + backfill. Every byte that flows in production passes through this code.

- **Silent ingest regression.** Adding new event types is "additive" only if the existing `writer.js` ignores unknown event kinds. LLM will assume that's true and not verify. If the writer asserts on event shape, the entire pipeline dies on first new event.
- **Provider field-name hallucination.** Around provider #7 the LLM starts mixing field names across providers (e.g. using Claude's `tool_use_id` shape in the Codex extractor). The session inserts succeed, the tool-call rows reference nothing, downstream analytics return empty tables and nobody notices for a week.
- **Token double-counting.** If the new tool-call emitter also re-emits usage that the existing `update` event already counted, totals inflate. This is the single most common LLM regression in instrumentation work and the hardest to spot — the dashboard just slowly drifts ~5-15% high.
- **Migration that "looks reversible."** LLM-generated migrations often include `DROP TABLE IF EXISTS` in the rollback but don't preserve the data they replaced. Treat any generated `down` migration as untrusted.
- **Backfill non-idempotency.** LLM will write a backfill that's idempotent for the happy path but doubles rows if interrupted mid-run. Symptom: running backfill twice silently doubles your historical tool-call counts.
- **Backfill scope creep.** LLM tends to backfill *everything in `~/.claude/projects/`* without honoring a date cap or session-size cap. On a heavy user this runs for hours and locks the DB.
- **SSE event-name collision.** LLM may pick a `tool_call` event name that an existing client subscribes to under a different schema. Verify event-name namespace before emitting.
- **Mitigation:** ship one provider at a time, run the daemon against a real `.claude/projects/` for 24h between merges, snapshot rolling totals before/after, hand-write the migration `down`.

### Phase C — Classifier, one-shot, breakdowns
**Surface area:** pure functions over Phase B's tables.

- **Classifier regex drift.** LLM will "improve" codeburn's regexes during the port (broader matches, friendlier names). Categories no longer match codeburn parity and your one-shot rates diverge from the reference.
- **Retry over-counting.** `countRetries` in codeburn has subtle rules about what counts as a retry vs a follow-up edit. LLM will simplify this to "consecutive edit turns" and the one-shot rate will read systematically too low.
- **Category bucketing on the wrong key.** Easy LLM error: bucketing by `tool_name` when codeburn buckets by `tool_category`, leading to MCP tools showing up under core tools.
- **Aggregation off the indexed column.** LLM may write `GROUP BY session_id` on a column that's not indexed in your schema. Query is correct, dashboard takes 8s.
- **Mitigation:** keep classifier verbatim from codeburn (don't let the LLM "clean it up"), test one-shot rate against a known session.

### Phase D — Compare, context-budget, plan-usage
**Surface area:** new UI panels + small lookup tables.

- **Plan limit table goes stale.** LLM writes plan-tier limits as constants in the source. Anthropic changes them, you don't notice for a quarter.
- **Context-budget double-counts cache reads.** This is *the* footgun in context-window math. Cache reads count toward the window once, not twice. LLM gets this wrong about 40% of the time in my experience.
- **Compare panel doesn't honor active project filter.** LLM will hook it to the global model totals and ignore whatever scope the user has selected in the dashboard.
- **N+1 in compare view.** LLM will write the panel to fetch per-model stats one at a time via the existing API instead of a batched endpoint. Looks fine in dev, brown-outs on a heavy user.
- **Mitigation:** make plan limits a config file with a fetch date, write the context-budget math against a hand-computed fixture, audit the compare panel's network tab.

### Phase E — Optimize + Yield (highest taste-risk in the plan)
**Surface area:** five scanners + cross-table correlation + remediation strings.

- **Re-read detection false positives.** LLM will flag legitimate re-reads (e.g. file changed between reads, or read in different contexts) as waste. Single largest source of user complaints with `optimize`.
- **File-content hashing on full file bytes.** LLM hashes whole file bodies and stores them — disk usage explodes on monorepos. Codeburn hashes truncated reads; LLM will not.
- **Read:Edit ratio computed per session, not per file.** Easy LLM misread of the codeburn logic. Output becomes meaningless because one big read session drowns out per-file signal.
- **Bash output cap scanner reading user's settings without permission boundaries.** LLM will happily glob `~/.claude/**/*.json`. Some of those files contain API keys. Restrict to the specific known settings paths.
- **Ghost agent scanner reports your own unused-but-loaded skills as ghosts.** Codeburn distinguishes "defined but never invoked" from "loaded but not called this period". LLM will conflate them.
- **Unused-MCP scanner racing config reload.** If the user adds an MCP server mid-session, scanner flags it as unused. Add a grace window.
- **Yield's "abandoned" classification is a value judgment.** LLM will write a threshold like "no edits within 5 minutes = abandoned" and bake it in. Make it configurable or it will be wrong for everyone.
- **Remediation strings written in LLM-voice.** The product value of `optimize` is the suggested fix wording. Generic LLM output ("Consider reducing your usage of...") reads like a linter, not a product. Write these by hand or with explicit voice references.
- **Mitigation:** land each scanner behind a flag, dogfood for a week before enabling by default, hand-write remediation copy.

### Phase F — Provider breadth
**Surface area:** 10 new extractor files conforming to Phase B's contract.

- **Path detection wrong on Linux/Windows.** Each codeburn provider has subtle XDG/AppData path handling. LLM will copy macOS paths and miss the platform branches.
- **SQLite read holding a write lock.** For Cursor/OpenCode providers, LLM may open the DB without read-only mode. Concurrent writes from the host app fail intermittently.
- **Token field semantics differ per provider.** Some providers report cumulative usage per turn, some report deltas. LLM will assume one convention across all 10 and inflate or deflate totals.
- **Cache write tier (5m vs 1h) not split.** Only matters for providers that surface this. LLM will collapse to a single bucket and Claude cache pricing is wrong again.
- **Missing-model fallback that silently prices at $0.** Codeburn has explicit hardcoded fallbacks per Claude/GPT model. LLM will skip these because "the matcher handles it" — but new models slip through the matcher.
- **Mitigation:** port one provider, validate token totals against the source tool's own UI, then template the rest.

### Cross-phase systemic risks

- **LLM "refactors while it ports."** Asking for a port of `classifier.ts` will often produce a rewritten classifier with renamed functions and "improvements." Parity tests then fail and you can't tell if it's a port bug or a deliberate change. Instruct the LLM explicitly: copy verbatim, no improvements.
- **Test files that just assert what the code does.** LLM-generated tests for new ingest code will frequently snapshot whatever the code produced on the first run, including bugs. Tests pass forever even as totals drift.
- **Forgotten feature flag.** Easy to ask the LLM to "land it behind a flag" and have the flag exist but every call site check it inconsistently. Grep for the flag after every phase.
- **Dashboard reads from an old materialized view.** If Phase C populates new aggregates but the dashboard query still reads from the old rollup, you'll think the feature is broken when it's actually a stale read path.
- **Lost provider in the migration.** Adding `session_tool_calls` for 13 providers, missing one. That provider's sessions silently get classified as "uncategorized" forever.
- **Cache invalidation skipped.** Existing `daily-cache`-style rollups need to be invalidated when tool-call data lands; LLM won't think to bump the cache version unless told.

### How to harden the run

1. **Snapshot rolling totals (cost, calls, sessions per day) before each phase merges.** Diff after. Any unexplained delta > 1% is a regression.
2. **One provider per PR in Phase B and Phase F.** Don't let the LLM batch them.
3. **Refuse LLM-generated migration `down` paths.** Hand-write reversals or accept that they're forward-only.
4. **Pin codeburn's commit hash in the audit file** so "matches codeburn" stays a defined target.
5. **Run the daemon against a real `.claude/projects/` for 24h between phases.** Most regressions only show up under load.
6. **Read every LLM-written regex.** Classifier and optimize live or die on these and they're the easiest place for silent drift.

---

## 8. Copy-paste vs adapt map

Concrete file-by-file guide for execution. "Copy-paste" means lift verbatim, change imports only. "Adapt" means port the logic, rewrite the shape. "Reference only" means look but don't copy — the right answer in our stack is different.

### Copy-paste (verbatim, change imports only)

| Codeburn file | Lands in | Why it ports clean |
|--|--|--|
| `src/classifier.ts` | new `src/lib/sessions/classifier.js` | Pure function over a turn object. No I/O, no DB, no provider coupling. The 13 regexes + tool sets are the product — keep them byte-identical. |
| `src/bash-utils.ts` (`extractBashCommands`) | `src/lib/sessions/bash-utils.js` | Pure string parsing. No deps. |
| `src/model-efficiency.ts` | extend `src/lib/usage-read-models.js` | Pure aggregation math over already-computed model stats. |
| `src/format.ts` | extend `src/lib/cli-ui.js` | Number / cost / duration formatters. Stateless. |
| `src/types.ts` (type *shapes* only) | typedef headers in our JS | Contract reference even though we're JS. |
| `src/plans.ts` (Claude plan tier table) | new `src/lib/pricing/plans.js` | Constants table. Lift it. |

These six are ~600 LOC of free code.

### Adapt (port the logic, rewrite the shape)

| Codeburn file | Why it needs adaptation | What changes |
|--|--|--|
| `src/parser.ts` | Emits `ParsedApiCall` / `SessionSummary` objects; we emit `start`/`update`/`end` events into a writer pipeline. | Keep extraction rules (JSONL fields → tool/MCP/bash lists). Rewrite emission as events through `extractors.js` + `writer.js`. In-memory aggregation → SQL aggregation. |
| `src/providers/*.ts` (10 missing providers) | Each returns parsed-call arrays; ours emit event tuples. | Steal path detection + JSONL/SQLite reading; rewrite output to our extractor contract. One file per PR. |
| `src/parser.ts` `countRetries` | Operates on in-memory turn list. | Becomes a SQL window function or a per-turn flag at write-time. Same rules, different surface. |
| `src/optimize.ts` sub-scanners | Reads codeburn's `ProjectSummary` shape. | Each scanner becomes a SQL query over our `session_tool_calls` / `file_read_index`. Logic identical, query syntax new. |
| `src/menubar-installer.ts` + `src/menubar-json.ts` | macOS installer + JSON payload format. | We already have `VibeDeckMac/EmbeddedServer`. Port only the JSON shape the menubar consumes (~150 LOC of field definitions). Discard the installer entirely. |
| `src/sqlite.ts` | Read-only wrapper using `node:sqlite`. | We already use `node:sqlite` in `src/lib/db/`. Lift the `blobToText` UTF-8 fallback verbatim (real bug fix). Discard the rest. |
| `src/export.ts` | Output formatters. | Keep formatter half. Replace data-fetch half with our `canonical-cost-summary` + new aggregates. |
| `src/models-report.ts` | Pivot view. | Keep table renderer. Replace data source with our SQL. |
| `src/day-aggregator.ts` | Per-day rollups from sessions. | We already have `branch-windows` / `live-rollups` doing per-day work. Pull only the output shape; rewrite as views over our existing tables. |
| `src/daily-cache.ts` | JSON cache with version-bump migration. | Discard the file cache (we're SQLite). Lift the **version-bump pattern** — add `cache_version` on aggregates so we can invalidate when capture rules change. |
| `src/context-budget.ts` | Per-turn context-window math. | Logic ports; be careful with cache-read counting (see Section 7 / Phase D). |

### Reference only (look, don't copy)

| Codeburn file | Why not to copy |
|--|--|
| `src/main.ts` | CLI entrypoint with commander + ink boot. We have `bin/vibedeck.js` + `src/commands/*`. |
| `src/dashboard.tsx` | Ink TUI we don't want. Web dashboard owns this surface. |
| `src/compare.tsx` | Ink TUI. Build compare in the React dashboard. |
| `src/codex-cache.ts`, `src/cursor-cache.ts` | Caching for codeburn's stateless re-parse model. We're SQLite-backed; caching is implicit. |
| `src/ink-win.ts` | Windows Ink shim. N/A. |
| `src/data/litellm-snapshot.json` | We have `seed-snapshot.json` (245K). Don't import a second copy — diff and merge any model entries codeburn has that we lack. |
| `src/yield.ts` | Codeburn's yield is a thin heuristic over their session model. Our `head-history` + branch-windows let us build a *better* yield. Use codeburn's output shape as the contract; write correlation logic fresh. |
| `src/menubar-installer.ts` (install path) | Already shipped in `VibeDeckMac/`. |
| `src/plan-usage.ts` (cumulative tally) | Logic is fine but counts against codeburn's session model. Rewrite over our SQL. |

### Rule of thumb

- **Pure functions of pure data** → copy-paste. (classifier, bash-utils, formatters, plan tiers, model-efficiency.)
- **Anything that touches I/O, the DB, or a provider's filesystem** → adapt. Shape mismatch *is* the work.
- **Anything UI** → reference only. We're React + web; codeburn is Ink + terminal.
- **Anything that exists in `VibeDeckMac/` already** → reference only.

### Per-phase copy/adapt ratio

| Phase | Copy-paste share | Adapt share | Notes |
|--|--|--|--|
| A | ~70% | ~30% | `format.ts`, `plans.ts`, export formatters, models-report renderer copy. Data fetch adapts. |
| B | ~10% | ~90% | Only extractor rule constants + `bash-utils` copy. Parser → event emitter rewrite + 13 providers adapt. |
| C | ~80% | ~20% | `classifier.ts` whole file + retry rules copy. Aggregation queries adapt. |
| D | ~50% | ~50% | Plan tiers + context math copy. Compare panel + SQL fetches adapt. |
| E | ~5% | ~95% | Scanner names/headings copy only. Every scanner is new SQL; `file_read_index` is ours to design. Remediation copy hand-written. |
| F | ~30% per provider | ~70% per provider | Path detection + JSONL field maps copy. Emitter wiring adapts. |

Free wins concentrate in **A and C**. The rest is faster with codeburn open than without — but it's real porting work, not Ctrl-C / Ctrl-V.
