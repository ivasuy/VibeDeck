# VibeDeck

**Version:** 0.1.3
**Last updated:** 2026-05-18
**Tagline:** VibeDeck shows live AI coding spend across every tool you use, on your machine.

VibeDeck is a local-first dashboard that turns the raw output of your AI coding tools — Claude, Codex, Cursor, Gemini, Copilot, OpenCode, and more — into a single, real-time view of what you are spending, where that spend is going, and which projects and branches it is happening on. Nothing leaves the machine. Nothing routes through a proxy.

---

## What VibeDeck Is

VibeDeck answers four questions in one place, in real time:

1. How much am I burning on AI coding right now, this session, today?
2. Which tool is it coming from?
3. Which project is it landing on?
4. Which branch did the work actually happen on?

The product is anchored on five durable traits. Every release must keep all of them true.

| Trait | What it means in the product |
|---|---|
| **Live** | Token and cost counters tick up in the dashboard, menubar, and widgets as local tools write usage data. Nothing waits on a hosted billing refresh. |
| **Multi-provider** | Usage from many AI coding tools rolls into one local view. |
| **Local-first** | VibeDeck reads files and local databases on the user's machine. It is not a proxy and does not require routing API traffic through it. |
| **Mac-native with cross-surface access** | The Mac app, menubar, and widgets are the premier ambient surfaces. CLI and web dashboard are available wherever the backend runs. |
| **Branch-aware depth** | Project and branch attribution lets users see where AI work is landing in their engineering workflow, not just at the account level. |

---

## How It Works (One-Minute Architecture)

- **Capture.** Provider-specific readers scan local session files and SQLite databases written by each AI coding tool. Token and cost shapes are normalized per provider, with deduplication for streamed messages and cumulative-vs-delta migration safety.
- **Store.** Canonical state lives in a local SQLite database with versioned migrations. Sessions are the receipt ledger; usage events are the source-of-truth detail; rollups are derived.
- **Attribute.** Each session is mapped to a project (repo, parent worktree, or non-git folder) and each usage event is mapped to the branch HEAD was on at that moment using local git head history.
- **Surface.** A local Node server exposes the data through HTTP and Server-Sent Events. The web dashboard, Mac app, menubar, widgets, and CLI all read from the same backend.
- **Refresh.** Background sync ingests new usage as providers write it; the dashboard streams live updates without polling.

---

## Surfaces

| Surface | Purpose |
|---|---|
| Web dashboard | Primary drill-down view: active sessions, project and branch rollups, model and provider breakdowns, date drill-downs. |
| Mac app | Native shell around the dashboard, with desktop-class window management. |
| Menubar | Ambient at-a-glance totals while you work. |
| Widgets | Home-screen surface for live spend. |
| CLI (`vibedeck`) | Sync, serve, doctor, repo management, README banner sync, project README sync. |
| Embedded server | Local HTTP/SSE endpoint that every surface reads from. |

---

## Providers Supported

Active AI coding tools whose local usage or runtime state VibeDeck surfaces today:

- Claude (Code, Desktop)
- Codex / OpenAI Codex CLI / every-code
- Cursor
- Gemini CLI
- GitHub Copilot
- OpenCode
- OpenClaw
- Kiro
- Kimi
- Hermes
- Codebuddy
- OMP / Oh My Pi
- Antigravity

Provider coverage continues to grow. Each provider's token capture, pricing fidelity, and project/branch attribution quality is tracked and documented per release.

---

## Release History

Releases are listed newest-first. Each entry describes what materially changed for users: fixes, new capabilities, trust improvements, and what is still deliberately out of scope. This document is the standalone release record; readers should not need an internal roadmap to understand what a shipped version claims.

### 0.1.3 — 2026-05-18

This PR is the 0.1.3 trust-foundation release. Compared with the previous published base (`4076520`, `fix: publish cli dependencies in 0.1.2`), it ships a clearer product identity, a canonical branch-attribution pipeline, safer README banner behavior, a larger local dashboard surface, skills-browser hardening, refreshed branding, and release/test tooling.

The user-facing contract for 0.1.3 is: **VibeDeck can present live local AI coding spend with consistent project and branch attribution when the local records provide enough context, while clearly deferring deeper pricing, activity, export, and provider-support claims.**

