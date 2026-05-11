const PREFIX = "vibedeck:entire";

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch {
    return null;
  }
}

export function entireStorageKey(kind, repo) {
  const cleanKind = String(kind || "").trim();
  const cleanRepo = String(repo || "").trim();
  if (!cleanKind || !cleanRepo) return "";
  return `${PREFIX}:${cleanKind}:${cleanRepo}`;
}

export function readEntirePrefs(kind, repo) {
  const key = entireStorageKey(kind, repo);
  const target = storage();
  if (!key || !target) return null;
  try {
    const raw = target.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function writeEntirePrefs(kind, repo, value) {
  const key = entireStorageKey(kind, repo);
  const target = storage();
  if (!key || !target) return false;
  try {
    target.setItem(key, JSON.stringify(value || {}));
    return true;
  } catch {
    return false;
  }
}
