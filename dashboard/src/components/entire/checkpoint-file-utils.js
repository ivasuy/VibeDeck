function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function basename(value) {
  const parts = normalizePath(value).split("/").filter(Boolean);
  return parts.at(-1) || "";
}

function parentName(value) {
  const parts = normalizePath(value).split("/").filter(Boolean);
  return parts.length > 1 ? parts.at(-2) : "";
}

export function checkpointGroupId(filePath) {
  const parts = normalizePath(filePath).split("/").filter(Boolean);
  if (parts.length >= 2 && /^[a-f0-9]{2}$/i.test(parts[0])) return `${parts[0]}/${parts[1]}`;
  if (parts.length >= 1) return parts[0];
  return "unknown";
}

export function checkpointFileLabel(filePath) {
  const name = basename(filePath);
  if (name === "metadata.json") return "Metadata";
  if (name === "full.jsonl") return "JSONL";
  if (name === "prompt.txt") return "Prompt";
  if (name === "content_hash.txt") return "Hash";
  if (name.endsWith(".json")) return "JSON";
  if (name.endsWith(".jsonl")) return "JSONL";
  if (name.endsWith(".txt")) return "Text";
  return "File";
}

export function checkpointFileIconName(filePath) {
  const name = basename(filePath);
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".jsonl")) return "jsonl";
  if (name === "content_hash.txt") return "hash";
  if (name.endsWith(".txt")) return "text";
  return "file";
}

export function groupCheckpointFiles(files) {
  const byId = new Map();
  const order = {
    "metadata.json": 0,
    "prompt.txt": 1,
    "full.jsonl": 2,
    "content_hash.txt": 3,
  };

  for (const filePath of Array.isArray(files) ? files : []) {
    const clean = normalizePath(filePath);
    if (!clean) continue;
    const id = checkpointGroupId(clean);
    if (!byId.has(id)) byId.set(id, { id, label: id, files: [] });
    byId.get(id).files.push(clean);
  }

  return Array.from(byId.values()).map((group) => ({
    ...group,
    files: group.files.sort((a, b) => {
      const aOrder = order[basename(a)] ?? 10;
      const bOrder = order[basename(b)] ?? 10;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.localeCompare(b);
    }),
  }));
}

export function repoChipParts(repoPath) {
  const fullPath = String(repoPath || "").trim();
  return {
    name: basename(fullPath) || fullPath,
    context: parentName(fullPath),
    fullPath,
  };
}