#### Product identity and release packaging

- **Version line moved to 0.1.3.** The root package, embedded Mac server package, Homebrew formula, and native bootstrap manifest now target the 0.1.3 release.
- **README front door was rewritten around the actual product.** The public explanation now leads with live, local, multi-provider AI coding spend, Mac-native surfaces, and branch-aware depth instead of audit/team/compliance framing.
- **README claims are scoped to shipped behavior.** Branch, project, provider, checkpoint, skill, and banner claims are written as current capabilities or power-user surfaces instead of broad future promises.
- **Branding was refreshed.** The dashboard, README, Mac assets, icons, wordmarks, and generated banners now use the updated VibeDeck mark and release branding.

#### Attribution truth

- **Branch totals now come from a canonical projection.** The new branch-usage facts layer materializes per-branch usage from recorded events, then feeds live workstream groups, project rollups, branch reports, and branch pages from the same source.
- **Branch spend is usage-based, not elapsed-time-based.** If a session crosses branches, cost and tokens are assigned to the branch where usage actually occurred. Branch slices sum back to the session total.
- **Historical sessions are repaired during sync.** Sessions with missing repo/project metadata are re-resolved when their original folder exists again or later becomes a git repository.
- **Project attribution states are explicit.** Git projects, existing non-git folders, deleted folders, and genuinely unattributed sessions are separated so VibeDeck stops silently hiding resolvable local work.
- **Branch fact rebuilds are idempotent.** The projection can be rebuilt from the recorded ledger and should produce stable branch totals.

#### Dashboard correctness and drill-downs

- **Per-branch drawer cards now show the right slice.** A session that contributed to two branches no longer appears with the full session total under each branch; each branch group shows only its own token and cost slice.
- **Branch drill-downs gained date buckets.** Branch pages can break usage into per-day session rollups with model and provider details.
- **Live branch UX was tightened.** Active, recently completed, and stale branch states are labeled more clearly, with fewer transient empty states while sync and live refresh run concurrently.
- **Project and dashboard rollups now use last-good data where appropriate.** Loading behavior is less jumpy when a sync is rebuilding or a request briefly returns empty.

#### README banner controls

- **GitHub/profile README banner updates are opt-in.** `vibedeck sync` and `vibedeck serve` no longer push banner updates to GitHub. Profile README updates happen only through `vibedeck readme-sync update`.
- **Project README banners are local-only.** `vibedeck project-readme-sync` writes `project-readme-banner.svg` beside the current project's README and refreshes a managed Project Usage block without a GitHub token or GitHub API call.
- **Banner rendering was polished.** Profile and project banners now have clearer token suffixes, progress treatment, and snapshot context.

#### Power-user dashboard surfaces

- **Entire dashboard was rebuilt into a richer command surface.** The release adds checkpoint cards, checkpoint timelines, command-center controls, command output panels, and clearer maintenance/configuration panels.
- **Checkpoint inspection is safer and more useful.** Checkpoint prompt/activity/metadata previews are grouped, summarized, capped, and loaded through hardened local file validation.
- **Entire configuration edge cases were fixed.** Configure arguments are parsed more safely, Windows-style backslashes are preserved, checkpoint path validation is stricter, and repo state cache hits now prefer exact matches before aliases.

#### Skills and integration management

- **Skills browsing is faster and less noisy.** Repository skill catalogs can be cached, warmed, paginated locally, and filtered without refetching every page.
- **Installed-skill state is more accurate.** The dashboard uses installed keys from the API and shows install buttons, busy states, and target toggles more consistently.
- **Repository skill sources are easier to manage.** Adding or removing a source invalidates only the relevant catalog cache and can immediately browse the selected repository.
- **Unreachable skill repositories do not poison the whole catalog.** The all-repo catalog remains usable when one registered source fails.
- **Serve and manual sync can warm skill metadata.** `serve` warms the skill metadata index before the regular sync loop, and manual `sync` can refresh the index outside auto mode.

#### Release and runtime hardening

