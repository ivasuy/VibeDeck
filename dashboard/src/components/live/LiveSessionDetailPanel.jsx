import React from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { toDisplayNumber } from "../../lib/format";
import {
  ConfidenceBar,
  CostTokenPair,
  EmptyStatePanel,
  IconBadge,
  ProjectIdentity,
  ProviderModelChips,
} from "../../ui/ops";
import { ConfidenceBadge } from "./ConfidenceBadge";

function normalizeConfidence(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "high" || key === "medium" || key === "low") return key;
  return "unattributed";
}

function formatTimestamp(value) {
  if (!value) return copy("live.value.unknown_time");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionCostValue(row) {
  const costQuality = String(row?.cost_quality || "");
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(costQuality)) return null;
  const preferredCost = row?.estimated_total_cost_usd ?? row?.total_cost_usd;
  if (preferredCost == null || preferredCost === "") return null;
  const numeric = Number(preferredCost);
  return Number.isFinite(numeric) ? numeric : null;
}

function sessionUpdatedAt(row) {
  return row?.updated_at || row?.last_observed_at || row?.observed_at || row?.started_at || row?.ended_at || null;
}

function sessionState(row) {
  const raw = typeof row?.state === "string" ? row.state.trim().toLowerCase() : "";
  if (raw === "active") return copy("live.state.active");
  if (raw === "ended") return copy("live.state.ended");
  if (raw === "live") return copy("live.state.live");
  if (raw) return copy("live.state.unknown");
  return row?.ended_at ? copy("live.state.ended") : copy("live.state.live");
}

function DetailItem({ label, value }) {
  return (
    <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-3 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        {label}
      </div>
      <div className="mt-1 text-sm text-oai-gray-700 dark:text-oai-gray-200">{value}</div>
    </div>
  );
}

export function LiveSessionDetailPanel({ session }) {
  if (!session) {
    return (
      <EmptyStatePanel
        accent="live"
        title={copy("live.detail.empty_title")}
        description={copy("live.detail.empty_description")}
      />
    );
  }

  const confidence = normalizeConfidence(session?.confidence);
  const repoRoot = String(session?.repo_root || session?.cwd || "").trim();
  const branch = String(session?.branch || "").trim() || copy("live.value.unattributed_branch");
  const provider = String(session?.provider || copy("live.value.unknown_provider"));
  const model = String(session?.model || "—");
  const sessionId = String(session?.session_id || "—");
  const cost = sessionCostValue(session);

  return (
    <Card bodyClassName="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconBadge accent="live" label={copy("live.detail.title")} decorative />
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("live.detail.title")}
            </h2>
          </div>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {copy("live.detail.subtitle")}
          </p>
        </div>
        <ConfidenceBadge confidence={confidence} className="shrink-0" />
      </div>

      <ProjectIdentity repoRoot={repoRoot || copy("live.workbench.project.unknown_repo")} />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DetailItem label={copy("live.meta.model")} value={model} />
        <DetailItem label={copy("live.detail.provider")} value={provider} />
        <DetailItem label={copy("live.detail.session")} value={sessionId} />
        <DetailItem label={copy("live.override.meta.current_branch")} value={branch} />
      </div>

      <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-4 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("live.detail.session_health")}
          </div>
          <CostTokenPair
            cost={cost}
            tokens={session?.total_tokens ?? 0}
            estimated={Boolean(session?.cost_estimated)}
            className="justify-end"
          />
        </div>
        <ConfidenceBar
          confidence={{
            high: confidence === "high" ? 1 : 0,
            medium: confidence === "medium" ? 1 : 0,
            low: confidence === "low" ? 1 : 0,
            unattributed: confidence === "unattributed" ? 1 : 0,
          }}
          ariaLabel={copy("live.detail.confidence_aria", { session: sessionId })}
        />
      </div>

      <ProviderModelChips
        items={[
          {
            provider,
            model,
            total_tokens: session?.total_tokens ?? 0,
          },
        ]}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <DetailItem label={copy("live.meta.started")} value={formatTimestamp(session?.started_at)} />
        <DetailItem label={copy("live.meta.updated")} value={formatTimestamp(sessionUpdatedAt(session))} />
        <DetailItem label={copy("live.meta.state")} value={sessionState(session)} />
        <DetailItem
          label={copy("live.meta.tokens")}
          value={toDisplayNumber(session?.total_tokens ?? 0)}
        />
      </div>
    </Card>
  );
}
