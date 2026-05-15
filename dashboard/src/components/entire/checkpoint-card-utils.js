import { formatUsdCurrency } from "../../lib/format";
import { checkpointFileLabel, groupCheckpointFiles } from "./checkpoint-file-utils";

function cleanText(value) {
  return String(value || "").trim();
}

function normalizePath(value) {
  return cleanText(value).replace(/\\/g, "/").replace(/^\/+/, "");
}

function basename(value) {
  const parts = normalizePath(value).split("/").filter(Boolean);
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
  if (value == null || String(value).trim() === "") return null;
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
    const modelLabels = uniqueLabels([usage?.model, ...modelRows.map((row) => row.label)]);

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
      models: modelLabels,
      totalTokens: numberOrNull(usage?.total_tokens),
      totalCostUsd: numberOrNull(usage?.total_cost_usd),
      knownCostUsd: numberOrNull(usage?.known_cost_usd),
      costUnknownCount: Number(usage?.cost_unknown_count || 0),
      costQuality: cleanText(usage?.cost_quality),
      sessionCount: numberOrNull(usage?.session_count) ?? 0,
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
