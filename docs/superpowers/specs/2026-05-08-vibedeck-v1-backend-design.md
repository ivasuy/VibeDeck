# VibeDeck v1 — Backend & Infrastructure Design

**Date:** 2026-05-08
**Status:** Draft for review
**Author:** brainstorming session — `vasu7yadav@gmail.com`
**Working name:** `vibedeck` (final brand TBD)
**Base project:** Hard fork of TokenTracker (`tokentracker-cli`)

---

## Scope of this document

This spec covers **backend, business logic, distribution, and stripping** for VibeDeck v1.

**Explicitly out of scope** (separate sessions / specs):

- UI design language, color system, typography, layout
- New dashboard components (Entire panel, session views, skill manager UI)
- macOS app updates (menu bar panel changes, native widgets)
- Default landing view selection
- Visual rebrand assets (logo, icons, DMG identity)

These are deferred to dedicated design sessions because UI is a substantial body of work in itself and intertwining it with backend would compromise both.

---

## Product summary

**VibeDeck** is a local-first cost & provenance cockpit for developers running multiple AI coding agents in parallel (Claude Code, Cursor, Codex, Gemini, OpenCode, OpenClaw, Hermes, Kimi, CodeBuddy, oh-my-pi, Copilot, Every Code, Kiro). It is a hard fork of TokenTracker, stripped of consumer/cloud features, rebranded, and extended with two new capabilities:

1. **Session attribution** — every token bucket linked to a session, repo, branch, and (when Entire is installed) commit + checkpoint, with explicit confidence levels.
2. **Entire control surface** — Entire CLI commands available as backend endpoints (UI buttons in a later spec).

