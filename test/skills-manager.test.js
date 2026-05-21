const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

// Isolate ~/.vibedeck/skills + target skill dirs into a temp HOME. Must run
// before requiring the module so that every `os.homedir()` callback resolves
// within the sandbox.
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-skills-mgr-"));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;

const skills = require("../src/lib/skills-manager");

function writeLocalSkill(targetDir, directory, body = "---\nname: Local Skill\ndescription: Test skill\n---\n") {
  const dir = path.join(sandboxHome, targetDir, directory);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), body);
  return dir;
}

describe("skills-manager addRepo validation", () => {
  it("rejects path-traversal-like owner/name", () => {
    assert.throws(() => skills.addRepo({ owner: "..", name: "repo" }), /owner and name/);
    assert.throws(() => skills.addRepo({ owner: "foo/../bar", name: "repo" }), /owner and name/);
    assert.throws(() => skills.addRepo({ owner: "foo", name: "bar/baz" }), /owner and name/);
    assert.throws(() => skills.addRepo({ owner: "foo", name: "repo", branch: "../main" }), /branch/);
  });

  it("accepts well-formed owner/name", () => {
    const repo = skills.addRepo({ owner: "anthropics", name: "skills" });
    assert.equal(repo.owner, "anthropics");
    assert.equal(repo.name, "skills");
    assert.equal(repo.branch, "main");
    // clean up to avoid leaking into other tests
    skills.removeRepo("anthropics", "skills");
  });
});

describe("skills-manager importLocalSkill sanitization", () => {
  it("rejects invalid directory names", () => {
    assert.throws(() => skills.importLocalSkill("..", []), /Invalid skill directory/);
    assert.throws(() => skills.importLocalSkill("foo/bar", []), /Invalid skill directory/);
    assert.throws(() => skills.importLocalSkill("", []), /Invalid skill directory/);
  });

  it("throws when skill is not present in any target folder", () => {
    assert.throws(() => skills.importLocalSkill("not-there", ["claude"]), /Local skill not found/);
  });
});

describe("skills-manager setSkillTargets", () => {
  it("throws when skill id is unknown", () => {
    assert.throws(() => skills.setSkillTargets("missing", ["claude"]), /Managed skill not found/);
  });
});

describe("skills-manager importLocalSkill re-sync", () => {
  before(() => {
    writeLocalSkill(".claude/skills", "sample-skill");
  });

  it("re-applies targets when called again with new target set", () => {
    const first = skills.importLocalSkill("sample-skill", ["claude"]);
    assert.equal(first.managed, true);
    assert.deepEqual(first.targets, ["claude"]);
    assert.ok(fs.existsSync(path.join(sandboxHome, ".claude/skills/sample-skill/SKILL.md")));
    assert.ok(!fs.existsSync(path.join(sandboxHome, ".codex/skills/sample-skill")));

    const second = skills.importLocalSkill("sample-skill", ["claude", "codex"]);
    assert.equal(second.managed, true);
    assert.deepEqual(new Set(second.targets), new Set(["claude", "codex"]));
    assert.ok(fs.existsSync(path.join(sandboxHome, ".codex/skills/sample-skill/SKILL.md")));

    const third = skills.importLocalSkill("sample-skill", ["codex"]);
    assert.deepEqual(third.targets, ["codex"]);
    assert.ok(!fs.existsSync(path.join(sandboxHome, ".claude/skills/sample-skill")));
    assert.ok(fs.existsSync(path.join(sandboxHome, ".codex/skills/sample-skill/SKILL.md")));

    // cleanup: uninstall managed skill
    skills.uninstallSkill(third.id);
  });
});

