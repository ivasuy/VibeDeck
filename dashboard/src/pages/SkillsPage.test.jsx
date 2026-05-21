/* @vitest-environment jsdom */

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../lib/copy";
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
} from "../lib/skills-api";
import { SkillsPage, __clearSkillsBrowseCatalogCacheForTests } from "./SkillsPage.jsx";

vi.mock("../lib/skills-api", () => ({
  addSkillRepo: vi.fn(),
  deleteLocalSkill: vi.fn(),
  discoverSkills: vi.fn(),
  getInstalledSkills: vi.fn(),
  getSkillRepos: vi.fn(),
  importLocalSkill: vi.fn(),
  installSkill: vi.fn(),
  removeSkillRepo: vi.fn(),
  restoreSkill: vi.fn(),
  searchSkills: vi.fn(),
  setSkillTargets: vi.fn(),
  uninstallSkill: vi.fn(),
}));

beforeEach(() => {
  __clearSkillsBrowseCatalogCacheForTests();
  vi.resetAllMocks();
  vi.mocked(getInstalledSkills).mockResolvedValue({
    targets: [{ id: "claude", label: "Claude" }],
    skills: [
      {
        id: "sample-skill",
        name: "Sample Skill",
        directory: "sample-skill",
        description: "Keeps the installed list visible.",
        targets: ["claude"],
        managed: true,
      },
    ],
    totalCount: 1,
    offset: 0,
    limit: 10,
    installedKeys: ["local/local:sample-skill", "dir:sample-skill"],
  });
  vi.mocked(getSkillRepos).mockResolvedValue({ repos: [] });
  vi.mocked(discoverSkills).mockResolvedValue({ skills: [] });
  vi.mocked(searchSkills).mockResolvedValue({ skills: [] });
  vi.mocked(installSkill).mockResolvedValue({ ok: true });
  vi.mocked(uninstallSkill).mockResolvedValue({ ok: true });
  vi.mocked(restoreSkill).mockResolvedValue({ ok: true });
  vi.mocked(setSkillTargets).mockResolvedValue({ ok: true });
  vi.mocked(importLocalSkill).mockResolvedValue({ ok: true });
  vi.mocked(deleteLocalSkill).mockResolvedValue({ ok: true });
  vi.mocked(addSkillRepo).mockResolvedValue({ ok: true });
  vi.mocked(removeSkillRepo).mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("SkillsPage", () => {
  it("renders installed skills instead of the empty state", async () => {
    render(<SkillsPage />);

    expect(await screen.findByText("Sample Skill")).toBeTruthy();
    expect(screen.getByText("Keeps the installed list visible.")).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText(copy("skills.empty.my"))).toBeNull();
    });
  });

  it("paginates installed skills locally after loading them once", async () => {
    vi.mocked(getInstalledSkills).mockResolvedValueOnce({
      targets: [{ id: "claude", label: "Claude" }],
      skills: Array.from({ length: 11 }, (_, index) => ({
        id: `skill-${index + 1}`,
        name: `Skill ${index + 1}`,
        directory: `skill-${index + 1}`,
        description: `Description ${index + 1}`,
        targets: ["claude"],
        managed: true,
      })),
      totalCount: 11,
      offset: 0,
      limit: 11,
      installedKeys: [],
    });
    vi.mocked(getSkillRepos).mockResolvedValue({ repos: [] });

    render(<SkillsPage />);

    expect(await screen.findByText("Skill 1")).toBeTruthy();
    expect(screen.getByText("Skill 10")).toBeTruthy();
    expect(screen.queryByText("Skill 11")).toBeNull();
    expect(screen.getByText("1-10 of 11")).toBeTruthy();
    await waitFor(() => {
      expect(getInstalledSkills).toHaveBeenCalledWith({ all: true });
    });

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    expect(screen.getByText("Skill 11")).toBeTruthy();
    expect(screen.queryByText("Skill 1")).toBeNull();
    expect(screen.getByText("11-11 of 11")).toBeTruthy();
    expect(getInstalledSkills).toHaveBeenCalledTimes(1);
  });

  it("filters installed skills locally without refetching", async () => {
    vi.mocked(getInstalledSkills).mockResolvedValueOnce({
      targets: [{ id: "claude", label: "Claude" }],
      skills: [
        {
          id: "alpha",
          name: "Alpha Skill",
          directory: "alpha",
          description: "Visible when searching alpha.",
          targets: ["claude"],
          managed: true,
        },
        {
          id: "beta",
          name: "Beta Skill",
          directory: "beta",
          description: "Different skill.",
          targets: ["claude"],
          managed: true,
        },
      ],
      totalCount: 2,
      offset: 0,
      limit: 2,
      installedKeys: [],
    });

    render(<SkillsPage />);

    expect(await screen.findByText("Alpha Skill")).toBeTruthy();
    expect(screen.getByText("Beta Skill")).toBeTruthy();

    await userEvent.type(
      screen.getByPlaceholderText(copy("skills.my.search_placeholder")),
      "alpha",
    );

    await waitFor(() => {
      expect(screen.queryByText("Beta Skill")).toBeNull();
    });
    expect(screen.getByText("Alpha Skill")).toBeTruthy();
    expect(getInstalledSkills).toHaveBeenCalledTimes(1);
  });

  it("loads browse metadata once and paginates locally", async () => {
    vi.mocked(getSkillRepos).mockResolvedValue({
      repos: [{ owner: "acme", name: "skills", branch: "main" }],
    });
    vi.mocked(discoverSkills).mockResolvedValueOnce({
      skills: Array.from({ length: 12 }, (_, index) => ({
        id: `browse-${index + 1}`,
        key: `browse-${index + 1}`,
        name: `Browse Skill ${index + 1}`,
        directory: `browse-skill-${index + 1}`,
        description: `Browse description ${index + 1}`,
        repoOwner: "acme",
        repoName: "skills",
      })),
      totalCount: 12,
      offset: 0,
      limit: 12,
    });

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));

    expect(await screen.findByText("Browse Skill 1")).toBeTruthy();
    expect(screen.getByText("Browse Skill 10")).toBeTruthy();
    expect(screen.queryByText("Browse Skill 11")).toBeNull();
    expect(screen.getByText("1-10 of 12")).toBeTruthy();
    await waitFor(() => {
      expect(discoverSkills).toHaveBeenCalledWith({
        all: true,
        force: false,
        source: "all",
      });
    });

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    expect(await screen.findByText("Browse Skill 11")).toBeTruthy();
    expect(screen.getByText("Browse Skill 12")).toBeTruthy();
    expect(screen.queryByText("Browse Skill 1")).toBeNull();
    expect(screen.getByText("11-12 of 12")).toBeTruthy();
    expect(discoverSkills).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.prev") }));

    expect(screen.getByText("Browse Skill 1")).toBeTruthy();
    expect(screen.queryByText("Browse Skill 11")).toBeNull();
    expect(discoverSkills).toHaveBeenCalledTimes(1);
  });

  it("paginates skills.sh search results through the API", async () => {
    vi.mocked(searchSkills)
      .mockResolvedValueOnce({
        skills: Array.from({ length: 10 }, (_, index) => ({
          id: `remote-${index + 1}`,
          key: `remote-${index + 1}`,
          name: `Remote Skill ${index + 1}`,
          directory: `remote-skill-${index + 1}`,
          repoOwner: "remote",
          repoName: "skills",
        })),
        totalCount: 12,
        offset: 0,
        limit: 10,
      })
      .mockResolvedValueOnce({
        skills: [
          {
            id: "remote-11",
            key: "remote-11",
            name: "Remote Skill 11",
            directory: "remote-skill-11",
            repoOwner: "remote",
            repoName: "skills",
          },
          {
            id: "remote-12",
            key: "remote-12",
            name: "Remote Skill 12",
            directory: "remote-skill-12",
            repoOwner: "remote",
            repoName: "skills",
          },
        ],
        totalCount: 12,
        offset: 10,
        limit: 10,
      });

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));
    await userEvent.click(screen.getByRole("tab", { name: copy("skills.mode.skillssh") }));
    await userEvent.type(screen.getByPlaceholderText(copy("skills.browse.placeholder_skillssh")), "planner");
    await userEvent.click(screen.getByRole("button", { name: copy("skills.action.search") }));

    expect(await screen.findByText("Remote Skill 1")).toBeTruthy();
    expect(screen.getByText("Remote Skill 10")).toBeTruthy();
    expect(screen.queryByText("Remote Skill 11")).toBeNull();
    expect(searchSkills).toHaveBeenCalledWith("planner", 0, 10);

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    expect(await screen.findByText("Remote Skill 11")).toBeTruthy();
    expect(searchSkills).toHaveBeenCalledWith("planner", 10, 10);
  });

  it("shows install progress and refreshes My Skills after installing a browse skill", async () => {
    const pendingInstall = deferred();
    vi.mocked(getInstalledSkills)
      .mockResolvedValueOnce({
        targets: [{ id: "claude", label: "Claude" }],
        skills: [],
        totalCount: 0,
        offset: 0,
        limit: 0,
        installedKeys: [],
      })
      .mockResolvedValueOnce({
        targets: [{ id: "claude", label: "Claude" }],
        skills: [
          {
            id: "acme/skills:alpha",
            key: "acme/skills:alpha",
            name: "Alpha Skill",
            directory: "alpha",
            description: "Installed from browse.",
            repoOwner: "acme",
            repoName: "skills",
            targets: ["claude"],
            managed: true,
          },
        ],
        totalCount: 1,
        offset: 0,
        limit: 1,
        installedKeys: ["acme/skills:alpha", "dir:alpha"],
      });
    vi.mocked(getSkillRepos).mockResolvedValue({
      repos: [{ owner: "acme", name: "skills", branch: "main" }],
    });
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: [
        {
          id: "acme/skills:alpha",
          key: "acme/skills:alpha",
          name: "Alpha Skill",
          directory: "alpha",
          description: "Installed from browse.",
          repoOwner: "acme",
          repoName: "skills",
        },
      ],
      totalCount: 1,
      offset: 0,
      limit: 10,
    });
    vi.mocked(installSkill).mockReturnValueOnce(pendingInstall.promise);

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));
    expect(await screen.findByText("Alpha Skill")).toBeTruthy();

    const installButton = screen.getByRole("button", { name: copy("skills.action.install") });
    await userEvent.click(installButton);

    expect(installButton).toHaveAttribute("aria-busy", "true");
    expect(installButton).toBeDisabled();

    pendingInstall.resolve({ ok: true });

    await waitFor(() => {
      expect(getInstalledSkills).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.getAllByText(copy("skills.card.installed")).length).toBeGreaterThan(0);
    });

    await userEvent.click(screen.getByRole("button", { name: copy("skills.tab.my") }));
    expect(await screen.findByText("Alpha Skill")).toBeTruthy();
  });

  it("reuses cached browse metadata when the page is remounted", async () => {
    vi.mocked(getSkillRepos).mockResolvedValue({
      repos: [{ owner: "acme", name: "skills", branch: "main" }],
    });
    vi.mocked(discoverSkills).mockResolvedValueOnce({
      skills: [
        {
          id: "browse-1",
          key: "browse-1",
          name: "Browse Skill 1",
          directory: "browse-skill-1",
          repoOwner: "acme",
          repoName: "skills",
        },
      ],
      totalCount: 1,
      offset: 0,
      limit: 1,
    });

    const firstRender = render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));
    expect(await screen.findByText("Browse Skill 1")).toBeTruthy();
    expect(discoverSkills).toHaveBeenCalledTimes(1);

    firstRender.unmount();
    render(<SkillsPage />);
    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));

    expect(await screen.findByText("Browse Skill 1")).toBeTruthy();
    expect(discoverSkills).toHaveBeenCalledTimes(1);
  });

  it("filters repository skills locally after loading the catalog once", async () => {
    vi.mocked(getSkillRepos).mockResolvedValue({
      repos: [{ owner: "acme", name: "skills", branch: "main" }],
    });
    vi.mocked(discoverSkills).mockResolvedValueOnce({
      skills: [
        {
          id: "browse-1",
          key: "browse-1",
          name: "Browse Skill 1",
          directory: "browse-skill-1",
          repoOwner: "acme",
          repoName: "skills",
        },
        {
          id: "alpha",
          key: "alpha",
          name: "Alpha Skill",
          directory: "alpha",
          repoOwner: "acme",
          repoName: "skills",
        },
      ],
      totalCount: 2,
      offset: 0,
      limit: 2,
    });

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));
    expect(await screen.findByText("Browse Skill 1")).toBeTruthy();

    await userEvent.type(
      screen.getByPlaceholderText(copy("skills.browse.placeholder_all")),
      "alpha",
    );

    await waitFor(() => {
      expect(screen.queryByText("Browse Skill 1")).toBeNull();
    });
    expect(screen.getByText("Alpha Skill")).toBeTruthy();
    expect(discoverSkills).toHaveBeenCalledTimes(1);
  });

  it("adds a repository by fetching only the new source and closing source management", async () => {
    vi.mocked(getSkillRepos)
      .mockResolvedValueOnce({ repos: [] })
      .mockResolvedValueOnce({
        repos: [{ owner: "VoltAgent", name: "awesome-design-md", branch: "main" }],
      });
    vi.mocked(addSkillRepo).mockResolvedValue({
      ok: true,
      repo: { owner: "VoltAgent", name: "awesome-design-md", branch: "main" },
    });
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: [],
      totalCount: 0,
      offset: 0,
      limit: 10,
      emptyReason: "no_skill_files",
    });

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));
    await userEvent.type(screen.getByPlaceholderText(copy("skills.repo.placeholder")), "VoltAgent/awesome-design-md");
    await userEvent.click(screen.getByRole("button", { name: copy("skills.repo.add") }));

    await waitFor(() => {
      expect(addSkillRepo).toHaveBeenCalledWith({
        owner: "VoltAgent",
        name: "awesome-design-md",
        branch: "main",
        enabled: true,
      });
    });
    await waitFor(() => {
      expect(discoverSkills).toHaveBeenCalledWith({
        all: true,
        force: true,
        source: "VoltAgent/awesome-design-md",
      });
    });
    expect(
      await screen.findByText((text) =>
        text.includes("No SKILL.md files found in VoltAgent/awesome-design-md"),
      ),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText(copy("skills.repo.placeholder"))).toBeNull();
  });

});