Plus skill install / remove / audit across providers (extending TokenTracker's existing skill listing).

**Core thesis:** VibeDeck is the **join layer** between TokenTracker's cross-provider observability and Entire's per-session/per-commit ground truth. It does not re-invent attribution; it joins two sources of truth, adds skill management, and exposes Entire control. Everything stays on `127.0.0.1`. No cloud required.

---

## What ships in v1

| Capability | Provenance |
|---|---|
| Token usage across 13 providers | Inherited from TokenTracker, untouched |
| Cost dashboard, model breakdown, heatmap, trend charts | Inherited |
| Usage limits & rate-limit tracking | Inherited |
| macOS menu bar app + native panels (visual rebrand only) | Inherited; UI rebrand in separate spec |
| Local API server on configurable port | Inherited |
| Hook system for all providers | Inherited; **extended with two-phase atomic installer** |
| Session → branch → commit attribution (hybrid model) | **New** |
| Entire CLI integration (read + write surface) | **New** |
| Skill install / remove / audit | **New** (extends existing listing) |
| Local-only auth token for write endpoints | **New** |
| Hard rebrand (npm name, brew tap, bundle ID, logo, app name) | **New** (mechanical) |

## What gets stripped from TokenTracker

These features are removed from the fork:

| Component | Files (representative) |
|---|---|
| Leaderboard pages and endpoints | `LeaderboardPage.jsx`, `LeaderboardProfilePage.jsx`, leaderboard API routes |
| Public profile system | leaderboard profile page + supporting context |
| IP-check utility | `IpCheckPage.jsx` and route |
| Marketing landing page | `LandingPage.jsx` |
| Share cards (Broadsheet + Annual Report) | `ShareModal.tsx`, `BroadsheetCard.jsx`, `AnnualReportCard.jsx`, `capture-share-card.ts` |
| Cloud sync (InsForge auth + leaderboard upload) | `InsforgeAuthContext.jsx`, related cloud-mode code, sync upload logic. Default off; can be removed entirely or feature-flagged off (decision: remove for v1, simpler) |
| Cloud-mode auth flow | `LoginPage.jsx`, `NativeAuthCallbackPage.jsx`, native OAuth bridge for cloud (kept for local) |
| Project-attribution feature where it duplicates session attribution | Decision below |
| Login-modal context / global sign-in modal | `LoginModalContext.jsx` |
| `/api/auth/*` cloud proxy endpoints | Removed |

**Untouched (load-bearing core IP):**

- `src/lib/rollout.js` — all parser/normalizer logic for 13 providers
- All token-cost math, pricing tables (70+ models), token-type accounting (input/output/cache_read/cache_creation/reasoning_output)
- Half-hour bucket aggregation
- `src/lib/usage-limits.js` — rate-limit detection
- `src/lib/local-api.js` — local API handler (extended, not replaced)
- `src/commands/sync.js`, `src/commands/serve.js`, `src/commands/init.js` (extended)
- `src/lib/cursor-config.js`, `src/lib/codex-config.js`, all `*-config.js` integrations
- All hook installers — extended with collision-safety (Section 2)
- macOS app shell (UI changes deferred to separate spec)
- Existing release pipeline (npm-publish, release-dmg, brew tap auto-update)
- `copy.csv` system (entries pruned for stripped features, never replaced wholesale)

**Decision on project attribution:** keep `src/lib/project-usage-purge.js` and project-attribution APIs. Project attribution operates at repo level; session attribution operates at session/branch level. They are complementary, not duplicates.

## What is explicitly deferred to post-v1

These appeared in earlier brainstorming and are **not** in v1:

- Agent launching from the panel (PTY, xterm.js, node-pty)
- Live agent output streaming
- React Flow live execution graph
- AgentField workflow runtime (category mismatch — see brainstorm transcript)
- AgentBrowser, AgentMail integrations
- Swarm orchestration
- Custom harness
- Unified memory layer (jcode, etc.)
- Context sharing across providers (Codex-CLI-Compact, etc.)
- Multi-step "prepare repo" workflow
- HITL approval flows
- Tauri desktop app
- Windows support
- Cloud sync of session data
- Multi-user / team mode

Each gets its own spec when v1 has earned the right to expand.

---

# 1. Architecture

## 1.1 Codebase strategy

- New repository, hard fork of TokenTracker.
- Working name `vibedeck`. New `package.json` name (e.g., `vibedeck-cli`), new bin commands (`vibedeck`, optionally `vd`), new bundle ID, new app name, new icons.
- New module: `src/lib/sessions.js` — the attribution join layer.
- New module: `src/lib/entire-bridge.js` — wraps Entire CLI shell-outs and direct git reads of `entire/checkpoints/v1`.
- New module: `src/lib/hook-merger.js` — collision-safe hook installer with two-phase atomic write (Section 2).
- New module: `src/lib/local-auth.js` — auth token issuance and middleware for write endpoints.
- New module: `src/lib/skills.js` — skill install / remove / audit.
- Existing modules extended in-place: `rollout.js` (emit `SessionEvent`s), `local-api.js` (new endpoints), `init.js` (new wizard steps), `sync.js` (write SessionEvents), `doctor.js` (new checks).
- Data path: `~/.vibedeck/` (separate from `~/.tokentracker/` so users can run both side-by-side during migration).

## 1.2 Distribution

- **npm:** package renamed to `vibedeck-cli`. Bin command `vibedeck`. Existing publish workflow reused with a new `NPM_TOKEN`.
- **macOS DMG:** existing CI workflow reused. New bundle ID (`io.vibedeck.app` or similar). New icons. Same ad-hoc signing approach (documented Gatekeeper bypass — non-negotiable per CLAUDE.md lessons-learned).
- **Brew tap:** new repo `<owner>/homebrew-vibedeck`. Cask (DMG) and Formula (CLI) sharing version. Auto-update bot pattern reused from current TokenTracker tap (cron + optional `repository_dispatch`).

### Entire as prerequisite (not bundled)

VibeDeck does **not** bundle the Entire binary. Reasons: Entire has its own release cadence, signing, security posture, and brew tap. Bundling would create a stale-binary problem and introduce signing complexity.

Instead:

- **Brew Cask:** `depends_on cask: "entireio/tap/entire"` so `brew install --cask vibedeck` installs Entire automatically.
- **Brew Formula:** `depends_on cask: "entireio/tap/entire"` (or no dependency for the CLI-only formula path; document install).
- **npm:** post-install detects `entire` on PATH. If missing, prints platform-specific install command. Does **not** auto-execute brew/curl.
- **Dashboard / CLI runtime:** if `entire` is missing, banner / `vibedeck doctor` output instructs the user. **VibeDeck still functions** — attribution falls back to tier B/C (Section 3.4). Graceful degradation, no hard dependency at runtime.

### Default port

- TokenTracker: 7680. VibeDeck: **7690** (different default to avoid collision when both installed). Conflict resolver from TokenTracker reused.

## 1.3 Local data flow

```
Agent CLIs run
    │
    └──► write logs (rollout JSONL / SQLite / OTel / CSV per provider, all existing)
              │
              ▼
       TokenTracker parsers (unchanged math)
              │
              ├──► hourly token buckets    (existing path, unchanged)
              │           │
              │           ▼
              │    SQLite: tokentracker_buckets table
              │
              └──► SessionEvent stream     (NEW path)
                          │
                          ▼
                   sessions.js join layer
                          │
              ┌───────────┼─────────────┐
              ▼           ▼             ▼
         git repo    Entire branch   override CLI
         resolution  (entire/        records
         (Tier B/C)  checkpoints/v1)
                     (Tier A)
                          │
                          ▼
                   SQLite: vibedeck_sessions
                           vibedeck_session_buckets
                           vibedeck_session_entire_links
                          │
                          ▼
                   local-api.js endpoints
                          │
                          ▼
                   Dashboard / macOS app
```

The bucket pipeline is preserved exactly. SessionEvents flow in parallel and reference the existing buckets by `(provider, model, time_window)`. Token math is never recomputed.

---

# 2. Hook collision contract

Entire and the legacy TokenTracker (and any other tool) all write to the same agent-hook files: `.claude/settings.json`, `.codex/config.toml`, `.cursor/hooks.json`, `.gemini/settings.json`, `.opencode/plugins/*.ts`, `.factory/settings.json`, `.codebuddy/settings.json`, `.github/hooks/entire.json` (Copilot CLI). Naïve overwriting destroys other tools' configuration.

VibeDeck treats hook installation as a **safety-critical** code path with the following invariants.

## 2.1 Signature & marker

Every hook entry written by VibeDeck carries a stable, machine-readable signature:

- **JSON formats** (Claude, Cursor, Gemini, Factory, CodeBuddy, Copilot): each entry has a sibling field `"_vibedeck": "v1"` or a unique command path containing `~/.vibedeck/app/hooks/notify.cjs` (or the configured runtime path). Detection prefers explicit field; falls back to command-path glob match.
- **TOML format** (Codex, Every Code): each notify-array entry contains the canonical command path; comment line `# vibedeck` directly above when feasible (TOML serializer permitting); otherwise pure command-path detection.
- **TS plugin** (OpenCode): a named export with a recognizable ID like `vibedeckPlugin`; module file name `vibedeck.ts`.

These signatures are documented in `src/lib/hook-merger.js` and version-pinned. Changing the signature is a breaking change requiring a migration step.

## 2.2 Read-merge-write contract

Every hook write follows this sequence:

1. **Read** the existing file. If parse fails, abort and emit error — never overwrite a malformed file (could be user-edited mid-write).
2. **Detect** existing entries by signature: `{ours, theirs, unknown}`.
3. **Plan** the merge:
   - If a VibeDeck entry already exists and is current → no-op.
   - If a VibeDeck entry exists but is outdated → replace in place.
   - If no VibeDeck entry → append, preserving order of `theirs` and `unknown`.
4. **Write to a temp file** in the same directory (atomic-rename target).
5. **Validate** the temp file parses cleanly with strict parser.
6. **Atomic rename** temp → real path (`fs.renameSync` is atomic on POSIX, near-atomic on macOS APFS).
7. **Verify** by re-reading and asserting our entry is present.

If any step fails: temp file is removed, original file untouched, error logged with sufficient context to debug.

## 2.3 Two-phase atomic installer (multi-file)

A single `vibedeck enable` call may write 3-7 hook files. Per-file atomicity isn't enough — partial multi-file failure leaves system half-configured.

**Two-phase commit:**

- **Phase 1 (stage):** for each target file, perform read-merge-validate, but write to a `.vibedeck-staging-<uuid>` temp path. Do NOT rename yet. If any file fails staging, abort all.
- **Phase 2 (commit):** atomic-rename every staged file to its final path. If any rename fails (extremely rare), attempt rollback by restoring backups of originals saved at start of phase 2.

This ensures: either all hooks are installed correctly, or none are touched.

## 2.4 Per-format mergers

Each of the 7 hook formats has a dedicated merger in `src/lib/hook-merger.js`:

- `mergeClaudeJSON` — parses `.claude/settings.json`, navigates `hooks.SessionEnd[]`, dedupes by signature.
- `mergeCodexTOML` — parses `.codex/config.toml`, navigates `notify[]`, preserves comments where the parser supports it.
- `mergeCursorJSON` — same shape as Claude with different schema path.
- `mergeGeminiJSON`, `mergeFactoryJSON`, `mergeCodebuddyJSON`, `mergeCopilotJSON` — each with its own schema path.
- `mergeOpenCodePluginTS` — special: appends a plugin import + registration line to `.opencode/plugins/index.ts` (or whichever entry file the project uses), or adds a new `vibedeck.ts` file alongside Entire's `entire.ts`. AST-aware merge via `ts-morph` to be safe with formatting.

Each merger has a dedicated test file (`test/hook-merger-claude.test.js`, etc.) covering: empty file, file with Entire entry, file with our entry already, file with both, file with unknown third-party entry, malformed file (must abort).

## 2.5 Removal

`vibedeck disable` and `vibedeck uninstall`:

- Walk every known hook file.
- Remove only entries matching VibeDeck's signature.
- Preserve all other entries (Entire's, user-manual, third-party).
- If a hook file becomes empty after removal, delete it (matches Entire's behavior).
- Use the same two-phase atomic write contract.

## 2.6 Doctor checks

`vibedeck doctor` runs:

- Hook integrity: signature present in expected files; if missing, suggest re-enable.
- Hook divergence: VibeDeck signature present but command path doesn't match current install path → suggest `vibedeck enable --force`.
- Stale hooks: VibeDeck signature for a previous schema version → migration suggested.
- Orphaned third-party entries (informational only — never auto-remove).

---

# 3. Session attribution layer (the heart)

## 3.1 Principle

VibeDeck **does not recompute tokens or cost**. It links existing token-bucket rows to sessions, and sessions to repos, branches, and (when available) commits + Entire checkpoints. The bucket pipeline runs exactly as today.

Implementation rule: if any change requires modifying token math, pricing, or bucket aggregation logic in `rollout.js` outside the new SessionEvent extraction, **stop and re-design** — that's a leak in the abstraction.

## 3.2 SessionEvent extraction (per-provider)

The existing `rollout.js` parsers aggregate rollout entries into 30-minute buckets and discard `session_id`. The new build extends each parser to emit a parallel `SessionEvent` stream. Bucket emission is unchanged.

```typescript
type SessionEvent =
  | { kind: "start", provider, session_id, started_at, cwd | null, model }
  | { kind: "update", provider, session_id, observed_at, delta_tokens, cwd | null }
  | { kind: "end", provider, session_id, ended_at, total_tokens, end_reason }

// end_reason: "explicit_hook" | "idle_timeout" | "process_signal" | "rollout_truncated" | "orphan_reaped"
```

### Per-provider extraction

| Provider | Session ID source | Start signal | End signal | cwd available |
|---|---|---|---|---|
| Claude Code | `session_id` in rollout JSONL | First message in rollout | `SessionEnd` hook fires | Often (in hook context) |
| Codex | `session_id` in rollout | First entry | TOML `notify` end event / hook | Often |
| Gemini | `sessionId` in rollout | First entry | `SessionEnd` hook | Often |
| Cursor | `conversation_id` in CSV (acts as session_id) | First row in poll | New conversation_id appears or poll closes session | **Rarely** |
| OpenCode | Plugin event `session.start` / `session.end` | Plugin event | Plugin event | Yes (plugin has cwd) |
| OpenClaw | Session plugin events | Plugin | Plugin | Yes |
| Every Code | `session_id` in rollout (same family as Codex) | TOML notify | TOML notify | Often |
| Kiro | SQLite + JSONL hybrid; session row has start/end | DB row | DB row update | Sometimes |
| Hermes | SQLite `sessions` table with explicit start/end timestamps | DB row | DB row update | Sometimes |
| Copilot CLI | OTel trace_id (acts as session_id) | OTel span start | OTel span end | Via env at span time |
| Kimi | Passive `wire.jsonl` reader | First event in file | Inferred from file gap or rotation | Sometimes |
| oh-my-pi (omp) | Passive JSONL reader | First event | Inferred | Sometimes |
| CodeBuddy | `SessionEnd` hook (Claude-Code fork) | First message | Hook | Often |

### Idempotency

`(provider, session_id)` is the primary key for `vibedeck_sessions`. All inserts are `ON CONFLICT DO UPDATE` so re-running sync over historical logs produces an identical session table. Re-running parser must be byte-stable for the same input — this is a tested invariant.

### Orphan reaper

Some providers don't emit reliable end signals (process kill -9, laptop sleep, hook handler crash). To avoid sessions being "live" forever:

- A reaper runs on every `sync` and every 5 minutes during `serve`.
- Any session marked `live` with no rollout activity in 30+ minutes AND no `serve` watcher signal in the same window is marked `ended_inferred`. End time is set to last-observed activity. `end_reason = "orphan_reaped"`.
- When real end signal arrives later (rare race), it overwrites only if it indicates a *later* end time.

### Idle vs ended

Real sessions can be idle for 20+ minutes mid-flight (user reading code) and then resume. Splitting on idle alone produces false fragmentation. Decision rule:

- `idle > 30 min AND (rollout file unchanged OR explicit end hook OR file watcher inactive)` → end.
- `idle > 30 min BUT rollout still being appended` → keep `live`, log diagnostic.

Tunable via `VIBEDECK_IDLE_TIMEOUT_MIN` env var; default 30.

## 3.3 Repo & worktree resolution

This is the layer where a `cwd` becomes a canonical `repo_root` and a `branch`. Doing this wrong corrupts attribution.

### Path normalization

For every `cwd` observed in a session:

1. **Apply `realpath` / `fs.realpathSync`** to resolve symlinks. Without this, two valid paths to the same physical directory create two repo entries.
2. **Validate the path exists.** Stale cwd (deleted dir) → `Unattributed`.
3. **Resolve repo root:** `git -C <cwd> rev-parse --show-toplevel`. Result is the canonical `repo_root` key.
4. **Detect bare repo:** `git -C <cwd> rev-parse --is-bare-repository`. If true → no working tree, `repo_root = null`, `Unattributed`.
5. **Detect zero-commit repo:** `git -C <cwd> rev-list --count HEAD` returns `0` or errors → tier C (reflog) is empty, falls to tier B (live watch only) or D.

### Worktree handling

Git worktrees mean one logical repository can have multiple checkout directories, each with independent `HEAD`.

- **`git -C <cwd> rev-parse --show-toplevel`** returns the worktree root, not the main repo dir. **This is what we want** — different worktrees have different branches and different sessions.
- **`git -C <cwd> rev-parse --git-common-dir`** returns the shared `.git` for the main repo. Useful for grouping worktrees in UI later (e.g., "all worktrees of `myproject`"). Stored as optional field `repo_common_dir`.
- Each worktree has its own `HEAD` at `.git/worktrees/<name>/HEAD`. Tier B watcher must watch all worktree `HEAD`s, not just the main one.
- Concurrent sessions in two worktrees of the same repo on different branches → both attributed correctly because each session's cwd resolves to a different worktree root.

### Submodules

- `git -C <cwd> rev-parse --show-superproject-working-tree` returns the parent repo root if `cwd` is inside a submodule, empty string otherwise.
- Decision: **attribute to the submodule** (it's where the work happens). Store `parent_repo` as an optional field for UI grouping.
- The submodule is treated as its own `repo_root`. Cost rolls up to submodule's branches.

### Repo identity & rename

- Canonical key: realpath of repo_root. Stable across sessions.
- If user renames or moves the directory: new realpath = new repo entry. Historical sessions still reference the old path. Fix via `vibedeck repo migrate <old-path> <new-path>` CLI which updates `repo_root` field for matching rows. Rare operation; not automated to prevent damage from typos.

### Special cases

| Case | Handling |
|---|---|
| `cwd` is a subdirectory of repo | Naturally resolved; `rev-parse --show-toplevel` walks up. |
| `cwd` is in a git-ignored directory | Still works; ignore status doesn't affect ref resolution. |
| Repo has no remote | Fine. Branch resolution doesn't need a remote. |
| Repo with detached HEAD | Branch = `detached@<short-sha>` virtual branch. Cost still attributable. |
| Multiple repos with same dirname (e.g., user has two `myapp/` clones) | Realpath disambiguates. |
| Cwd inside `.git` (rare; tooling sometimes does this) | `rev-parse --show-toplevel` errors → `Unattributed`. |

## 3.4 Branch resolution tiers

Given a session with `cwd` (or `null`) and `started_at` (UTC), resolve the branch in this order:

### Tier A — Entire ground truth (high confidence)

If Entire is installed and the local `entire/checkpoints/v1` branch contains a session record with:

- `repo_root` matches our `repo_root` (after path normalization)
- Time window overlaps our `[started_at, ended_at]` (or our `started_at` falls within Entire's session window)

Then use Entire's recorded branch. Bonus: store the matched `entire_session_id` and any `checkpoint_id`s into `vibedeck_session_entire_links`.

**Disambiguation when multiple Entire sessions overlap:** prefer the one whose start time is closest to ours; if still ambiguous, mark `confidence: medium` and store all candidate IDs for later UI display.

**When Entire is installed but `entire/checkpoints/v1` is not yet fetched locally** (e.g., separate checkpoint remote per Entire docs): tier A returns null. We do **not** fetch on the user's behalf in v1 — too invasive. Banner suggests `git fetch`. Falls through to tier B.

### Tier B — Live HEAD watcher (medium confidence)

For sessions active during `serve`:

- A Chokidar watcher tracks every active repo's `.git/HEAD` file (and `.git/worktrees/*/HEAD` for worktrees).
- On change, record `(repo_root, worktree_root, ref_at_time, transition_timestamp_utc)` into an in-memory ring buffer (`HeadHistory`), capped at 1000 entries per repo.
- For session attribution: find the `HeadHistory` entry whose timestamp is the latest one ≤ session's `started_at`. That's the branch at session start.
- If session spans multiple `HeadHistory` transitions, **split**: each sub-window attributed to the branch active during it (Section 3.6).

`HeadHistory` is persisted to `~/.vibedeck/head-history.jsonl` (append-only, rotated weekly) so it survives daemon restarts. On startup, `serve` replays the last 7 days from disk.

### Tier C — Reflog scrape (medium-low confidence)

For retrospective sessions (no Entire match, no live history):

- Run `git -C <repo_root> reflog --date=iso --format='%gd %gs %gI %ad'` (or equivalent).
- Parse entries; convert local time to UTC if reflog timestamp is local.
- Find the reflog entry closest to but ≤ `session.started_at`. Use the `HEAD` ref name at that time.
- Reflog is local-only; works for the user's own machine. Does not work for sessions imported from a different machine (deferred concern).
- If reflog is empty (fresh repo) → tier D.

### Tier D — Unattributed

`cwd: null`, `repo_root: null`, or all tiers failed → bucket as `Unattributed`. Cost still tracked, just not attributed to a branch. Surface honestly in UI.

### Confidence summary

| Tier | Confidence | Stored Value |
|---|---|---|
| A (Entire match) | `high` | `vibedeck_sessions.confidence = 'high'` |
| B (live watcher) | `medium` | `'medium'` |
| C (reflog) | `low` | `'low'` |
| D (no resolution) | `unattributed` | `'unattributed'` |

UI **must** surface confidence (deferred spec). Fuzzy attribution displayed as ground truth would erode user trust.

## 3.5 Entire integration (deeper)

Two access modes for Entire data, used together:

### Mode 1 — Direct git read of `entire/checkpoints/v1`

Per Entire's design, all session metadata is committed to a separate branch. Reading it directly via `git` is fast and avoids spawning the Entire CLI for every query:

- `git -C <repo> ls-tree entire/checkpoints/v1` → enumerate session files.
- `git -C <repo> show entire/checkpoints/v1:path/to/session.json` → read session metadata.
- Cache parsed sessions in memory keyed by `(repo, commit-sha-of-checkpoints-tip)`. Invalidate when tip changes.

This is the path used for Tier A resolution and for populating the checkpoint list view. Zero CLI spawns per query.

### Mode 2 — Shell out to `entire` CLI

For write operations and complex commands where reimplementing logic is brittle:

| Command | Use |
|---|---|
| `entire enable --agent <name>` | "Enable Entire on this repo" button |
| `entire disable` | Disable button |
| `entire agent add <name>` / `agent remove <name>` | Agent management |
| `entire configure --telemetry=false` etc. | Settings updates |
| `entire status` | Status check (proxy command) |
| `entire checkpoint rewind --id <id>` | Rewind (destructive — confirm token required) |
| `entire session resume <branch>` | Resume button (post-v1 likely) |
| `entire doctor` | Health command (proxy) |
| `entire clean --force` | Cleanup (destructive — confirm token required) |

Every shell-out:

- Uses `execa` argv form (never shell-string) to prevent injection.
- Validates user-controlled args (checkpoint ID `^[a-f0-9]{12}$`, branch via `git check-ref-format`, agent name from a hardcoded allowlist).
- 10-second timeout; exceeded → kill child + return error.
- Captures stdout + stderr + exit code; structured error on non-zero.
- Output schema parsing is defensive: garbage stdout → fall back gracefully, never crash.
- Destructive commands (`rewind`, `clean`) require a per-call confirmation token issued by the local-auth layer (Section 8).

### Cross-validation between TokenTracker tokens and Entire-recorded tokens

Entire records its own token counts per session (per its README). TokenTracker also records token counts via its own parsers. **Both should agree.**

- v1: do **not** reconcile. Display TokenTracker's counts (authoritative for cost). Store Entire's counts as a side metadata field for future cross-check.
- If a debug command is added (`vibedeck doctor token-cross-check`), it can flag deltas > 5% as parser-drift warnings. Useful for catching bugs but not user-facing.

### Session linking heuristic

Entire's session_id format is `YYYY-MM-DD-<UUID>`. TokenTracker's session_ids are provider-specific. They are **not** identical. We link by:

1. Same `repo_root` (after realpath normalization).
2. Time window overlap (Entire session window contains or overlaps our session's `[started_at, ended_at]`).
3. Same agent kind (Entire records `agent: "claude-code"` etc.; we know provider).

If exactly one Entire session matches all three: link, `confidence: high`.
If multiple match: store all candidate IDs, mark `confidence: medium`, prefer closest start time for primary link.
If none match: tier A returns null.

## 3.6 Session split on branch change

A session can outlive a `git checkout`. For correct cost attribution, the session must be split into windows-by-branch.

- For a session `S` with `[started_at, ended_at]` in repo `R`:
  - Look up all `HeadHistory` transitions in `R` between `started_at` and `ended_at`.
  - For each window between transitions, compute the proportion of session token usage in that window (use bucket overlap with the window — buckets are 30-min, windows can be smaller; pro-rata by time overlap as fallback).
  - Emit `vibedeck_session_branch_window` rows: `(session_id, branch, window_start, window_end, prorated_tokens, prorated_cost)`.
- The session itself remains a single row in `vibedeck_sessions`. The branch-window rows roll up for branch-level cost views.

This is the only place we do "math" beyond joining — and it's pro-rata over time, not over tokens. Documented as an approximation.

## 3.7 Edge cases (consolidated)

| # | Case | Handling |
|---|---|---|
| 1 | Two parallel sessions, same cwd, same branch | Both attributed to that branch. Cost summed. Sessions listed separately. |
| 2 | Two parallel sessions, same repo, different worktrees | Resolved naturally via cwd → different worktree roots. |
| 3 | Session spans `git checkout` mid-flight | Split into branch-windows (Section 3.6). |
| 4 | `cwd` outside any git repo | `Unattributed`. |
| 5 | Provider doesn't expose cwd (often Cursor) | `cwd: null`, falls to `Unattributed` unless Entire window matches in time → tier A correlation. |
| 6 | Multiple repos under same parent dir (rare) | `git rev-parse --show-toplevel` from session cwd, not heuristics. |
| 7 | User manually overrides | `vibedeck attribute --session <id> --branch <name>` CLI. Override is sticky, never reverted by parser. |
| 8 | Hook process killed (kill -9, sleep, crash) | Orphan reaper marks `ended_inferred` after 30 min. |
| 9 | DST / clock skew | All session timestamps stored UTC. Reflog converted to UTC at parse time. |
| 10 | Long idle gap mid-session | Don't split unless rollout file is also quiescent AND no end signal. |
| 11 | Provider reuses session_id across reconnects | Dedupe by `(provider, session_id)`; merge new windows into existing row. |
| 12 | Detached HEAD | Virtual branch `detached@<short-sha>`. |
| 13 | Branch rename mid-session | Resolve branch by ref at query time, not stored name. |
| 14 | Branch deleted before query | Show as `<name> (deleted)`. Cost row preserved. |
| 15 | Submodule | Attribute to submodule. Optional `parent_repo` field for UI grouping. |
| 16 | Bare repo | Detected; `Unattributed`. |
| 17 | Zero-commit repo | Tier C empty; tier B works for live; else `Unattributed`. |
| 18 | Symlinked cwd | `realpath` first, then resolve. |
| 19 | `cwd` deleted between session and query | `Unattributed`; session still listed with `repo_root: null`. |
| 20 | Repo moved/renamed by user | Manual `vibedeck repo migrate <old> <new>` CLI. |
| 21 | Rollout file rotated/truncated | Parser tolerant; if session was active and file disappears, mark `ended_inferred`, lock totals at last-known. |
| 22 | Cursor poll-based delay | Live view shows `last_observed_at`; UI labels "as of X seconds ago" (deferred to UI spec). |
| 23 | Claude Code only emits SessionEnd | Mid-conversation token counter unavailable; live view shows "session active, totals at end". Documented. |
| 24 | Same session, two Entire candidates overlap | Pick closest start time; `confidence: medium`; store all candidates. |
| 25 | Entire installed but `entire/checkpoints/v1` not locally fetched | Tier A returns null silently; banner suggests fetch. |
| 26 | Entire CLI errors / segfaults | Tier A unavailable; structured error logged; tier B/C continue. |
| 27 | Skill-installed-from-URL pulls malicious code | v1 prompts user with source + README; never auto-installs (Section 4). |
| 28 | Cwd contains sensitive path names | `--redact-paths` flag for diagnostics export. |
| 29 | User has both old TokenTracker and VibeDeck running | Different ports, different data dirs, can coexist. |
| 30 | Repository moved to different machine (sync data import) | Out of scope for v1 (no sync). |

---

# 4. Skill management

Existing TokenTracker code can list installed skills across providers. The new module `src/lib/skills.js` adds **install**, **remove**, and **audit**.

## 4.1 Install

- Source forms: a git URL, a local path, or a registry name (registry deferred to post-v1; v1 supports git URL + local path only).
- Target provider chosen by user (e.g., "install for claude-code"). Each provider has known skill directories:
  - Claude Code: `~/.claude/skills/<name>/` and project-local `<repo>/.claude/skills/<name>/`
  - Codex: `~/.codex/skills/<name>/`
  - Cursor: `~/.cursor/skills/<name>/`
  - (Others as the providers gain skill conventions.)
- Steps:
  1. Validate target dir is writable.
  2. Validate skill source is reachable (git ls-remote / fs.stat).
  3. **Show user the source URL + README content. Require explicit confirm before any download.** No auto-install.
  4. `git clone --depth 1` into temp dir, or `cp -r` from local path.
  5. Validate skill structure (must contain a `SKILL.md` or equivalent — schema documented).
  6. Atomic-rename temp dir into target path.
  7. If skill ships hooks, run `hook-merger` for the relevant provider.
  8. Record install in `vibedeck_skills` table.

## 4.2 Remove

- Lookup skill by `(provider, name)`.
- Confirm with user (destructive; show files about to be deleted).
- If skill registered hooks, run `hook-merger` removal for those entries.
- `rm -rf` the skill directory.
- Update `vibedeck_skills`.
- Idempotent: removing an already-removed skill is a no-op with informational message.

## 4.3 Audit

- Walk every known skill directory across providers.
- Resolve via `realpath` to detect symlinked / shared skills.
- Detect duplicates (same realpath registered for multiple providers — common pattern).
- Heuristic last-used: grep recent rollouts for skill name; report timestamp of most recent match. **Marked `(estimated)`** in output — never claim as ground truth.
- Output: structured JSON for the API; CLI command pretty-prints.

## 4.4 Conflict & error handling

- Skill at `~/.claude/skills/foo` AND at project-local `<repo>/.claude/skills/foo`: audit shows both with origin. Remove operates on the user-selected one.
- Permission errors (read-only skill dir): graceful fail; never partial state.
- Install rollback: if any post-clone step fails (validation, hook merge), the cloned dir is removed and DB is not updated.

---

# 5. Storage schema

SQLite database at `~/.vibedeck/db.sqlite` (or platform-appropriate path; respects existing TokenTracker path conventions). WAL mode enabled.

Existing TokenTracker tables remain **unchanged**. New tables prefixed `vibedeck_*`.

```sql
-- Schema versioning
CREATE TABLE schema_version (
    component TEXT PRIMARY KEY,        -- e.g., 'vibedeck_sessions', 'tokentracker_buckets'
    version INTEGER NOT NULL
);

CREATE TABLE vibedeck_sessions (
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    started_at TEXT NOT NULL,          -- UTC ISO 8601
    ended_at TEXT,                     -- nullable; null = live
    end_reason TEXT,                   -- 'explicit_hook' | 'idle_timeout' | 'process_signal' | 'rollout_truncated' | 'orphan_reaped' | NULL
    cwd TEXT,                          -- realpath at session start; nullable
    repo_root TEXT,                    -- realpath; nullable
    repo_common_dir TEXT,              -- for worktrees; nullable
    parent_repo TEXT,                  -- for submodules; nullable
    branch TEXT,                       -- nullable
    branch_resolution_tier TEXT NOT NULL, -- 'A' | 'B' | 'C' | 'D'
    confidence TEXT NOT NULL,          -- 'high' | 'medium' | 'low' | 'unattributed'
    override_user TEXT,                -- if user manually attributed; nullable
    model TEXT,                        -- last-seen model in session; nullable
    total_tokens INTEGER,              -- denormalized cache; recompute from buckets
    total_cost_usd REAL,               -- denormalized cache; recompute from buckets
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (provider, session_id)
);

CREATE INDEX idx_vibedeck_sessions_repo_branch ON vibedeck_sessions(repo_root, branch);
CREATE INDEX idx_vibedeck_sessions_started ON vibedeck_sessions(started_at);
CREATE INDEX idx_vibedeck_sessions_live ON vibedeck_sessions(ended_at) WHERE ended_at IS NULL;

-- Links session to existing tokentracker bucket rows
CREATE TABLE vibedeck_session_buckets (
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    bucket_provider TEXT NOT NULL,     -- usually same as provider
    bucket_model TEXT NOT NULL,
    bucket_hour_start TEXT NOT NULL,   -- existing TokenTracker bucket key
    proportion REAL NOT NULL DEFAULT 1.0, -- pro-rata if multiple sessions share bucket time
    PRIMARY KEY (provider, session_id, bucket_provider, bucket_model, bucket_hour_start),
    FOREIGN KEY (provider, session_id)
        REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
);

-- Branch-windows for sessions that span checkouts
CREATE TABLE vibedeck_session_branch_windows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    branch TEXT NOT NULL,
    window_start TEXT NOT NULL,        -- UTC
    window_end TEXT NOT NULL,
    prorated_tokens INTEGER,
    prorated_cost_usd REAL,
    FOREIGN KEY (provider, session_id)
        REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
);

CREATE INDEX idx_branch_windows_branch ON vibedeck_session_branch_windows(branch, window_start);

-- Entire links
CREATE TABLE vibedeck_session_entire_links (
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    entire_session_id TEXT NOT NULL,   -- 'YYYY-MM-DD-<UUID>'
    entire_checkpoint_ids TEXT,        -- JSON array of 12-hex IDs
    match_confidence TEXT NOT NULL,    -- 'high' | 'medium' (only set when tier A succeeded)
    PRIMARY KEY (provider, session_id, entire_session_id),
    FOREIGN KEY (provider, session_id)
        REFERENCES vibedeck_sessions(provider, session_id) ON DELETE CASCADE
);

-- Skills installed by VibeDeck
CREATE TABLE vibedeck_skills (
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    install_path TEXT NOT NULL,        -- realpath
    source_url TEXT,                   -- git URL or local path (nullable for unknown origin)
    installed_at TEXT NOT NULL,
    last_used_estimate TEXT,           -- best-effort; never authoritative
    PRIMARY KEY (provider, name)
);

-- Head transition history (persisted for tier B fallback after restart)
CREATE TABLE vibedeck_head_history (
    repo_root TEXT NOT NULL,
    worktree_root TEXT NOT NULL,
    transitioned_at TEXT NOT NULL,     -- UTC
    ref_name TEXT NOT NULL,            -- 'refs/heads/main' or 'detached@<sha>'
    PRIMARY KEY (repo_root, worktree_root, transitioned_at)
);

CREATE INDEX idx_head_history_lookup ON vibedeck_head_history(worktree_root, transitioned_at);
```

**Single-writer pattern:** when `serve` is running, all writes go through it; `sync` invoked from CLI POSTs jobs to the local API instead of opening the DB directly. This avoids contention beyond what WAL handles. If `serve` isn't running, `sync` opens the DB directly (fine — no contention).

---

# 6. Migration from TokenTracker

On first run after install, VibeDeck detects an existing TokenTracker installation:

- Probe: `~/.tokentracker/`, `~/.tokentracker/db.sqlite`, presence of `tokentracker` on PATH.
- If found, prompt (CLI wizard or dashboard banner):
  - **Migrate** — copy `db.sqlite` to `~/.vibedeck/db.sqlite`, install schema migrations, run a one-time backfill of `vibedeck_sessions` from existing buckets (best-effort tier C/D attribution since no historical SessionEvents exist).
  - **Fresh start** — ignore old data; new install.
  - **Coexist** — both run side-by-side on different ports. User decides later.
- All three are valid; picked at first run. Decision recorded in `~/.vibedeck/install.json`.

Migration is **read-only over the old DB** to be safe. Old DB is never modified. If migration fails halfway, partial new DB is discarded; user re-prompted.

---

# 7. Local API surface

Existing TokenTracker endpoints **kept**:

- `GET /functions/tokentracker-usage-summary`
- `GET /functions/tokentracker-usage-daily`
- `GET /functions/tokentracker-usage-hourly`
- `GET /functions/tokentracker-usage-monthly`
- `GET /functions/tokentracker-usage-heatmap`
- `GET /functions/tokentracker-usage-model-breakdown`
- `GET /functions/tokentracker-project-usage-summary`
- `GET /functions/tokentracker-usage-limits`
- `GET /functions/tokentracker-user-status`
- `POST /functions/tokentracker-local-sync`

(Cloud auth proxy `/api/auth/*` removed.)

New endpoints:

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/functions/vibedeck-sessions-live` | GET (SSE) | Read | Streaming live sessions across providers |
| `/functions/vibedeck-sessions` | GET | Read | List sessions, filterable by `repo`, `branch`, `from`, `to`, `provider` |
| `/functions/vibedeck-session/:provider/:id` | GET | Read | Detail for one session |
| `/functions/vibedeck-branch-cost` | GET | Read | Cost grouped by branch in a date range |
| `/functions/vibedeck-checkpoints` | GET | Read | Proxy `entire checkpoint list` (or direct git read) |
| `/functions/vibedeck-checkpoint/:id` | GET | Read | Proxy `entire checkpoint explain` |
| `/functions/vibedeck-status` | GET | Read | Aggregate health (Entire installed, hook integrity, daemon uptime, last sync, attribution distribution) |
| `/functions/vibedeck-entire/:cmd` | POST | **Write + confirm** | Wrap safe Entire CLI commands: `enable`, `disable`, `agent-add`, `agent-remove`, `configure`, `doctor` |
| `/functions/vibedeck-entire/rewind` | POST | **Write + destructive-confirm** | `entire checkpoint rewind` |
| `/functions/vibedeck-entire/clean` | POST | **Write + destructive-confirm** | `entire clean` |
| `/functions/vibedeck-skills` | GET | Read | List installed skills (audit) |
| `/functions/vibedeck-skills/install` | POST | **Write + confirm** | Install skill from URL/path |
| `/functions/vibedeck-skills/remove` | POST | **Write + confirm** | Remove skill |
| `/functions/vibedeck-attribute` | POST | **Write** | Manual session→branch override |
| `/functions/vibedeck-doctor` | GET | Read | Run all doctor checks; return structured report |

Read endpoints: open on `127.0.0.1`, no auth (matches TokenTracker today).
Write endpoints: require local auth token (Section 8).
Destructive write endpoints: require both local auth token AND a per-call destructive-confirm token issued by a separate confirmation endpoint that returns one-time-use tokens.

---

# 8. Security

## 8.1 Local-auth token

- Generated at install: cryptographically random 32-byte token.
- Stored at `~/.vibedeck/auth.token` with `chmod 600`.
- Required on all **write** endpoints as `Authorization: Bearer <token>`.
- Dashboard reads it from a local-only handshake endpoint that requires the dashboard to prove same-host (e.g., must be served from the same daemon process via a shared in-process token, not exposed over HTTP).
- macOS app bundles the token retrieval into its native bridge.
- Token rotates on `vibedeck reset` or explicit `vibedeck auth rotate`.

This closes the local-API surface against other apps / browser extensions / loopback-listening malware that would otherwise be able to install hooks, enable Entire, install skills, or manually override attribution.

Read endpoints stay open: the data is non-sensitive (token *counts*, never prompts/transcripts unless explicitly requested).

## 8.2 Destructive-confirm tokens

`rewind`, `clean`, and other destructive operations require a one-time-use token issued by `POST /functions/vibedeck-confirm-destructive` after explicit user interaction (UI confirmation modal click, CLI prompt). Token is single-use, expires in 30 seconds.

Prevents accidental destructive actions via misclicks or redirected links.

## 8.3 Command injection prevention

- Every shell-out via `execa` argv form, never shell-string.
- User-controlled args validated:
  - Checkpoint ID: `^[a-f0-9]{12}$`
  - Branch name: `git check-ref-format --branch <name>` succeeds
  - Agent name: hardcoded allowlist matching Entire's documented values
  - Repo path: must resolve via `realpath` and exist on disk
- Reject otherwise with structured error.

## 8.4 Skill install trust boundary

- Skills are arbitrary code. Installing one is a trust decision.
- v1 install flow:
  1. Show source URL.
  2. Fetch and show README before any clone.
  3. Require explicit user confirmation.
  4. Never auto-install from a registry, link, or scheduled job in v1.
- Document this as the explicit trust boundary in user-facing copy.

## 8.5 Entire transcript privacy

- Entire stores prompt/response transcripts. VibeDeck reading them inherits the privacy implication.
- Default UI display: metadata-only (file list, token counts, branch, timestamp). Transcript content gated behind explicit "Show transcript" click (UI spec).
- VibeDeck's own logs **never** record transcript content. Even at `LOG_LEVEL=debug`.
- `--redact-paths` CLI flag for diagnostics export removes any path prefixes containing user-named directories.

## 8.6 No telemetry

VibeDeck has zero phone-home. Entire has its own (Posthog) which the user can disable via `entire configure --telemetry=false` (exposed as a UI toggle in the deferred UI spec).

---

# 9. Performance & operational

## 9.1 Performance budgets (v1 targets, measured & documented)

- Cold sync over 90 days of rollouts (one mid-sized user): < 30 seconds on a 2020 MacBook Air.
- `serve` baseline RSS after 24h uptime: < 200 MB.
- Live session SSE event latency: < 500 ms from rollout append to dashboard event.
- Local API read endpoint p95: < 50 ms.

These are targets, not gates; benchmarks documented in `test/perf/*.js`.

## 9.2 Streaming parser

The new parser pipeline must process rollouts as a stream, never loading whole files into memory. Byte-offset checkpoints per file (`~/.vibedeck/parser-state.jsonl`) so re-runs resume where they left off.

## 9.3 Watcher economy

- Don't watch repos with no activity in 7 days. Lazy-add when activity resumes.
- Fall back to polling when inotify saturates on Linux.
- Document the inotify `fs.inotify.max_user_watches` increase command in README.

## 9.4 SSE backpressure

- Per-client ring buffer capped at 1000 events. Drop oldest on overflow.
- Idle clients (no new HTTP-level activity for 60 min) disconnected.
- Maximum 10 concurrent SSE clients per daemon (well above any realistic single-user dashboard count).

## 9.5 SQLite

- WAL mode enabled.
- Single-writer pattern (Section 5).
- Nightly `PRAGMA integrity_check` (cron via `serve`) — log any anomaly.
- Backup on schema migration: copy DB to `db.sqlite.bak.<timestamp>` before running migrations. Keep last 3 backups.

## 9.6 Logging

- Structured JSON logs at `~/.vibedeck/logs/<date>.jsonl`. Daily rotation, compressed after 7 days, deleted after 30.
- Every session attribution decision logged: `session_id`, tier reached, confidence, branch, fallback reason. This is the primary debug surface.
- Log levels: `error | warn | info | debug`. Default `info`. Configurable via `VIBEDECK_LOG_LEVEL`.
- Never log transcript content, never log auth tokens, never log file paths from user `cwd` if `--redact-paths` is set.

## 9.7 Doctor command

`vibedeck doctor` extends TokenTracker's existing doctor with:

- Entire on PATH? Version compatible?
- Hook integrity per provider (signature check).
- Hook divergence (signature present, command path mismatched).
- Inotify watch limit (Linux only).
- DB integrity (`PRAGMA integrity_check`).
- Port availability (default 7690).
- Last sync age per provider.
- Live-session count (alerts if many `live` for >24h — orphan reaper malfunction).
- Attribution distribution: `% high / medium / low / unattributed`.

## 9.8 Diagnostics export

`vibedeck diagnostics` extends TokenTracker's existing diagnostics with all of the above as a single JSON document. Used for bug reports.

---

# 10. Test strategy

## 10.1 Unit tests

- Each branch-resolution tier (A/B/C/D) tested in isolation with mocked git + Entire.
- Each per-format hook merger: empty file → add ours; existing Entire entry → add ours preserving Entire; existing user-manual entry → preserve; remove ours → only ours removed; malformed file → abort cleanly.
- Realpath / repo-resolution edge cases (worktrees, submodules, bare, zero-commit, detached HEAD).
- Idempotency: SessionEvent insertion is `(provider, session_id)` keyed; duplicate inserts merge.
- Orphan reaper: synthetic stale `live` session → reaped to `ended_inferred`.
- Branch-window splitting: synthetic head transitions → correct pro-rata distribution.

## 10.2 Integration tests

- Real temp git repos with synthetic rollout files. Full pipeline: hooks installed → rollouts written → sync run → assert session table state, branch attribution, cost totals.
- Multi-worktree scenario: two worktrees, two parallel sessions, assert correct independent attribution.
- Submodule scenario.
- Migration scenario: pre-populated `~/.tokentracker/` → migrate → assert no data loss.

## 10.3 Golden replay

- Capture a corpus of real rollout files (anonymized) per provider.
- On every commit, parser re-runs the corpus; assert byte-identical SessionEvent output.
- Catches accidental drift in parser logic.

## 10.4 Property tests

- `forall (rollouts: RolloutSet) -> sync(rollouts) ; sync(rollouts) ; sync(rollouts) === sync(rollouts)` — idempotent.
- `forall (rollouts: RolloutSet) -> sum(session.tokens for session in sessions(rollouts)) ≤ sum(bucket.tokens for bucket in buckets(rollouts))` — sessions never invent tokens.
- `forall (rollouts: RolloutSet) -> for every session, branch_window_tokens sum to session_total_tokens (within ±1 for rounding)` — branch splitting conserves.

## 10.5 Hook collision soak test

- Generate 1000 random "existing settings.json" states with mixed Entire / user / unknown entries.
- Run merge; assert ours added, others preserved, file parses cleanly.
- Run remove; assert ours removed, others preserved.

## 10.6 Performance regression

- Capture baseline timing on cold sync of fixed corpus. CI fails if regresses > 25%.

## 10.7 Cross-platform

- Tests run on macOS + Linux runners. No Windows in v1.

---

# 11. Out of scope (explicit reminder)

For absolute clarity, the following are **not** in v1 and will not be designed in this spec:

- UI design language, color system, typography, layout, default landing view
- New dashboard components (session views, Entire panel, skill manager UI, branch cost view)
- macOS app native panel changes
- Visual rebrand assets (logo, icons, copy.csv pruning specifics)
- Agent launching, PTY, terminal streaming, React Flow graph
- AgentField, AgentBrowser, AgentMail
- Swarm, harness, unified memory, context sharing
- HITL approval flows
- Multi-step workflow runtime
- Windows support
- Cloud sync, multi-user, team mode
- Tauri desktop app

These get their own specs when v1 has shipped and earned the right to expand.

---

# 12. Open questions

These need user decisions before implementation, but do not block the spec:

1. **Final brand name.** Working name is `vibedeck`. Confirm or replace before fork commit.
2. **Cloud sync handling:** spec assumes v1 strips InsForge cloud-mode entirely (simpler than feature-flagging). Confirm.
3. **Skill registry:** v1 supports git URL + local path only. A registry is post-v1.
4. **Override CLI scope:** `vibedeck attribute --session` is confirmed. Decide whether bulk override (`--since <date>`, `--repo <path>`) ships in v1 or v1.1.
5. **Default port:** spec proposes `7690` (TokenTracker uses `7680`). Confirm.

---

# 13. Implementation roadmap

The spec is implemented across **four backend plans + one UI session**. Plan 1 is complete (fork + strip). The remaining plans are summarized below; each gets its own detailed plan document with bite-sized tasks before execution.

## Plan 2 — Storage & Schema + Entire Bridge (~20 tasks)

**Status:** next
**File:** `docs/superpowers/plans/2026-05-09-vibedeck-v1-plan-2-storage-and-entire-bridge.md`

**Schema layer:**
- Versioned migration runner (`schema_version` table, idempotent upgrades, backup before migrate)
- All `vibedeck_*` tables created: `vibedeck_sessions`, `vibedeck_session_buckets`, `vibedeck_session_branch_windows`, `vibedeck_session_entire_links`, `vibedeck_skills`, `vibedeck_head_history`, **`vibedeck_repos`** (per-repo Entire state cache)
- WAL mode enabled, single-writer pattern (writes funnel through `serve` daemon)
- Schema migrations wired into `serve` startup with backup before any change

**Entire Bridge module (`src/lib/entire-bridge.js`):**
- `detectEntire()` — PATH check via `entire version`, 60-second cache, wired into `doctor` and `serve` startup
- Direct git read of `entire/checkpoints/v1`: `listCheckpoints(repoRoot)`, `readCheckpoint(repoRoot, path)` — pure git plumbing, never spawns CLI for reads, cached by branch tip SHA
- Safe shell-outs: `enableEntire`, `disableEntire`, `agentAdd`, `agentRemove`, `getStatus`, `configure` — argv-form `execa`, 10s/30s timeouts, validated args (regex + `git check-ref-format`)
- Destructive shell-outs: `rewindCheckpoint`, `cleanEntire` — placeholder confirm-token gate (real auth wired in Plan 4)
- `getEntireRepoStatus(repoRoot)` — four-state machine (`not_installed` / `not_enabled` / `enabled_no_commits` / `active`), result persisted to `vibedeck_repos`

**Onboarding hooks:**
- `vibedeck init` extended with optional `entire login` prompt (skippable, `stdio: inherit` for the device-auth flow)
- "Entire enabled, waiting for first commit" detection and clear messaging
- Inherit Entire's existing local auth state — VibeDeck never touches Entire's credentials

**Read-only API surface (writes deferred to Plan 4 with auth):**
- `GET /functions/vibedeck-checkpoints` (proxy / direct read)
- `GET /functions/vibedeck-checkpoint/:id`
- `GET /functions/vibedeck-entire-status` (per-repo 4-state)
- Stub `POST /functions/vibedeck-entire/:cmd` defined but returns 403 until Plan 4

**Deliverable:** schema is durable, Entire bridge is functional and surfaceable via API, `vibedeck init` handles the Entire onboarding cliff. Ready for Plan 3 to write session data into the new tables.

---

## Plan 3 — Session Attribution + Hook Merger (~22 tasks)

**File:** to be written after Plan 2 ships

**Hook Merger (`src/lib/hook-merger.js`) — moved up from original sequencing because session detection depends on hooks firing correctly:**
- Per-format mergers for all 7 formats: Claude JSON, Codex TOML, Cursor JSON, Gemini JSON, Factory JSON, CodeBuddy JSON, Copilot JSON, OpenCode TS plugin
- Signature-based identification: every VibeDeck-written entry carries `_vibedeck: "v1"` field or unique command path; AST-aware merge for the OpenCode TS plugin
- Two-phase atomic installer: (1) stage all writes to `.vibedeck-staging-<uuid>` temps, validate parses, (2) atomic-rename batch with rollback on failure
- Read-merge-write contract: never overwrite malformed files; preserve Entire's, third-party, and user-manual entries; signature-only removal in `vibedeck disable`
- Hook collision soak test (1000 random states) as part of the test suite

**Session attribution (`src/lib/sessions.js`):**
- Extend each parser in `src/lib/rollout.js` to emit `SessionEvent` stream alongside existing buckets (no change to bucket math)
- Per-provider extraction tables (13 providers) with idle/end-detection rules
- Repo + worktree resolution: `realpath` → `git rev-parse --show-toplevel`, worktree handling, submodule attribution, bare/zero-commit detection, repo identity by realpath
- Branch resolution tiers A/B/C/D (Entire ground truth → live HEAD watcher → reflog → unattributed) with confidence levels stored on every session row
- Branch-window splitting: sessions that span `git checkout` get pro-rata cost across windows
- Orphan reaper: `live` sessions with no activity ≥ 30 min marked `ended_inferred`

**Live infrastructure:**
- Chokidar watcher on `.git/HEAD` and worktree HEADs across active repos (lazy-watch repos with no activity in 7 days)
- `vibedeck_head_history` persistence so live attribution survives daemon restart
- SSE endpoint: `GET /functions/vibedeck-sessions-live` streams session deltas to dashboard
- File watcher on rollout files with 200ms debounce, idempotent inserts via `(provider, session_id)` PK

**Deliverable:** every token bucket links to a session with a confidence-tagged branch attribution; live sessions stream to clients; hook collisions are a tested invariant.

---

## Plan 4 — Local Auth + API + Skills + Migration + Doctor (~16 tasks)

**File:** to be written after Plan 3 ships

**Local-auth tokens (`src/lib/local-auth.js`):**
- 32-byte random token at `~/.vibedeck/auth.token` (chmod 600), `Authorization: Bearer` middleware on all write endpoints
- Per-call destructive-confirm tokens (single-use, 30-second TTL) issued by `POST /functions/vibedeck-confirm-destructive` — required for `rewind`, `clean`, `repo migrate`
- `vibedeck auth rotate` CLI

**New write API endpoints (auth-gated):**
- `POST /functions/vibedeck-entire/:cmd` (now wired to real auth)
- `POST /functions/vibedeck-entire/rewind`, `/clean` (destructive-confirm required)
- `POST /functions/vibedeck-skills/install`, `/remove`
- `POST /functions/vibedeck-attribute` (manual session→branch override, sticky)

**Skill management (`src/lib/skills.js`) — extends existing skill listing in TokenTracker:**
- Install: from git URL or local path, target provider chosen by user; show source URL + README before clone; never auto-install; atomic-rename target dir; register skill hooks via hook-merger if applicable
- Remove: confirm before destructive delete; idempotent; rollback hook entries via hook-merger
- Audit: walk all known provider skill dirs, dedupe via realpath, last-used estimate via rollout grep (marked `(estimated)`)

**TokenTracker → VibeDeck migration:**
- First-run detection of `~/.tokentracker/`
- Prompt: Migrate / Fresh / Coexist
- Migrate path: read-only over old DB, copy to `~/.vibedeck/`, run schema migrations, best-effort tier C/D backfill of historical sessions
- Recorded decision in `~/.vibedeck/install.json`

**`vibedeck doctor` extension:**
- Hook integrity per provider (signature check)
- Entire on PATH + version compatibility + hook divergence
- Inotify limit check (Linux)
- DB integrity (`PRAGMA integrity_check`)
- Port availability
- Last sync age per provider
- Live-session count anomaly (orphan reaper malfunction signal)
- Attribution distribution (% high/medium/low/unattributed)

**New CLIs:**
- `vibedeck attribute --session <id> --branch <name>` (override)
- `vibedeck repo migrate <old-path> <new-path>` (rare; for renamed repos)

**Deliverable:** full v1 backend complete. All API endpoints functional with auth where required. Skill management works end-to-end. Existing TokenTracker users have a clear upgrade path. `doctor` reports actionable health.

---

## Plan 5 — UI session (separate spec, not in this document)

**Will be written as its own spec after Plan 4 ships.** Brief outline only:

- Three primary new views over the same attribution data model: **Live** (currently-active sessions with live token counters), **Per-branch cost** (recent branches, cost by branch with confidence indicators), **Retrospective monthly drill-down** (repo → branch → session → model)
- **Entire panel** components: checkpoint list view, checkpoint detail (with metadata-only default; transcript display gated behind explicit click), enable/disable button per repo, repo-state indicator (4-state), rewind flow with confirmation modal
- **Skill manager UI**: installed-skills table (per-provider, with origin), install dialog (URL/path input → README preview → confirm), remove dialog (destructive-confirm)
- **Confidence surfacing**: every fuzzy attribution displays a small confidence icon (high/medium/low/unattributed) — non-negotiable design rule from the attribution spec
- **Visual rebrand pass**: new color system, typography, "less is more" minimalist direction; rebranded macOS app icons + DMG identity; pruned `copy.csv` namespaces for legacy strings
- **macOS app native panel updates**: existing native panels (summary cards, heatmap, model breakdown, usage limits, Clawd companion) updated for branding; new native panels for live sessions and Entire repo state where feasible (Charts module already conditionally hidden on macOS < 13)
- **No new backend**: UI session consumes only Plan 2-4 endpoints. If a UI need exposes an API gap, that's a Plan 4 amendment, not new backend work.

**v1 ships when Plan 5 (UI) is merged.** All distribution infrastructure (npm publish, DMG release, brew tap auto-update) is already wired from Plan 1.

---

## Sequencing summary

```
Plan 1 ✅ done — fork + strip
Plan 2     — storage + Entire bridge (~20 tasks, ~2-3 days)
Plan 3     — session attribution + hook merger (~22 tasks, ~3-4 days)
Plan 4     — local auth + API + skills + migration + doctor (~16 tasks, ~2 days)
Plan 5     — UI session (separate spec; estimated 1-2 weeks)
                 ↓
              v1 ship
```

Backend plans must run sequentially: Plan 3 needs Plan 2's schema; Plan 4 needs Plan 3's session data shape. UI starts after Plan 4 because the bulk of UI value (session views) requires the full attribution data model.

---

# Appendix A — Module map

```
src/
├── lib/
│   ├── rollout.js                    # extended: emit SessionEvents
│   ├── local-api.js                  # extended: new endpoints
│   ├── usage-limits.js               # unchanged
│   ├── cursor-config.js              # unchanged
│   ├── codex-config.js               # unchanged
│   ├── opencode-config.js            # unchanged
│   ├── openclaw-session-plugin.js    # unchanged
│   ├── openclaw-hook.js              # unchanged
│   ├── subscriptions.js              # unchanged
│   ├── project-usage-purge.js        # unchanged
│   ├── upload-throttle.js            # unchanged (or removed if cloud sync stripped)
│   ├── tracker-paths.js              # extended: new ~/.vibedeck/ paths
│   ├── sessions.js                   # NEW: attribution layer
│   ├── entire-bridge.js              # NEW: Entire CLI + git read
│   ├── hook-merger.js                # NEW: collision-safe two-phase installer
│   ├── local-auth.js                 # NEW: auth tokens
│   ├── skills.js                     # NEW: install/remove/audit
│   └── head-history.js               # NEW: live HEAD watcher
├── commands/
│   ├── init.js                       # extended: new wizard, migration prompt
│   ├── sync.js                       # extended: SessionEvents, skills audit
│   ├── serve.js                      # extended: watcher + reaper
│   ├── status.js                     # extended: session/branch attribution stats
│   ├── doctor.js                     # extended: hook + Entire + DB checks
│   ├── diagnostics.js                # extended
│   ├── attribute.js                  # NEW: manual override CLI
│   ├── repo.js                       # NEW: `vibedeck repo migrate`
│   └── auth.js                       # NEW: `vibedeck auth rotate`
test/
├── (existing TokenTracker tests, retained)
├── sessions.test.js                  # NEW
├── hook-merger-claude.test.js        # NEW
├── hook-merger-codex.test.js         # NEW
├── hook-merger-cursor.test.js        # NEW
├── hook-merger-gemini.test.js        # NEW
├── hook-merger-factory.test.js       # NEW
├── hook-merger-codebuddy.test.js     # NEW
├── hook-merger-copilot.test.js       # NEW
├── hook-merger-opencode.test.js      # NEW
├── entire-bridge.test.js             # NEW
├── skills.test.js                    # NEW
├── repo-resolution.test.js           # NEW
├── branch-tier-a.test.js             # NEW
├── branch-tier-b.test.js             # NEW
├── branch-tier-c.test.js             # NEW
├── orphan-reaper.test.js             # NEW
├── branch-windows.test.js            # NEW
├── migration-from-tokentracker.test.js # NEW
└── perf/
    └── cold-sync-benchmark.js        # NEW
```

---

# Appendix B — Why we deferred the things we deferred

For the future-self / contributors who will be tempted to re-add things:

- **AgentField:** category mismatch. AgentField is a multi-agent reasoner topology runtime. v1's wrapper use cases (single CLI commands as buttons, sequential setup checks) are shell-outs, not multi-agent reasoning. Adding AgentField for them is architecture astronaut overhead. AgentField becomes appropriate when v2+ adds actual multi-agent orchestration.
- **PTY / agent launching:** v1's wedge is observability + Entire control. Launching agents is a separate, larger product surface. Trying to ship both halves nothing.
- **React Flow live graph:** purely UX; backend doesn't enable it any sooner than the UI spec does. Defer with the UI spec.
- **AgentBrowser, AgentMail:** different verticals entirely. They belong to a "VibeDeck as one-stop agent panel" v2+ vision, not v1.
- **Memory / context sharing layers (jcode, Codex-CLI-Compact):** these are valuable but each is its own integration project with its own provenance and risk. Don't bundle in v1.
- **Cloud sync:** local-first thesis. Cloud is post-v1 if at all.

---

**End of v1 backend & infrastructure design.**
