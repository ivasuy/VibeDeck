import { getLocalApiAuthHeaders } from "./local-api-auth";

type AnyRecord = Record<string, any>;

const SLUG = "vibedeck-skills";

async function fetchSkillsJson(params?: AnyRecord) {
  const url = new URL(`/functions/${SLUG}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function mutateSkillsJson(body: AnyRecord, cmd: string) {
  const authHeaders = await getLocalApiAuthHeaders();
  const response = await fetch(`/functions/${SLUG}/${cmd}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

export function getInstalledSkills(
  options: { offset?: number; limit?: number; q?: string } = {},
) {
  return fetchSkillsJson({ mode: "installed", ...options });
}

export function discoverSkills(
  options: { force?: boolean; offset?: number; limit?: number; source?: string; q?: string } = {},
) {
  const { force, ...rest } = options;
  return fetchSkillsJson({ mode: "discover", ...(force ? { force: 1 } : {}), ...rest });
}

export function searchSkills(query: string, offset = 0, limit = 20) {
  return fetchSkillsJson({ mode: "search", q: query, offset, limit });
}

export function getSkillRepos() {
  return fetchSkillsJson({ mode: "repos" });
}

export function installSkill(skill: AnyRecord, targets: string[]) {
  return mutateSkillsJson({ skill, targets }, "install");
}

export function uninstallSkill(id: string) {
  return mutateSkillsJson({ id }, "uninstall");
}

export function restoreSkill(id: string) {
  return mutateSkillsJson({ id }, "restore");
}

export function setSkillTargets(id: string, targets: string[]) {
  return mutateSkillsJson({ id, targets }, "setTargets");
}

export function importLocalSkill(directory: string, targets: string[]) {
  return mutateSkillsJson({ directory, targets }, "importLocal");
}

export function deleteLocalSkill(directory: string, targets?: string[]) {
  return mutateSkillsJson({ directory, targets: targets || [] }, "deleteLocal");
}

export function addSkillRepo(repo: AnyRecord) {
  return mutateSkillsJson({ repo }, "addRepo");
}

export function removeSkillRepo(owner: string, name: string) {
  return mutateSkillsJson({ owner, name }, "removeRepo");
}