- **Serve and sync lifecycle behavior was hardened.** The release adds progress surfaces, shutdown coverage, rebuild policy tests, and protections around sync-triggered side effects.
- **The test suite was expanded around the new trust contract.** New coverage includes branch usage facts, project usage summaries, project README sync, banner rendering, live rollups, Entire checkpoint UI, skills caching/install state, static serving, and lifecycle shutdown paths.
- **Internal agent-run scaffolding was added.** Codex-org prompts, scripts, workflow defaults, and role contracts were added for autonomous phase execution. This is release infrastructure, not a user-facing analytics feature.

#### Roadmap-comparable status

| Area | 0.1.3 status | What can be claimed |
|---|---|---|
| Product identity and README anchor | Shipped | VibeDeck is positioned as live, local, multi-provider AI coding spend with Mac-native surfaces and branch-aware depth. |
| Attribution core | Shipped | Resolvable sessions appear in project/branch views, branch totals are canonical, and cross-branch sessions split by usage activity. |
| Provider attribution support tiers | Not shipped | Provider support is still mixed; this release does not claim every provider has full project or branch attribution. |
| Core dollar correctness | Not shipped | Known pricing gaps remain for long-lived cache writes, web search charges, fuzzy model matches, and paid-plan billing models. |
| Ledger hardening and rebuild parity | Partial | Branch fact rebuilds are covered; broader negative-update diagnostics and bucket reconciliation remain future work. |
| Reports, exports, activity labels, compare/context/plan, optimize/yield | Not shipped | No new model comparison, full CSV/JSON export suite, turn/tool capture, activity classification, waste scanner, or one-shot metric is claimed. |
| Provider breadth | Not shipped | This release does not add a new usage-ingestion provider. |

#### What this release deliberately does **not** add

The current release improves the trust foundation and local operations. These items remain deferred:

- Full provider attribution tiers for Cursor, Gemini, Copilot, Kimi, OMP, Hermes, OpenClaw, and other weak-context providers.
- Claude long-lived cache pricing, server-side web-search billing, fuzzy model pricing guardrails, premium-request billing, and paid-plan exactness.
- Per-call activity, tool, MCP, shell, or edit-attempt breakdowns.
- Activity labels, task categories, "one-shot rate", productivity scoring, waste scanners, or yield signals.
- Model comparison, context-window pressure, and plan/quota decision support.
- A full CSV/JSON export and models-report release.
- New provider ingestion beyond the providers and runtime states already surfaced.
- Hosted/team sharing, cloud sync, prompt inspection, or proxy behavior.

---

## Honesty Rules

VibeDeck only claims what shipped releases make true.

- Branch totals agree across branch-aware surfaces that read the 0.1.3 branch facts projection.
- Sessions whose local project path becomes resolvable later are repaired instead of staying permanently hidden.
- Provider attribution remains mixed. If a provider does not expose recoverable project or branch context, VibeDeck must not imply full attribution.
- Provider pricing is best-effort against a curated snapshot. Where the source data does not expose a charge (for example, server-side web search), the dashboard does not invent one.
- Cursor "Auto" model usage and subscription-style billing are surfaced as estimates, not exact charges.
- GitHub/profile README banner writes are opt-in. Local project README banner writes stay local and do not require GitHub credentials.

---

## Non-Goals

These are load-bearing. They define what VibeDeck will not become.

- Not a hosted service.
- Not a team-sharing product. Sharing happens through export, screenshots, or the local README banner.
- Not an audit or compliance platform.
- Not a prompt-inspection product.
- Not a productivity coach.
- Not a proxy. Users never need to route AI traffic through VibeDeck.

---

## Versioning And Release Cadence

- **Version line:** semantic versioning at the package level (`vibedeck-cli`). Patch releases for fixes and small surface polish; minor releases when new capability ships behind a flag or as a new endpoint; major when a load-bearing contract changes.
- **Release notes:** every release appends one section to this document, newest at the top. Each release section describes the user-visible change, the trust improvement behind it, and what was deliberately deferred.
- **README contract:** the project README must only make claims that the most recent release in this document supports.

---

## Reading This Document

If you are evaluating VibeDeck for the first time, read the top three sections — what it is, how it works, and the surfaces — and then the latest release entry. Together they describe the product as it stands today.

If you are upgrading, read the latest release entry first. Anything older is historical context.

If you are contributing, the latest release entry tells you what trust contract the current code is expected to honor, and what work has been deliberately scoped out.
