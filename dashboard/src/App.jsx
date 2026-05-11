import React, { useMemo } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { getBackendBaseUrl } from "./lib/config";
import { DashboardPage } from "./pages/DashboardPage.jsx";
import { LivePage } from "./pages/LivePage.jsx";
import { BranchesPage } from "./pages/BranchesPage.jsx";
import { EntirePage } from "./pages/EntirePage.jsx";
import { SettingsPage } from "./pages/SettingsPage.jsx";
import { SkillsPage } from "./pages/SkillsPage.jsx";
import { AppLayout } from "./ui/openai/components/Sidebar.jsx";
import { WidgetsPage } from "./pages/WidgetsPage.jsx";

export default function App() {
  // Subscribing to locale here makes App rerender on language switch, which
  // rebuilds every child element reference and triggers copy() re-evaluation
  // across the tree — without unmounting lazy-loaded pages.
  const { resolvedLocale } = useLocale();
  const location = useLocation();
  const pathname = location?.pathname || "/";
  const pageUrl = new URL(window.location.href);
  const sharePathname = pageUrl.pathname.replace(/\/+$/, "") || "/";
  const shareMatch = sharePathname.match(/^\/share\/([^/?#]+)$/i);
  const tokenFromPath = shareMatch?.[1] || null;
  const tokenFromQuery = pageUrl.searchParams.get("token") || null;
  const publicToken = tokenFromPath || tokenFromQuery;
  const publicMode =
    sharePathname === "/share" ||
    sharePathname === "/share.html" ||
    sharePathname.startsWith("/share/");

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const baseUrl = getBackendBaseUrl();

  const isRemovedLimitsPath = normalizedPath === "/limits";
  const isLivePath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isUsagePath = normalizedPath === "/usage";
  const isBranchesPath = normalizedPath === "/branches";
  const isEntirePath = normalizedPath === "/entire";
  const isSettingsPath = normalizedPath === "/settings";
  const isSkillsPath = normalizedPath === "/skills";
  const isWidgetsPath = normalizedPath === "/widgets";

  let PageComponent = LivePage;
  if (isRemovedLimitsPath) {
    PageComponent = () => <Navigate to="/dashboard" replace />;
  } else if (isUsagePath) {
    PageComponent = DashboardPage;
  } else if (isBranchesPath) {
    PageComponent = BranchesPage;
  } else if (isEntirePath) {
    PageComponent = EntirePage;
  } else if (isSettingsPath) {
    PageComponent = SettingsPage;
  } else if (isSkillsPath) {
    PageComponent = SkillsPage;
  } else if (isWidgetsPath) {
    PageComponent = WidgetsPage;
  }

  const showSidebar =
    !publicMode &&
    (isLivePath ||
      isUsagePath ||
      isBranchesPath ||
      isEntirePath ||
      isSettingsPath ||
      isSkillsPath ||
      isWidgetsPath);

  const pageNode = (
    <PageComponent
      key={resolvedLocale}
      baseUrl={baseUrl}
      auth={null}
      signedIn={true}
      sessionSoftExpired={false}
      signOut={() => Promise.resolve()}
      publicMode={publicMode}
      publicToken={publicToken}
      signInUrl="/"
      signUpUrl="/"
    />
  );

  const content = showSidebar ? <AppLayout>{pageNode}</AppLayout> : pageNode;

  return (
    <ErrorBoundary>
      <ThemeProvider>
        {content}
        <Analytics />
        <SpeedInsights />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