describe("skills-manager paged installed listing", () => {
  before(() => {
    writeLocalSkill(".claude/skills", "alpha-page", "---\nname: Alpha Page\ndescription: Alpha searchable\n---\n");
    writeLocalSkill(".claude/skills", "beta-page", "---\nname: Beta Page\ndescription: Beta searchable\n---\n");
    writeLocalSkill(".claude/skills", "gamma-page", "---\nname: Gamma Page\ndescription: Gamma searchable\n---\n");
  });

  it("returns only the requested installed skill page with total count metadata", () => {
    const page = skills.listInstalledSkillsPage({ offset: 0, limit: 2 });

    assert.equal(page.offset, 0);
    assert.equal(page.limit, 2);
    assert.equal(page.skills.length, 2);
    assert.ok(page.totalCount >= 3);
    assert.ok(page.installedKeys.includes("dir:alpha-page"));
  });

  it("filters installed skills before applying pagination", () => {
    const page = skills.listInstalledSkillsPage({ q: "Beta Page", offset: 0, limit: 10 });

    assert.equal(page.totalCount, 1);
    assert.equal(page.skills[0].directory, "beta-page");
    assert.ok(page.installedKeys.includes("dir:beta-page"));
  });
});

describe("skills-manager paged discovery", () => {
  const originalFetch = global.fetch;

  after(() => {
    global.fetch = originalFetch;
  });

  it("hydrates the requested discovered skill page and warms a searchable metadata catalog", async () => {
    for (const [owner, name] of [
      ["anthropics", "skills"],
      ["ComposioHQ", "awesome-claude-skills"],
      ["cexll", "myclaude"],
      ["JimLiu", "baoyu-skills"],
    ]) {
      skills.removeRepo(owner, name);
    }
    skills.addRepo({ owner: "page", name: "repo", branch: "main", enabled: true });

    let metadataFetches = 0;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: [
              { type: "blob", path: "alpha/SKILL.md", sha: "sha-alpha" },
              { type: "blob", path: "beta/SKILL.md", sha: "sha-beta" },
              { type: "blob", path: "gamma/SKILL.md", sha: "sha-gamma" },
            ],
          }),
        };
      }
      metadataFetches += 1;
      const name = href.includes("/alpha/")
        ? "Alpha Remote"
        : href.includes("/gamma/")
          ? "Gamma Remote"
          : "Beta Remote";
      return {
        ok: true,
        status: 200,
        text: async () => `---\nname: ${name}\ndescription: Cached catalog entry.\n---\n`,
      };
    };

    const page = await skills.discoverSkills({
      force: true,
      offset: 1,
      limit: 1,
      source: "page/repo",
    });

    assert.equal(page.totalCount, 3);
    assert.equal(page.skills.length, 1);
    assert.equal(page.skills[0].directory, "beta");
    assert.equal(page.skills[0].name, "Beta Remote");
    assert.equal(metadataFetches, 1);

    await skills.warmDiscoverCatalog({ source: "page/repo" });

    const searched = await skills.discoverSkills({
      source: "page/repo",
      q: "Gamma Remote",
      offset: 0,
      limit: 10,
    });

    assert.equal(searched.totalCount, 1);
    assert.equal(searched.skills.length, 1);
    assert.equal(searched.skills[0].directory, "gamma");
    assert.equal(searched.skills[0].name, "Gamma Remote");
    assert.equal(metadataFetches, 3);
  });

  it("returns a full cached discover catalog and indexes only newly added repos", async () => {
    for (const [owner, name] of [
      ["anthropics", "skills"],
      ["ComposioHQ", "awesome-claude-skills"],
      ["cexll", "myclaude"],
      ["JimLiu", "baoyu-skills"],
      ["page", "repo"],
      ["first", "repo"],
      ["second", "repo"],
    ]) {
      skills.removeRepo(owner, name);
    }
    skills.addRepo({ owner: "first", name: "repo", branch: "main", enabled: true });

    const metadataFetches = [];
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        const owner = href.includes("/repos/second/") ? "second" : "first";
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: Array.from({ length: owner === "first" ? 12 : 2 }, (_, index) => ({
              type: "blob",
              path: `${owner}-${index + 1}/SKILL.md`,
              sha: `${owner}-sha-${index + 1}`,
            })),
          }),
        };
      }
      const owner = href.includes("/second-") ? "second" : "first";
      const number = href.match(/-(\d+)\/SKILL\.md/)?.[1] || "1";
      metadataFetches.push(`${owner}-${number}`);
      return {
        ok: true,
        status: 200,
        text: async () => `---\nname: ${owner} Skill ${number}\ndescription: ${owner} metadata ${number}\n---\n`,
      };
    };

    await skills.warmDiscoverCatalog({ source: "all" });
    assert.equal(metadataFetches.length, 12);

    const firstCatalog = await skills.discoverSkills({ all: true, source: "all" });
    assert.equal(firstCatalog.skills.length, 12);
    assert.equal(firstCatalog.totalCount, 12);
    assert.equal(firstCatalog.offset, 0);
    assert.equal(firstCatalog.limit, 12);

    skills.addRepo({ owner: "second", name: "repo", branch: "main", enabled: true });
    await skills.warmDiscoverCatalog({ source: "all" });

    assert.equal(metadataFetches.filter((key) => key.startsWith("first-")).length, 12);
    assert.equal(metadataFetches.filter((key) => key.startsWith("second-")).length, 2);

    const mergedCatalog = await skills.discoverSkills({ all: true, source: "all" });
    assert.equal(mergedCatalog.skills.length, 14);
    assert.equal(mergedCatalog.totalCount, 14);
    assert.ok(mergedCatalog.skills.some((skill) => skill.name === "first Skill 12"));
    assert.ok(mergedCatalog.skills.some((skill) => skill.name === "second Skill 2"));
  });

  it("keeps the all-repo metadata index usable when one registered repo is unreachable", async () => {
    for (const [owner, name] of [
      ["first", "repo"],
      ["second", "repo"],
      ["good", "repo"],
      ["bad", "repo"],
    ]) {
      skills.removeRepo(owner, name);
    }
    skills.addRepo({ owner: "good", name: "repo", branch: "main", enabled: true });
    skills.addRepo({ owner: "bad", name: "repo", branch: "main", enabled: true });

    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/repos/bad/")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (href.includes("/git/trees/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: [{ type: "blob", path: "alpha/SKILL.md", sha: "good-alpha" }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        text: async () => "---\nname: Good Skill\ndescription: Indexed despite another repo failing.\n---\n",
      };
    };

    await skills.warmDiscoverCatalog({ source: "all" });
    const catalog = await skills.discoverSkills({ all: true, source: "all" });

    assert.equal(catalog.totalCount, 1);
    assert.equal(catalog.skills[0].name, "Good Skill");
  });

  it("does not label a real repository as missing SKILL.md when search has no matches", async () => {
    skills.removeRepo("page", "repo");
    skills.addRepo({ owner: "page", name: "repo", branch: "main", enabled: true });
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: [{ type: "blob", path: "alpha/SKILL.md" }],
          }),
        };
      }
      throw new Error(`unexpected metadata fetch for empty search page: ${href}`);
    };

    const page = await skills.discoverSkills({
      force: true,
      source: "page/repo",
      q: "does-not-match",
      offset: 0,
      limit: 10,
    });

    assert.equal(page.totalCount, 0);
    assert.equal(page.skills.length, 0);
    assert.equal(page.emptyReason, "");
  });

  it("rejects unreachable repositories before saving them through checked add", async () => {
    skills.removeRepo("missing", "repo");
    global.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await assert.rejects(
      () => skills.addRepoChecked({ owner: "missing", name: "repo", branch: "main" }),
      /Unable to read GitHub repository missing\/repo/,
    );
    assert.equal(
      skills.listRepos().some((repo) => repo.owner === "missing" && repo.name === "repo"),
      false,
    );
  });

  it("raises a clear error when a selected repository cannot be read", async () => {
    skills.removeRepo("missing", "repo");
    skills.addRepo({ owner: "missing", name: "repo", branch: "main", enabled: true });
    global.fetch = async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    });

    await assert.rejects(
      () => skills.discoverSkills({ force: true, source: "missing/repo", offset: 0, limit: 10 }),
      /Unable to read GitHub repository missing\/repo/,
    );
  });
});
