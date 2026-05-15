# Entire Dashboard Revamp Design
Date: 2026-05-15

## Goal

Revamp the dashboard `/entire` page so it feels like a product dashboard instead of a raw checkpoint file browser. The page should keep the useful metadata currently shown, but present it as accumulated checkpoint cards with clear usage, cost, model/provider breakdowns, and collapsed prompts.

The main user outcome is fast scanning: a user should be able to load a repo, understand Entire status, see checkpoint usage, inspect model/cost/token breakdowns, and open prompts or advanced details only when needed.

## Non-Goals

- Do not change destructive backend behavior for rewind or clean in this UI pass.
- Do not redesign the Entire checkpoint storage format.
- Do not remove existing data from the API response.
- Do not show raw checkpoint files as the primary interface.
- Do not expose prompt text by default.

## Current Context

The current page is crowded because repo selection, status, agent controls, configure controls, maintenance controls, checkpoint groups, file rows, and file inspectors all compete in a compact grid. The checkpoint area exposes `metadata.json`, `prompt.txt`, `full.jsonl`, and `content_hash.txt` as files, which is accurate but not the right mental model for a dashboard user.

Existing backend responses already provide enough structure for a safer frontend-first cleanup:

- `vibedeck-checkpoints` returns checkpoint file paths plus `checkpoint_usage` grouped by checkpoint id.
- `vibedeck-checkpoint` can fetch individual file payloads with parsed JSON/JSONL metadata.
- `checkpoint_usage` already includes status, confidence, branch, agent/provider, model(s), tokens, cost, cost quality, and per-file metadata summaries when available.

## Recommended Layout

Use the approved **Command Center + Timeline** layout.

The top command center contains repo loading and high-level repo state:

- Repo path selector with recent repos.
- Compact Entire status summary.
- Primary actions grouped by intent instead of squeezed into one row.
- Agent selection and configure controls presented as focused sections.
- Rewind and clean actions treated as maintenance controls, visually separated from normal enable/status actions.

The main content area becomes a checkpoint timeline:

- Each checkpoint group renders as one card.
- The card header shows checkpoint id, status, branch, agent/provider, model summary, total cost, total tokens, and cost quality.
- The body shows accumulated model/provider breakdown rows when multiple models or providers exist.
- Prompt content is collapsed by default and opens inline.
- Captured JSONL data is summarized as activity counts and signals, not raw JSON.
- Advanced details can expose raw file payloads for debugging, but stays collapsed by default.

## Checkpoint Card Data

Each checkpoint card should be built from the existing grouped file list and `checkpoint_usage`.

Primary fields:

- Checkpoint id / group id.
- Match status: linked, metadata, ambiguous, unmatched, or unknown.
- Confidence/reason when status is ambiguous or unmatched.
- Branch.
- Agent/provider.
- Top model and full model list.
- Total tokens.
- Total cost.
- Known cost and unknown-cost count when exact cost is incomplete.
- Cost quality.
- Session count.
- Session id / turn id / checkpoint id when present in metadata.

Breakdown fields:

- Per-model tokens and cost.
- Per-provider tokens and cost.
- Per-child metadata file usage where `metadata_files` exists.

Prompt fields:

- Prompt path.
- Prompt line/byte count.
- Prompt preview only after expansion.
- Raw prompt text remains hidden until user expands it.

JSONL summary fields:

- Total line count.
- Valid and invalid line count.
- Event type counts, including user, assistant, attachment, file-history-snapshot, last-prompt, permission-mode, queue-operation, system, and ai-title when present.
- Optional title if `ai-title` is present and can be extracted safely.
- Avoid rendering raw JSONL lines in the primary card.

Advanced fields:

- File list.
- Raw metadata payload.
- Raw JSONL preview.
- Content hash.
- Parse errors, if present.

## Component Structure

Keep the change bounded to the Entire dashboard surface.

- `EntirePage.jsx` owns page layout, repo loading, status loading, and checkpoint loading state.
- Replace the cramped control grid with a command-center composition made from existing control components or thin wrappers around them.
- Replace `CheckpointList` behavior with a checkpoint-card timeline component.
- Add small frontend helpers for grouping card data from existing files and usage summaries.
- Keep `CheckpointFileInspector` available only for advanced details or remove it from the primary flow if the new card component covers the needed detail surfaces.

Expected component split:

- `EntireCommandCenter`: repo selector, recent repos, status summary, and primary action grouping.
- `EntireControlPanel`: agent enable/disable/status/doctor/configure/maintenance controls in calm sections.
- `CheckpointTimeline`: ordered checkpoint cards.
- `CheckpointCard`: summary header, breakdown rows, collapsed prompt, JSONL summary, advanced details.
- `checkpoint-card-utils`: pure helper functions for deriving display rows from checkpoint files, usage, and fetched detail payloads.

## Data Flow

Initial repo load:

1. User submits or selects a repo.
2. Page fetches status and checkpoint list through existing APIs.
3. Frontend groups checkpoint files by checkpoint id.
4. Each group is rendered as a card using `checkpoint_usage` where available.

Lazy details:

1. Prompt and JSONL details are fetched only when the user expands a checkpoint section that needs them.
2. Metadata details can be fetched on expansion if `checkpoint_usage` lacks enough fields.
3. Advanced raw file details are fetched only when the user opens advanced details.

This keeps the page responsive and avoids loading large raw payloads for every checkpoint up front.

## Error and Empty States

- If a repo is not loaded, show a calm empty state in the checkpoint timeline.
- If Entire is not enabled or checkpoint branch is missing, keep the current status copy but make the next action visually obvious.
- If a checkpoint has metadata but no linked usage, show “Usage not linked” without fabricating zero-dollar cost.
- If usage is ambiguous, show the reason and confidence where available.
- If prompt or JSONL fetch fails, show a localized inline error inside that card section.
- If JSON/JSONL parse errors exist, surface them in advanced details.

## Testing

Add focused tests around the new data shaping and UI behavior:

- Group checkpoint files into one card per checkpoint.
- Preserve current metadata fields while accumulating multiple model/provider rows.
- Keep prompt content collapsed by default.
- Show JSONL event counts instead of raw JSONL in the primary card.
- Keep unmatched/ambiguous usage from showing misleading `$0.00`.
- Verify large raw payloads are not rendered unless advanced details are opened.

## Implementation Boundaries

This pass should stay UI-first. The only acceptable backend-adjacent work is small additive support if an existing parsed field is impossible to display from current responses. Backend fixes from the audit, such as destructive token validation and checkpoint hydration performance, should remain separate tasks because they carry different risk.

## Success Criteria

- `/entire` no longer presents checkpoints as a raw file tree.
- Repo load, status, agent, configure, and maintenance controls are easier to scan and not squeezed into a single dense row.
- Each checkpoint card clearly explains usage, models, cost, tokens, status, and available metadata.
- Prompt text is hidden by default.
- Raw JSONL and hashes are available only through advanced details.
- Existing user workflows still work: load repo, enable/disable, status/doctor, configure, rewind, clean, inspect checkpoint details.
