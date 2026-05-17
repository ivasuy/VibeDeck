type LastGoodEnvelope<T> = {
  savedAt: string;
  value: T;
};

const PREFIX = "vibedeck.lastGood.";
const memory = new Map<string, LastGoodEnvelope<unknown>>();

function fullKey(key: string) {
  return `${PREFIX}${String(key || "").trim()}`;
}

function storage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage || null;
  } catch (_e) {
    return null;
  }
}

function validEnvelope<T>(value: unknown): value is LastGoodEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.savedAt === "string" && "value" in record;
}

export function readLastGood<T>(key: string): T | null {
  const resolvedKey = fullKey(key);
  const store = storage();
  if (!store) {
    const cached = memory.get(resolvedKey);
    return validEnvelope<T>(cached) ? cached.value : null;
  }
  try {
    const raw = store.getItem(resolvedKey);
    if (!raw) {
      memory.delete(resolvedKey);
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!validEnvelope<T>(parsed)) return null;
    memory.set(resolvedKey, parsed);
    return parsed.value;
  } catch (_e) {
    return null;
  }
}

export function writeLastGood<T>(key: string, value: T) {
  const resolvedKey = fullKey(key);
  const envelope: LastGoodEnvelope<T> = {
    savedAt: new Date().toISOString(),
    value,
  };
  memory.set(resolvedKey, envelope);

  const store = storage();
  if (!store) return;
  try {
    store.setItem(resolvedKey, JSON.stringify(envelope));
  } catch (_e) {
    // Storage can fail in private windows or when quota is exceeded.
  }
}

export function clearLastGood(key: string) {
  const resolvedKey = fullKey(key);
  memory.delete(resolvedKey);
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(resolvedKey);
  } catch (_e) {
    // Ignore storage errors.
  }
}

export function clearAllLastGoodForTests() {
  memory.clear();
}
