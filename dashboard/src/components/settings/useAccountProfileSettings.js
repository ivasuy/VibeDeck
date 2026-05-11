export function useAccountProfileSettings() {
  return {
    enabled: false,
    loading: false,
    signedIn: true,
    user: null,
    email: "",
    signOut: () => Promise.resolve(),
    name: {
      displayName: "Local user",
    },
  };
}
