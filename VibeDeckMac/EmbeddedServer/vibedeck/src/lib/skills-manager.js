const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_REPOS = [
  { owner: "anthropics", name: "skills", branch: "main", enabled: true },
  { owner: "ComposioHQ", name: "awesome-claude-skills", branch: "master", enabled: true },
  { owner: "cexll", name: "myclaude", branch: "master", enabled: true },
  { owner: "JimLiu", name: "baoyu-skills", branch: "main", enabled: true },
];

const TARGETS = {
  claude: { id: "claude", label: "Claude", dir: () => path.join(os.homedir(), ".claude", "skills") },
  codex: { id: "codex", label: "Codex", dir: () => path.join(os.homedir(), ".codex", "skills") },
  gemini: { id: "gemini", label: "Gemini", dir: () => path.join(os.homedir(), ".gemini", "skills") },
  opencode: { id: "opencode", label: "OpenCode", dir: () => path.join(os.homedir(), ".config", "opencode", "skills") },
  hermes: { id: "hermes", label: "Hermes", dir: () => path.join(os.homedir(), ".hermes", "skills") },
  agents: { id: "agents", label: "Agents", visible: false, dir: () => path.join(os.homedir(), ".agents", "skills") },
};

const FETCH_TIMEOUT_MS = 20_000;
const DISCOVER_METADATA_TIMEOUT_MS = 1_500;
const DISCOVER_CONCURRENCY = 4;
const DISCOVER_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const OWNER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const discoverWarmTasks = new Map();

class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
    this.code = "RATE_LIMITED";
    this.status = 429;
  }
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function runNext() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  const pool = new Array(Math.min(limit, items.length)).fill(0).map(runNext);
  await Promise.all(pool);
  return results;
}

function dataDir() {
  return path.join(os.homedir(), ".vibedeck", "skills");
}

function registryPath() {
  return path.join(dataDir(), "registry.json");
}

function ssotDir() {
  return path.join(dataDir(), "managed");
}

function trashDir() {
  return path.join(dataDir(), ".trash");
}

const TRASH_TTL_MS = 5 * 60 * 1000; // 5 minutes

function discoverCachePath() {
  return path.join(dataDir(), "discover-cache.json");
}

