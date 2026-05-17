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

  it("hydrates only the requested discovered skill page", async () => {
    for (const [owner, name] of [
      ["anthropics", "skills"],
      ["ComposioHQ", "awesome-claude-skills"],
      ["cexll", "myclaude"],
      ["JimLiu", "baoyu-skills"],
    ]) {
      skills.removeRepo(owner, name);
    }
    skills.addRepo({ owner: "page", name: "repo", branch: "main", enabled: true });

    let rawFetches = 0;
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes("/git/trees/")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            tree: [
              { type: "blob", path: "alpha/SKILL.md" },
              { type: "blob", path: "beta/SKILL.md" },
              { type: "blob", path: "gamma/SKILL.md" },
            ],
          }),
        };
      }
      rawFetches += 1;
      return {
        ok: true,
        status: 200,
        text: async () => "---\nname: Beta Remote\ndescription: Hydrated only on page.\n---\n",
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
    assert.equal(rawFetches, 1);
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
