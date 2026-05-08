import { useCallback, useMemo, useState } from "react";
import { copy } from "../../lib/copy";

// VibeDeck: cloud auth and cloud sync removed. This hook returns local-only stubs.
export function useAccountProfileSettings() {
  return {
    enabled: false,
    loading: false,
    signedIn: false,
    user: null,
    displayName: "",
    email: "",
    cloudSyncOn: false,
    showLocalCloudSync: false,
    handleCloudSyncToggle: () => {},
    handlePublicProfileToggle: () => {},
    name: {
      anonymousOn: false,
      customDisplayName: null,
      displayName: "",
      editingName: false,
      handleAnonymousToggle: () => {},
      handleSaveName: () => {},
      nameInput: "",
      profileLoading: false,
      profileSaving: false,
      setEditingName: () => {},
      setNameInput: () => {},
      startEditingName: () => {},
    },
    github: {
      editingGithub: false,
      githubError: null,
      githubInput: "",
      githubUrl: "",
      handleSaveGithub: () => {},
      handleShowGithubToggle: () => {},
      profileLoading: false,
      profileSaving: false,
      setEditingGithub: () => {},
      setGithubError: () => {},
      setGithubInput: () => {},
      showGithubOn: false,
      startEditingGithub: () => {},
    },
    profileLoading: false,
    profileSaving: false,
    publicProfileOn: false,
  };
}
