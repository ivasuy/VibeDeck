export function getBackendBaseUrl() {
  const env = import.meta?.env || {};
  const configured = env?.VITE_VIBEDECK_BACKEND_BASE_URL || env?.VITE_TOKENTRACKER_BACKEND_BASE_URL || "";
  return String(configured || "").replace(/\/+$/, "");
}
