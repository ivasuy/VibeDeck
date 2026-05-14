import { describe, expect, it } from "vitest";
import {
  GITHUB_REPO,
  GITHUB_REPO_API_URL,
  GITHUB_REPO_URL,
  GITHUB_RELEASES_URL,
  HOMEBREW_INSTALL_TARGET,
  HOMEBREW_TAP_REPO_URL,
  NPM_LATEST_URL,
  NPM_PACKAGE,
  NPM_PACKAGE_URL,
} from "./public-links.js";

describe("public-links", () => {
  it("keeps dashboard public links aligned to the shipped VibeDeck repos", () => {
    expect(GITHUB_REPO).toBe("ivasuy/VibeDeck");
    expect(GITHUB_REPO_URL).toBe("https://github.com/ivasuy/VibeDeck");
    expect(GITHUB_REPO_API_URL).toBe("https://api.github.com/repos/ivasuy/VibeDeck");
    expect(GITHUB_RELEASES_URL).toBe("https://github.com/ivasuy/VibeDeck/releases/latest");
    expect(NPM_PACKAGE).toBe("vibedeck-cli");
    expect(NPM_PACKAGE_URL).toBe("https://www.npmjs.com/package/vibedeck-cli");
    expect(NPM_LATEST_URL).toBe("https://registry.npmjs.org/vibedeck-cli/latest");
    expect(HOMEBREW_INSTALL_TARGET).toBe("ivasuy/tap/vibedeck");
    expect(HOMEBREW_TAP_REPO_URL).toBe("https://github.com/ivasuy/homebrew-tap");
  });
});
