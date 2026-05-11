import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSkillRepo,
  deleteLocalSkill,
  discoverSkills,
  getInstalledSkills,
  getSkillRepos,
  importLocalSkill,
  installSkill,
  removeSkillRepo,
  restoreSkill,
  searchSkills,
  setSkillTargets,
  uninstallSkill,
} from "../skills-api";

vi.mock("../local-api-auth", () => ({
  getLocalApiAuthHeaders: vi.fn().mockResolvedValue({ "x-vibedeck-local-auth": "abc" }),
}));

describe("skills-api endpoint routing", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
    vi.stubGlobal("window", { location: { origin: "http://localhost" } } as unknown as Window);
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uses vibedeck-skills for installed mode", async () => {
    await getInstalledSkills();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/functions/vibedeck-skills");
    expect(url).toContain("mode=installed");
    expect(url).not.toContain(`/functions/${["token", "tracker"].join("")}-skills`);
  });

  it("uses vibedeck-skills for repos mode", async () => {
    await getSkillRepos();
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/functions/vibedeck-skills");
    expect(url).toContain("mode=repos");
    expect(url).not.toContain(`/functions/${["token", "tracker"].join("")}-skills`);
  });

  it("uses vibedeck-skills for discover mode", async () => {
    await discoverSkills({ force: true });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/functions/vibedeck-skills");
    expect(url).toContain("mode=discover");
    expect(url).toContain("force=1");
    expect(url).not.toContain(`/functions/${["token", "tracker"].join("")}-skills`);
  });

  it("uses vibedeck-skills for search mode", async () => {
    await searchSkills("planner", 5, 10);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/functions/vibedeck-skills");
    expect(url).toContain("mode=search");
    expect(url).toContain("q=planner");
    expect(url).toContain("offset=5");
    expect(url).toContain("limit=10");
    expect(url).not.toContain(`/functions/${["token", "tracker"].join("")}-skills`);
  });

  it("uses vibedeck-skills install command route", async () => {
    const skill = { owner: "vibedeck", name: "skill" };
    await installSkill(skill, ["claude", "codex"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/install");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      skill,
      targets: ["claude", "codex"],
    });
  });

  it("uses vibedeck-skills uninstall command route", async () => {
    await uninstallSkill("skill-id");
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/uninstall");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "x-vibedeck-local-auth": "abc",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ id: "skill-id" });
  });

  it("uses vibedeck-skills restore command route", async () => {
    await restoreSkill("skill-id");
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/restore");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ id: "skill-id" });
  });

  it("uses vibedeck-skills setTargets command route", async () => {
    await setSkillTargets("skill-id", ["claude", "codex"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/setTargets");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      id: "skill-id",
      targets: ["claude", "codex"],
    });
  });

  it("uses vibedeck-skills importLocal command route", async () => {
    await importLocalSkill("/tmp/skill", ["claude"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/importLocal");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      directory: "/tmp/skill",
      targets: ["claude"],
    });
  });

  it("uses vibedeck-skills deleteLocal command route", async () => {
    await deleteLocalSkill("/tmp/skill", ["claude"]);
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/deleteLocal");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      "x-vibedeck-local-auth": "abc",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      directory: "/tmp/skill",
      targets: ["claude"],
    });
  });

  it("uses vibedeck-skills addRepo command route", async () => {
    const repo = { owner: "vibedeck", name: "skills", branch: "main", enabled: true };
    await addSkillRepo(repo);
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/addRepo");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ repo });
  });

  it("uses vibedeck-skills removeRepo command route", async () => {
    await removeSkillRepo("vibedeck", "skills");
    expect(fetchMock.mock.calls[0][0]).toBe("/functions/vibedeck-skills/removeRepo");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      owner: "vibedeck",
      name: "skills",
    });
  });
});