function discoverRepoCacheDir() {
  return path.join(dataDir(), "discover-cache");
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (_e) {
    return fallback;
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function readRegistry() {
  const registry = readJson(registryPath(), null);
  if (registry && typeof registry === "object") {
    return {
      repos: Array.isArray(registry.repos) ? registry.repos : DEFAULT_REPOS,
      skills: Array.isArray(registry.skills) ? registry.skills : [],
    };
  }
  return { repos: DEFAULT_REPOS, skills: [] };
}

function saveRegistry(registry) {
  writeJson(registryPath(), registry);
}

function sanitizePathSegment(value) {
  const segment = String(value || "").trim();
  if (!segment || segment === "." || segment === "..") return null;
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) return null;
  return segment;
}

function sanitizeRelativePath(value) {
  const raw = String(value || "").replace(/\\/g, "/").trim();
  if (!raw || raw.startsWith("/") || raw.includes("\0")) return null;
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

function installNameFromDirectory(directory) {
  const safe = sanitizeRelativePath(directory);
  if (!safe) return null;
  return sanitizePathSegment(safe.split("/").pop());
}

function targetList() {
  return Object.values(TARGETS)
    .filter((target) => target.visible !== false)
    .map((target) => ({
      id: target.id,
      label: target.label,
      path: target.dir(),
    }));
}

function readSkillMetadata(markdown, fallbackName) {
  const raw = String(markdown || "");
  const frontmatter = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  const source = frontmatter ? frontmatter[1] : raw;
  const nameMatch = source.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  const descriptionMatch = source.match(/^description:\s*["']?([\s\S]+?)["']?\s*$/m);
  return {
    name: (nameMatch?.[1] || fallbackName || "Skill").trim(),
    description: (descriptionMatch?.[1] || "").replace(/\n\s+/g, " ").trim(),
  };
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "vibedeck-skills",
      },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status === 403) {
      throw new RateLimitError(`GitHub rate-limited this request (HTTP ${response.status}). Try again later.`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: "text/plain", "User-Agent": "vibedeck-skills" },
      signal: controller.signal,
    });
    if (response.status === 429 || response.status === 403) {
      throw new RateLimitError(`GitHub rate-limited this request (HTTP ${response.status}). Try again later.`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function githubRawUrl(owner, name, branch, filePath) {
  return `https://raw.githubusercontent.com/${owner}/${name}/${branch}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

function githubDocUrl(owner, name, branch, filePath) {
  return `https://github.com/${owner}/${name}/blob/${branch}/${filePath
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function getRepoTree(repo) {
  const branches = [];
  if (repo.branch && !String(repo.branch).match(/^head$/i)) branches.push(repo.branch);
  if (!branches.includes("main")) branches.push("main");
  if (!branches.includes("master")) branches.push("master");

  let lastError = null;
  for (const branch of branches) {
    try {
      const data = await fetchJson(
        `https://api.github.com/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
      );
      if (Array.isArray(data?.tree)) return { branch, tree: data.tree };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to read ${repo.owner}/${repo.name}`);
}

function buildSkillKey(skill) {
  return `${skill.repoOwner}/${skill.repoName}:${skill.directory}`;
}

function normalizePagination({ offset = 0, limit = 10 } = {}, { defaultLimit = 10, maxLimit = 50 } = {}) {
  const normalizedLimit = Number(limit);
  const normalizedOffset = Number(offset);
  return {
    offset: Number.isFinite(normalizedOffset) && normalizedOffset > 0 ? Math.trunc(normalizedOffset) : 0,
    limit:
      Number.isFinite(normalizedLimit) && normalizedLimit > 0
        ? Math.max(1, Math.min(maxLimit, Math.trunc(normalizedLimit)))
        : defaultLimit,
  };
}

function pageItems(items, pagination) {
  return items.slice(pagination.offset, pagination.offset + pagination.limit);
}

function matchesSkillQuery(skill, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return [
    skill?.name,
    skill?.directory,
    skill?.description,
    skill?.repoOwner,
    skill?.repoName,
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

function buildInstalledKeys(skills) {
  const keys = new Set();
  for (const skill of skills) {
    if (skill?.repoOwner && skill?.repoName) {
      keys.add(buildSkillKey(skill).toLowerCase());
      keys.add(`${skill.repoOwner}/${skill.repoName}:${skill.sourceDirectory || skill.directory}`.toLowerCase());
    }
    const tail = String(skill?.directory || "").split(/[\\/]/).pop().toLowerCase();
    if (tail) keys.add(`dir:${tail}`);
  }
  return Array.from(keys).sort();
}

function normalizeRepo(repo) {
  return {
    owner: String(repo?.owner || "").trim(),
    name: String(repo?.name || "").trim(),
    branch: String(repo?.branch || "main").trim() || "main",
    enabled: repo?.enabled !== false,
  };
}

function validateRepoInput(repoInput) {
  const repo = normalizeRepo(repoInput);
  if (!repo.owner || !repo.name) throw new Error("Repository owner and name are required");
  if (!OWNER_NAME_PATTERN.test(repo.owner) || !OWNER_NAME_PATTERN.test(repo.name)) {
    throw new Error("Repository owner and name may only contain letters, digits, '.', '_', or '-'");
  }
  if (!OWNER_NAME_PATTERN.test(repo.branch)) {
    throw new Error("Repository branch contains unsupported characters");
  }
  return repo;
}

function repoReadError(repo) {
  return new Error(
    `Unable to read GitHub repository ${repo.owner}/${repo.name}. Check the owner/repository name and that it is public.`,
  );
}

async function discoverRepoSkills(repoInput) {
  const entries = await discoverRepoSkillEntries(repoInput);
  const skills = await mapWithConcurrency(entries, DISCOVER_CONCURRENCY, hydrateDiscoverSkill);
  return skills.filter(Boolean);
}

async function discoverRepoSkillEntries(repoInput) {
  const repo = normalizeRepo(repoInput);
  if (!repo.owner || !repo.name || !repo.enabled) return [];
  const { branch, tree } = await getRepoTree(repo);
  return tree
    .filter((entry) => entry?.type === "blob" && /(^|\/)SKILL\.md$/i.test(entry.path || ""))
    .slice(0, 200)
    .map((entry) => {
      const docPath = entry.path.replace(/\\/g, "/");
      const directory = docPath.endsWith("/SKILL.md") ? docPath.slice(0, -"/SKILL.md".length) : repo.name;
      const installName = installNameFromDirectory(directory || repo.name);
      if (!installName) return null;
      return {
        key: `${repo.owner}/${repo.name}:${directory || repo.name}`,
        name: installName,
        description: "",
        directory: directory || repo.name,
        readmeUrl: githubDocUrl(repo.owner, repo.name, branch, docPath),
        repoOwner: repo.owner,
        repoName: repo.name,
        repoBranch: branch,
        docPath,
        sha: entry.sha || "",
        metadataHydrated: false,
      };
    })
    .filter(Boolean);
}

async function hydrateDiscoverSkill(entry) {
  if (!entry) return null;
  const installName = installNameFromDirectory(entry.directory || entry.repoName);
  if (!installName) return null;
  let metadata = { name: entry.name || installName, description: entry.description || "" };
  let metadataHydrated = false;
  try {
    metadata = readSkillMetadata(
      await fetchText(
        githubRawUrl(entry.repoOwner, entry.repoName, entry.repoBranch, entry.docPath),
        DISCOVER_METADATA_TIMEOUT_MS,
      ),
      installName,
    );
    metadataHydrated = true;
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    // Keep the skill discoverable even if metadata fetch fails.
  }
  return {
    ...entry,
    name: metadata.name,
    description: metadata.description,
    metadataHydrated,
  };
}

function buildCachedSkillMap(cache) {
  const map = new Map();
  const skills = Array.isArray(cache?.skills) ? cache.skills : [];
  for (const skill of skills) {
    if (!skill?.repoOwner || !skill?.repoName || !skill?.directory) continue;
    map.set(buildSkillKey(skill).toLowerCase(), skill);
  }
  return map;
}

function canReuseCachedSkill(cached, entry) {
  if (!cached || cached.metadataHydrated === false) return false;
  if (entry.sha && cached.sha && entry.sha !== cached.sha) return false;
  return true;
}

async function hydrateDiscoverCatalog(entries, cache) {
  const cachedByKey = buildCachedSkillMap(cache);
  const hydrated = await mapWithConcurrency(entries, DISCOVER_CONCURRENCY, async (entry) => {
    const cached = cachedByKey.get(buildSkillKey(entry).toLowerCase());
    if (canReuseCachedSkill(cached, entry)) {
      return {
        ...entry,
        name: cached.name,
        description: cached.description,
        metadataHydrated: cached.metadataHydrated !== false,
      };
    }
    return hydrateDiscoverSkill(entry);
  });
  return dedupeSkills(hydrated.filter(Boolean));
}

function mergeCachedDiscoverMetadata(entries, cache) {
  const cachedByKey = buildCachedSkillMap(cache);
  return dedupeSkills(entries.map((entry) => {
    const cached = cachedByKey.get(buildSkillKey(entry).toLowerCase());
    if (!canReuseCachedSkill(cached, entry)) return entry;
    return {
      ...entry,
      name: cached.name,
      description: cached.description,
      metadataHydrated: cached.metadataHydrated !== false,
    };
  }));
}

function mergeDiscoverSkills(baseSkills, hydratedSkills) {
  const byKey = new Map();
  for (const skill of baseSkills || []) {
    if (skill?.repoOwner && skill?.repoName && skill?.directory) {
      byKey.set(buildSkillKey(skill).toLowerCase(), skill);
    }
  }
  for (const skill of hydratedSkills || []) {
    if (skill?.repoOwner && skill?.repoName && skill?.directory) {
      byKey.set(buildSkillKey(skill).toLowerCase(), skill);
    }
  }
  return dedupeSkills(Array.from(byKey.values()));
}

function metadataComplete(skills) {
  return Array.isArray(skills) && skills.every((skill) => skill.metadataHydrated !== false);
}

function dedupeSkills(skills) {
  const byKey = new Map();
  for (const skill of skills) byKey.set(buildSkillKey(skill).toLowerCase(), skill);
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function repoFingerprint(repo) {
  const normalized = normalizeRepo(repo);
  return `${normalized.owner}/${normalized.name}@${normalized.branch}`;
}

function repoCacheFile(repo) {
  const key = repoFingerprint(repo).replace(/[^A-Za-z0-9._-]+/g, "__");
  return path.join(discoverRepoCacheDir(), `${key}.json`);
}

function validateDiscoverCache(data, fingerprint) {
  if (!data || typeof data !== "object") return null;
  if (!Array.isArray(data.skills) && !Array.isArray(data.entries)) return null;
  if (data.fingerprint !== fingerprint) return null;
  if (!Number.isFinite(data.generatedAt)) return null;
  if (Date.now() - data.generatedAt > DISCOVER_CACHE_TTL_MS) return null;
  return data;
}

function readLegacyDiscoverCache(fingerprint) {
  return validateDiscoverCache(readJson(discoverCachePath(), null), fingerprint);
}

function readRepoDiscoverCache(repo) {
  return validateDiscoverCache(readJson(repoCacheFile(repo), null), repoFingerprint(repo));
}

function writeRepoDiscoverCache(repo, payload) {
  writeJson(repoCacheFile(repo), { fingerprint: repoFingerprint(repo), generatedAt: Date.now(), ...payload });
}

function readCombinedDiscoverCache(repos, fingerprint) {
  if (!Array.isArray(repos) || repos.length === 0) return readLegacyDiscoverCache(fingerprint);
  const caches = repos.map(readRepoDiscoverCache);
  if (caches.every(Boolean)) {
    const entries = dedupeSkills(caches.flatMap((cache) => (Array.isArray(cache.entries) ? cache.entries : [])));
    const skills = dedupeSkills(caches.flatMap((cache) => (Array.isArray(cache.skills) ? cache.skills : [])));
    return {
      fingerprint,
      generatedAt: Math.min(...caches.map((cache) => cache.generatedAt)),
      entries,
      skills,
    };
  }
  return readLegacyDiscoverCache(fingerprint);
}

function writeRepoCachesFromCatalog(repos, entries, skills) {
  for (const repo of repos) {
    const repoKey = `${repo.owner}/${repo.name}`;
    const repoEntries = dedupeSkills((entries || []).filter((entry) => `${entry.repoOwner}/${entry.repoName}` === repoKey));
    if (!repoEntries.length) continue;
    const repoSkills = mergeDiscoverSkills(
      repoEntries,
      (skills || []).filter((skill) => `${skill.repoOwner}/${skill.repoName}` === repoKey),
    );
    writeRepoDiscoverCache(repo, { entries: repoEntries, skills: repoSkills });
  }
}

function invalidateRepoDiscoverCache(repo) {
  try {
    fs.rmSync(repoCacheFile(repo), { force: true });
  } catch (_e) {
    // ignore
  }
}

function normalizeDiscoverSource(source) {
  const value = String(source || "").trim();
  if (!value || value === "all") return "";
  return value;
}

function filterDiscoveredSkills(skills, { source = "", q = "" } = {}) {
  const selectedSource = normalizeDiscoverSource(source);
  return skills.filter((skill) => {
    if (selectedSource && `${skill.repoOwner}/${skill.repoName}` !== selectedSource) return false;
    return matchesSkillQuery(skill, q);
  });
}

async function discoverSkills({ all = false, force = false, offset = 0, limit = 10, source = "all", q = "" } = {}) {
  const pagination = normalizePagination({ offset, limit }, { defaultLimit: 10, maxLimit: 50 });
  const { enabled, selectedSource, fingerprint } = discoverContext(source);
  if (!enabled.length) {
    return {
      skills: [],
      totalCount: 0,
      offset: pagination.offset,
      limit: pagination.limit,
      cached: false,
      generatedAt: Date.now(),
    };
  }

  let cached = readCombinedDiscoverCache(enabled, fingerprint);

  if (all && (!cached || !metadataComplete(cached.skills))) {
    await warmDiscoverCatalog({ force, source });
    cached = readCombinedDiscoverCache(enabled, fingerprint);
  }

  if (all && cached && Array.isArray(cached.skills) && metadataComplete(cached.skills)) {
    const sourceEntries = filterDiscoveredSkills(cached.skills, { source, q: "" });
    const filtered = sourceEntries.filter((skill) => matchesSkillQuery(skill, q));
    return {
      skills: filtered,
      totalCount: filtered.length,
      offset: 0,
      limit: filtered.length,
      cached: !force,
      generatedAt: cached.generatedAt,
      emptyReason: selectedSource && sourceEntries.length === 0 ? "no_skill_files" : "",
      metadataComplete: true,
    };
  }

  if (!force) {
    if (cached?.entries) {
      const catalog = mergeCachedDiscoverMetadata(dedupeSkills(cached.entries), cached);
      const sourceEntries = filterDiscoveredSkills(catalog, { source, q: "" });
      const filtered = sourceEntries.filter((skill) => matchesSkillQuery(skill, q));
      if (all && metadataComplete(catalog)) {
        return {
          skills: filtered,
          totalCount: filtered.length,
          offset: 0,
          limit: filtered.length,
          cached: true,
          generatedAt: cached.generatedAt,
          emptyReason: selectedSource && sourceEntries.length === 0 ? "no_skill_files" : "",
          metadataComplete: true,
        };
      }
      const hydratedPage = await hydrateDiscoverCatalog(pageItems(filtered, pagination), cached);
      const nextCatalog = mergeDiscoverSkills(catalog, hydratedPage);
      writeRepoCachesFromCatalog(enabled, dedupeSkills(cached.entries), nextCatalog);
      return {
        skills: hydratedPage,
        totalCount: filtered.length,
        offset: pagination.offset,
        limit: pagination.limit,
        cached: true,
        generatedAt: cached.generatedAt,
        emptyReason: selectedSource && sourceEntries.length === 0 ? "no_skill_files" : "",
        metadataComplete: metadataComplete(nextCatalog),
      };
    }
    if (cached?.skills) {
      const sourceEntries = filterDiscoveredSkills(cached.skills, { source, q: "" });
      const filtered = sourceEntries.filter((skill) => matchesSkillQuery(skill, q));
      return {
        skills: all ? filtered : pageItems(filtered, pagination),
        totalCount: filtered.length,
        offset: all ? 0 : pagination.offset,
        limit: all ? filtered.length : pagination.limit,
        cached: true,
        generatedAt: cached.generatedAt,
        emptyReason: selectedSource && sourceEntries.length === 0 ? "no_skill_files" : "",
        metadataComplete: metadataComplete(cached.skills),
      };
    }
  }

  const settled = await Promise.allSettled(enabled.map(discoverRepoSkillEntries));
  if (selectedSource && settled.every((result) => result.status === "rejected")) {
    const rateLimited = settled.find(
      (result) => result.status === "rejected" && result.reason instanceof RateLimitError,
    );
    if (rateLimited) throw rateLimited.reason;
    throw repoReadError(enabled[0]);
  }
  const mergedEntries = dedupeSkills(settled.flatMap((result) => (result.status === "fulfilled" ? result.value : [])));
  if (!mergedEntries.length) {
    const rateLimited = settled.find(
      (result) => result.status === "rejected" && result.reason instanceof RateLimitError,
    );
    if (rateLimited) throw rateLimited.reason;
  }
  const catalog = mergeCachedDiscoverMetadata(mergedEntries, cached);
  const generatedAt = Date.now();
  const sourceEntries = filterDiscoveredSkills(catalog, { source, q: "" });
  const filtered = sourceEntries.filter((skill) => matchesSkillQuery(skill, q));
  const hydratedPage = await hydrateDiscoverCatalog(pageItems(filtered, pagination), cached);
  const nextCatalog = mergeDiscoverSkills(catalog, hydratedPage);
  writeRepoCachesFromCatalog(enabled, mergedEntries, nextCatalog);
  return {
    skills: all && metadataComplete(nextCatalog) ? filtered : hydratedPage,
    totalCount: filtered.length,
    offset: all && metadataComplete(nextCatalog) ? 0 : pagination.offset,
    limit: all && metadataComplete(nextCatalog) ? filtered.length : pagination.limit,
    cached: false,
    generatedAt,
    emptyReason: selectedSource && sourceEntries.length === 0 ? "no_skill_files" : "",
    metadataComplete: metadataComplete(nextCatalog),
  };
}

function discoverContext(source = "all") {
  const registry = readRegistry();
  const selectedSource = normalizeDiscoverSource(source);
  const enabled = registry.repos
    .map(normalizeRepo)
    .filter((repo) => repo.enabled)
    .filter((repo) => !selectedSource || `${repo.owner}/${repo.name}` === selectedSource);
  const fingerprint = enabled
    .map((repo) => `${repo.owner}/${repo.name}@${repo.branch}`)
    .sort()
    .join("|");
  return { enabled, selectedSource, fingerprint };
}

async function warmDiscoverCatalog({ force = false, source = "all", onProgress = null } = {}) {
  const { enabled, selectedSource, fingerprint } = discoverContext(source);
  if (!enabled.length) return { warmed: false, totalCount: 0 };
  const cached = readCombinedDiscoverCache(enabled, fingerprint);
  if (!force && cached && Array.isArray(cached.skills) && metadataComplete(cached.skills)) {
    return { warmed: false, totalCount: cached.skills.length };
  }
  if (discoverWarmTasks.has(fingerprint)) return discoverWarmTasks.get(fingerprint);

  const task = (async () => {
    const catalogs = [];
    let warmed = false;
    let index = 0;
    for (const repo of enabled) {
      index += 1;
      onProgress?.({
        index,
        total: enabled.length,
        unit: "repos",
        current: `${repo.owner}/${repo.name}`,
      });
      const repoCache = !force ? readRepoDiscoverCache(repo) : null;
      if (repoCache && Array.isArray(repoCache.skills) && metadataComplete(repoCache.skills)) {
        catalogs.push(repoCache.skills);
        continue;
      }
      let entries = !force && Array.isArray(repoCache?.entries) ? dedupeSkills(repoCache.entries) : null;
      if (!entries) {
        try {
          entries = await discoverRepoSkillEntries(repo);
        } catch (err) {
          if (err instanceof RateLimitError) throw err;
          if (selectedSource) throw repoReadError(repo);
          writeRepoDiscoverCache(repo, { entries: [], skills: [], error: err?.message || String(err) });
          continue;
        }
      }
      const catalog = await hydrateDiscoverCatalog(entries, repoCache);
      writeRepoDiscoverCache(repo, { entries, skills: catalog });
      catalogs.push(catalog);
      warmed = true;
    }
    const catalog = dedupeSkills(catalogs.flat());
    return { warmed, totalCount: catalog.length };
  })().finally(() => discoverWarmTasks.delete(fingerprint));

  discoverWarmTasks.set(fingerprint, task);
  return task;
}

function removePath(targetPath) {
  if (!fs.existsSync(targetPath) && !isSymlink(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function isSymlink(targetPath) {
  try {
    return fs.lstatSync(targetPath).isSymbolicLink();
  } catch (_e) {
    return false;
  }
}

function copyDir(source, dest) {
  removePath(dest);
  fs.cpSync(source, dest, { recursive: true, force: true });
}

function syncSkillToTarget(directory, targetId) {
  const target = TARGETS[targetId];
  if (!target) throw new Error(`Unsupported target: ${targetId}`);
  const source = path.join(ssotDir(), directory);
  const dest = path.join(target.dir(), directory);
  if (!fs.existsSync(source)) throw new Error(`Managed skill not found: ${directory}`);
  ensureDir(path.dirname(dest));
  removePath(dest);
  try {
    fs.symlinkSync(source, dest, "dir");
  } catch (_e) {
    copyDir(source, dest);
  }
}

function removeSkillFromTarget(directory, targetId) {
  const target = TARGETS[targetId];
  if (!target) return;
  removePath(path.join(target.dir(), directory));
}

function scanTargetSkill(directory, targetId) {
  const target = TARGETS[targetId];
  if (!target) return false;
  return fs.existsSync(path.join(target.dir(), directory)) || isSymlink(path.join(target.dir(), directory));
}

function listInstalledSkills() {
  purgeExpiredTrash();
  const registry = readRegistry();
  const managed = registry.skills
    .filter((skill) => !skill.trashedAt)
    .map((skill) => {
      const targets = Object.keys(TARGETS).filter((id) => scanTargetSkill(skill.directory, id));
      return { ...skill, managed: true, targets };
    });

  const managedDirs = new Set(managed.map((skill) => skill.directory.toLowerCase()));
  const unmanaged = new Map();
  for (const target of Object.values(TARGETS)) {
    const dir = target.dir();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_e) {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const directory = entry.name;
      if (!directory || directory.startsWith(".") || managedDirs.has(directory.toLowerCase())) continue;
      const skillPath = path.join(dir, directory, "SKILL.md");
      if (!fs.existsSync(skillPath)) continue;
      const metadata = readSkillMetadata(fs.readFileSync(skillPath, "utf8"), directory);
      const key = directory.toLowerCase();
      if (!unmanaged.has(key)) {
        unmanaged.set(key, {
          id: `local:${directory}`,
          key: `local:${directory}`,
          name: metadata.name,
          description: metadata.description,
          directory,
          readmeUrl: null,
          repoOwner: null,
          repoName: null,
          repoBranch: null,
          installedAt: null,
          managed: false,
          targets: [],
          targetPaths: {},
        });
      }
      const skill = unmanaged.get(key);
      skill.targets.push(target.id);
      skill.targetPaths[target.id] = path.join(dir, directory);
    }
  }

  return [...managed, ...unmanaged.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function listInstalledSkillsPage({ q = "", offset = 0, limit = 10 } = {}) {
  const pagination = normalizePagination({ offset, limit }, { defaultLimit: 10, maxLimit: 100 });
  const skills = listInstalledSkills();
  const filtered = skills.filter((skill) => matchesSkillQuery(skill, q));
  return {
    skills: pageItems(filtered, pagination),
    totalCount: filtered.length,
    offset: pagination.offset,
    limit: pagination.limit,
    installedKeys: buildInstalledKeys(skills),
  };
}

function listInstalledSkillsAll({ q = "" } = {}) {
  const skills = listInstalledSkills();
  const filtered = skills.filter((skill) => matchesSkillQuery(skill, q));
  return {
    skills: filtered,
    totalCount: filtered.length,
    offset: 0,
    limit: filtered.length,
    installedKeys: buildInstalledKeys(skills),
  };
}

async function installSkill(skillInput, targetIds = ["claude", "codex"]) {
  const skill = {
    key: String(skillInput?.key || ""),
    name: String(skillInput?.name || ""),
    description: String(skillInput?.description || ""),
    directory: String(skillInput?.directory || ""),
    readmeUrl: skillInput?.readmeUrl || null,
    repoOwner: String(skillInput?.repoOwner || ""),
    repoName: String(skillInput?.repoName || ""),
    repoBranch: String(skillInput?.repoBranch || "main") || "main",
  };
  if (!skill.repoOwner || !skill.repoName) throw new Error("Missing GitHub repository information");
  const sourceDir = sanitizeRelativePath(skill.directory);
  const installName = installNameFromDirectory(sourceDir);
  if (!sourceDir || !installName) throw new Error("Invalid skill directory");

  const registry = readRegistry();
  const existingConflict = registry.skills.find(
    (entry) =>
      entry.directory.toLowerCase() === installName.toLowerCase() &&
      `${entry.repoOwner}/${entry.repoName}`.toLowerCase() !== `${skill.repoOwner}/${skill.repoName}`.toLowerCase(),
  );
  if (existingConflict) {
    throw new Error(
      `Skill directory "${installName}" is already managed by ${existingConflict.repoOwner}/${existingConflict.repoName}`,
    );
  }

  const { branch, tree } = await getRepoTree({
    owner: skill.repoOwner,
    name: skill.repoName,
    branch: skill.repoBranch,
  });
  const files = tree.filter(
    (entry) => entry?.type === "blob" && (entry.path === sourceDir || String(entry.path || "").startsWith(`${sourceDir}/`)),
  );
  if (!files.some((entry) => /(^|\/)SKILL\.md$/i.test(entry.path))) throw new Error("SKILL.md not found in selected directory");

  const dest = path.join(ssotDir(), installName);
  const temp = path.join(dataDir(), "tmp", `${installName}-${Date.now()}`);
  removePath(temp);
  ensureDir(temp);
  try {
    for (const entry of files) {
      const relative = entry.path === sourceDir ? path.basename(entry.path) : entry.path.slice(sourceDir.length + 1);
      const safeRelative = sanitizeRelativePath(relative);
      if (!safeRelative) continue;
      const out = path.join(temp, safeRelative);
      ensureDir(path.dirname(out));
      fs.writeFileSync(out, await fetchText(githubRawUrl(skill.repoOwner, skill.repoName, branch, entry.path)));
    }
    removePath(dest);
    ensureDir(path.dirname(dest));
    fs.renameSync(temp, dest);
  } catch (error) {
    removePath(temp);
    throw error;
  }

  const skillMd = fs.readFileSync(path.join(dest, "SKILL.md"), "utf8");
  const metadata = readSkillMetadata(skillMd, skill.name || installName);
  const selectedTargets = targetIds.filter((id) => TARGETS[id]);
  const installed = {
    id: `${skill.repoOwner}/${skill.repoName}:${sourceDir}`,
    key: `${skill.repoOwner}/${skill.repoName}:${sourceDir}`,
    name: metadata.name,
    description: metadata.description || skill.description,
    directory: installName,
    sourceDirectory: sourceDir,
    readmeUrl: githubDocUrl(skill.repoOwner, skill.repoName, branch, `${sourceDir}/SKILL.md`),
    repoOwner: skill.repoOwner,
    repoName: skill.repoName,
    repoBranch: branch,
    installedAt: Date.now(),
    targets: selectedTargets,
  };

  registry.skills = registry.skills.filter((entry) => entry.id !== installed.id && entry.directory.toLowerCase() !== installName.toLowerCase());
  registry.skills.push(installed);
  saveRegistry(registry);

  for (const id of selectedTargets) syncSkillToTarget(installName, id);
  return { ...installed, managed: true, targets: selectedTargets };
}

function uninstallSkill(id) {
  const registry = readRegistry();
  const skill = registry.skills.find((entry) => entry.id === id || entry.key === id);
  if (!skill) throw new Error("Managed skill not found");
  for (const targetId of Object.keys(TARGETS)) removeSkillFromTarget(skill.directory, targetId);
  // Move SSOT copy into a trash bucket so it can be restored briefly. The
  // registry entry is retained but flagged so restoreSkill can re-link it.
  const ssotPath = path.join(ssotDir(), skill.directory);
  if (fs.existsSync(ssotPath)) {
    ensureDir(trashDir());
    const stamp = Date.now();
    const trashPath = path.join(trashDir(), `${skill.directory}-${stamp}`);
    try {
      fs.renameSync(ssotPath, trashPath);
      skill.trashedAt = stamp;
      skill.trashedDirectory = path.basename(trashPath);
      skill.previousTargets = skill.targets || [];
      skill.targets = [];
      const others = registry.skills.filter((entry) => entry.id !== skill.id);
      registry.skills = [...others, skill];
      saveRegistry(registry);
      purgeExpiredTrash();
      return { ok: true, trashed: true, restoreId: skill.id, ttlMs: TRASH_TTL_MS };
    } catch (_e) {
      removePath(ssotPath);
    }
  }
  registry.skills = registry.skills.filter((entry) => entry.id !== skill.id);
  saveRegistry(registry);
  return { ok: true, trashed: false };
}

function purgeExpiredTrash() {
  try {
    const registry = readRegistry();
    const now = Date.now();
    let dirty = false;
    registry.skills = registry.skills.filter((skill) => {
      if (!skill.trashedAt) return true;
      if (now - skill.trashedAt < TRASH_TTL_MS) return true;
      const trashPath = skill.trashedDirectory ? path.join(trashDir(), skill.trashedDirectory) : null;
      if (trashPath) removePath(trashPath);
      dirty = true;
      return false;
    });
    if (dirty) saveRegistry(registry);
  } catch (_e) {
    // best-effort
  }
}

function restoreSkill(id) {
  const registry = readRegistry();
  const skill = registry.skills.find((entry) => entry.id === id || entry.key === id);
  if (!skill || !skill.trashedAt) throw new Error("Nothing to restore");
  if (Date.now() - skill.trashedAt > TRASH_TTL_MS) {
    throw new Error("Restore window expired");
  }
  const trashPath = path.join(trashDir(), skill.trashedDirectory || "");
  const ssotPath = path.join(ssotDir(), skill.directory);
  if (!fs.existsSync(trashPath)) throw new Error("Trashed copy is missing");
  ensureDir(path.dirname(ssotPath));
  removePath(ssotPath);
  fs.renameSync(trashPath, ssotPath);
  const targets = Array.isArray(skill.previousTargets) ? skill.previousTargets : [];
  skill.targets = targets;
  delete skill.trashedAt;
  delete skill.trashedDirectory;
  delete skill.previousTargets;
  saveRegistry(registry);
  for (const targetId of targets) syncSkillToTarget(skill.directory, targetId);
  return { ...skill, managed: true, targets };
}

function setSkillTargets(id, targetIds) {
  const registry = readRegistry();
  const skill = registry.skills.find((entry) => entry.id === id || entry.key === id);
  if (!skill) throw new Error("Managed skill not found");
  const selectedTargets = targetIds.filter((targetId) => TARGETS[targetId]);
  for (const targetId of Object.keys(TARGETS)) {
    if (selectedTargets.includes(targetId)) syncSkillToTarget(skill.directory, targetId);
    else removeSkillFromTarget(skill.directory, targetId);
  }
  skill.targets = selectedTargets;
  saveRegistry(registry);
  return { ...skill, managed: true, targets: selectedTargets };
}

function findLocalSkillSource(directory) {
  const installName = sanitizePathSegment(directory);
  if (!installName) return null;
  for (const target of Object.values(TARGETS)) {
    const skillPath = path.join(target.dir(), installName);
    const docPath = path.join(skillPath, "SKILL.md");
    if (fs.existsSync(docPath)) {
      return { path: skillPath, targetId: target.id };
    }
  }
  return null;
}

function importLocalSkill(directory, targetIds = []) {
  const installName = sanitizePathSegment(directory);
  if (!installName) throw new Error("Invalid skill directory");
  const registry = readRegistry();
  const existing = registry.skills.find((entry) => entry.directory.toLowerCase() === installName.toLowerCase());
  if (existing) {
    if (!targetIds || !targetIds.length) {
      return { ...existing, managed: true, targets: existing.targets || [] };
    }
    return setSkillTargets(existing.id, targetIds);
  }

  const source = findLocalSkillSource(installName);
  if (!source) throw new Error("Local skill not found");

  const dest = path.join(ssotDir(), installName);
  copyDir(source.path, dest);
  const metadata = readSkillMetadata(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), installName);
  const discoveredTargets = Object.keys(TARGETS).filter((targetId) => scanTargetSkill(installName, targetId));
  const selectedTargets = (targetIds.length ? targetIds : discoveredTargets).filter((targetId) => TARGETS[targetId]);
  const skill = {
    id: `local:${installName}`,
    key: `local:${installName}`,
    name: metadata.name,
    description: metadata.description,
    directory: installName,
    sourceDirectory: installName,
    readmeUrl: null,
    repoOwner: null,
    repoName: null,
    repoBranch: null,
    installedAt: Date.now(),
    targets: selectedTargets,
  };

  registry.skills.push(skill);
  saveRegistry(registry);
  for (const targetId of Object.keys(TARGETS)) {
    if (selectedTargets.includes(targetId)) syncSkillToTarget(installName, targetId);
    else removeSkillFromTarget(installName, targetId);
  }
  return { ...skill, managed: true, targets: selectedTargets };
}

function deleteLocalSkill(directory, targetIds = []) {
  const installName = sanitizePathSegment(directory);
  if (!installName) throw new Error("Invalid skill directory");
  const selectedTargets = targetIds.length ? targetIds : Object.keys(TARGETS);
  for (const targetId of selectedTargets) removeSkillFromTarget(installName, targetId);
  return { ok: true };
}

function listRepos() {
  return readRegistry().repos.map(normalizeRepo);
}

function addRepo(repoInput) {
  const repo = validateRepoInput(repoInput);
  const registry = readRegistry();
  const previous = registry.repos.find(
    (entry) => `${entry.owner}/${entry.name}`.toLowerCase() === `${repo.owner}/${repo.name}`.toLowerCase(),
  );
  registry.repos = registry.repos.filter(
    (entry) => `${entry.owner}/${entry.name}`.toLowerCase() !== `${repo.owner}/${repo.name}`.toLowerCase(),
  );
  registry.repos.push(repo);
  saveRegistry(registry);
  if (previous && repoFingerprint(previous) !== repoFingerprint(repo)) {
    invalidateRepoDiscoverCache(previous);
  }
  invalidateRepoDiscoverCache(repo);
  return repo;
}

async function addRepoChecked(repoInput) {
  const repo = validateRepoInput(repoInput);
  let detectedBranch = repo.branch;
  try {
    const tree = await getRepoTree(repo);
    detectedBranch = tree.branch || detectedBranch;
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    throw repoReadError(repo);
  }
  return addRepo({ ...repo, branch: detectedBranch });
}

function removeRepo(owner, name) {
  const registry = readRegistry();
  registry.repos = registry.repos.filter(
    (entry) => `${entry.owner}/${entry.name}`.toLowerCase() !== `${owner}/${name}`.toLowerCase(),
  );
  saveRegistry(registry);
  return { ok: true };
}

async function searchSkillsSh(query, limit = 20, offset = 0) {
  const q = String(query || "").trim();
  if (q.length < 2) return { query: q, totalCount: 0, skills: [] };
  const url = new URL("https://skills.sh/api/search");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(Math.max(1, Math.min(50, Number(limit) || 20))));
  url.searchParams.set("offset", String(Math.max(0, Number(offset) || 0)));
  const data = await fetchJson(url.toString());
  const skills = Array.isArray(data?.skills)
    ? data.skills
        .map((entry) => {
          const [owner, repoName] = String(entry?.source || "").split("/", 2);
          if (!owner || !repoName || owner.includes(".") || repoName.includes(".")) return null;
          return {
            key: String(entry.id || `${owner}/${repoName}:${entry.skillId || entry.name}`),
            name: String(entry.name || entry.skillId || "Skill"),
            description: "",
            directory: String(entry.skillId || entry.name || ""),
            repoOwner: owner,
            repoName,
            repoBranch: "main",
            readmeUrl: `https://github.com/${owner}/${repoName}`,
            installs: Number(entry.installs || 0),
          };
        })
        .filter(Boolean)
    : [];
  return {
    query: String(data?.query || q),
    totalCount: Number(data?.count || skills.length),
    offset: Math.max(0, Number(offset) || 0),
    limit: Math.max(1, Math.min(50, Number(limit) || 20)),
    skills,
  };
}

module.exports = {
  addRepo,
  addRepoChecked,
  discoverSkills,
  deleteLocalSkill,
  importLocalSkill,
  installSkill,
  listInstalledSkills,
  listInstalledSkillsAll,
  listInstalledSkillsPage,
  listRepos,
  removeRepo,
  restoreSkill,
  searchSkillsSh,
  setSkillTargets,
  targetList,
  uninstallSkill,
  warmDiscoverCatalog,
};
