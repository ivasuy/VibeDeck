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
import { SkillsPage } from "./SkillsPage.jsx";

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

describe("SkillsPage", () => {
  it("renders installed skills instead of the empty state", async () => {
    render(<SkillsPage />);

    expect(await screen.findByText("Sample Skill")).toBeTruthy();
    expect(screen.getByText("Keeps the installed list visible.")).toBeTruthy();

    await waitFor(() => {
      expect(screen.queryByText(copy("skills.empty.my"))).toBeNull();
    });
  });

  it("paginates installed skills at 10 items per page", async () => {
    vi.mocked(getInstalledSkills).mockResolvedValue({
      targets: [{ id: "claude", label: "Claude" }],
      skills: Array.from({ length: 11 }, (_, index) => ({
        id: `skill-${index + 1}`,
        name: `Skill ${index + 1}`,
        directory: `skill-${index + 1}`,
        description: `Description ${index + 1}`,
        targets: ["claude"],
        managed: true,
      })),
    });

    render(<SkillsPage />);

    expect(await screen.findByText("Skill 1")).toBeTruthy();
    expect(screen.getByText("Skill 10")).toBeTruthy();
    expect(screen.queryByText("Skill 11")).toBeNull();
    expect(screen.getByText("1-10 of 11")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    expect(await screen.findByText("Skill 11")).toBeTruthy();
    expect(screen.queryByText("Skill 1")).toBeNull();
    expect(screen.getByText("11-11 of 11")).toBeTruthy();
  });

  it("filters installed skills with the My Skills search bar before pagination", async () => {
    vi.mocked(getInstalledSkills).mockResolvedValue({
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
  });

  it("paginates browse skills at 10 cards per page", async () => {
    vi.mocked(getSkillRepos).mockResolvedValue({
      repos: [{ owner: "acme", name: "skills", branch: "main" }],
    });
    vi.mocked(discoverSkills).mockResolvedValue({
      skills: Array.from({ length: 12 }, (_, index) => ({
        id: `browse-${index + 1}`,
        key: `browse-${index + 1}`,
        name: `Browse Skill ${index + 1}`,
        directory: `browse-skill-${index + 1}`,
        description: `Browse description ${index + 1}`,
        repoOwner: "acme",
        repoName: "skills",
      })),
    });

    render(<SkillsPage />);

    await userEvent.click(await screen.findByRole("button", { name: copy("skills.tab.browse") }));

    expect(await screen.findByText("Browse Skill 1")).toBeTruthy();
    expect(screen.getByText("Browse Skill 10")).toBeTruthy();
    expect(screen.queryByText("Browse Skill 11")).toBeNull();
    expect(screen.getByText("1-10 of 12")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: copy("details.pagination.next") }));

    expect(await screen.findByText("Browse Skill 11")).toBeTruthy();
    expect(screen.getByText("Browse Skill 12")).toBeTruthy();
    expect(screen.queryByText("Browse Skill 1")).toBeNull();
    expect(screen.getByText("11-12 of 12")).toBeTruthy();
  });
});
