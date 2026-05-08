export function resolveAuthGate({
  publicMode,
  mockEnabled,
  sessionSoftExpired,
  signedIn,
  authPending,
}) {
  // 本地模式：直接返回 dashboard
  if (typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "dashboard";
  }

  if (authPending) return "loading";
  if (!publicMode && !signedIn && !mockEnabled && !sessionSoftExpired) {
    return "landing";
  }
  return "dashboard";
}
