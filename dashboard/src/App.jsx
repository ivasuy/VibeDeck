import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/react";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { useLocale } from "./hooks/useLocale.js";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { getBackendBaseUrl } from "./lib/config";
import { AppLayout } from "./ui/openai/components/Sidebar.jsx";
import { PageTransition } from "./ui/foundation/PageTransition.jsx";

const FIRST_LAUNCH_STORAGE_KEY = "vd-first-launch-seen";

function lazyNamed(loader, exportName) {
  return React.lazy(() => loader().then((module) => ({ default: module[exportName] })));
}

const DashboardPage = lazyNamed(() => import("./pages/DashboardPage.jsx"), "DashboardPage");
const LivePage = lazyNamed(() => import("./pages/LivePage.jsx"), "LivePage");
const BranchesPage = lazyNamed(() => import("./pages/BranchesPage.jsx"), "BranchesPage");
const SettingsPage = lazyNamed(() => import("./pages/SettingsPage.jsx"), "SettingsPage");
const SkillsPage = lazyNamed(() => import("./pages/SkillsPage.jsx"), "SkillsPage");
const ComparePage = lazyNamed(() => import("./pages/ComparePage.jsx"), "ComparePage");
const ModelsPage = lazyNamed(() => import("./pages/ModelsPage.jsx"), "ModelsPage");
const YieldPage = lazyNamed(() => import("./pages/YieldPage.jsx"), "YieldPage");
const ExportPage = lazyNamed(() => import("./pages/ExportPage.jsx"), "ExportPage");
const OptimizePage = lazyNamed(() => import("./pages/OptimizePage.jsx"), "OptimizePage");
const PlanPage = lazyNamed(() => import("./pages/PlanPage.jsx"), "PlanPage");
const WidgetsPage = lazyNamed(() => import("./pages/WidgetsPage.jsx"), "WidgetsPage");

function RemovedLimitsRedirect() {
  return <Navigate to="/dashboard" replace />;
}

/*
function RemovedDashboardRouteRedirect() {
  return <Navigate to="/dashboard" replace />;
}
*/

export default function App() {
  // Subscribing to locale here makes App rerender on language switch, which
  // rebuilds every child element reference and triggers copy() re-evaluation
  // across the tree — without unmounting lazy-loaded pages.
  const { resolvedLocale } = useLocale();
  const location = useLocation();
  const shouldReduceMotion = useReducedMotion();
  const pathname = location?.pathname || "/";
  const publicMode = false;
  const publicToken = null;

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const baseUrl = getBackendBaseUrl();

  const isRemovedLimitsPath = normalizedPath === "/limits";
  const isDashboardPath = normalizedPath === "/" || normalizedPath === "/dashboard";
  const isLivePath = normalizedPath === "/live";
  const isUsagePath = normalizedPath === "/usage";
  const isBranchesPath = normalizedPath === "/branches";
  // const isEntirePath = normalizedPath === "/entire";
  const isSettingsPath = normalizedPath === "/settings";
  const isSkillsPath = normalizedPath === "/skills";
  const isWidgetsPath = normalizedPath === "/widgets";
  const isComparePath = normalizedPath === "/compare";
  const isModelsPath = normalizedPath === "/models";
  const isYieldPath = normalizedPath === "/yield";
  const isExportPath = normalizedPath === "/export";
  const isOptimizePath = normalizedPath === "/optimize";
  const isPlanPath = normalizedPath === "/plan";

  let PageComponent = DashboardPage;
  if (isRemovedLimitsPath) {
    PageComponent = RemovedLimitsRedirect;
  } else if (isDashboardPath || isUsagePath) {
    PageComponent = DashboardPage;
  } else if (isLivePath) {
    PageComponent = LivePage;
  } else if (isBranchesPath) {
    PageComponent = BranchesPage;
  /*
  } else if (isEntirePath) {
    PageComponent = RemovedDashboardRouteRedirect;
  */
  } else if (isSettingsPath) {
    PageComponent = SettingsPage;
  } else if (isSkillsPath) {
    PageComponent = SkillsPage;
  } else if (isWidgetsPath) {
    PageComponent = WidgetsPage;
  } else if (isComparePath) {
    PageComponent = ComparePage;
  } else if (isModelsPath) {
    PageComponent = ModelsPage;
  } else if (isYieldPath) {
    PageComponent = YieldPage;
  } else if (isExportPath) {
    PageComponent = ExportPage;
  } else if (isOptimizePath) {
    PageComponent = OptimizePage;
  } else if (isPlanPath) {
    PageComponent = PlanPage;
  }

  const showSidebar =
    !publicMode &&
    (isDashboardPath ||
      isLivePath ||
      isUsagePath ||
      isBranchesPath ||
      isSettingsPath ||
      isSkillsPath ||
      isWidgetsPath ||
      isComparePath ||
      isModelsPath ||
      isYieldPath ||
      isExportPath ||
      isOptimizePath ||
      isPlanPath);

  const pageKey = `${normalizedPath}:${resolvedLocale}`;
  const pageNode = (
    <AnimatePresence mode="wait" initial={false}>
      <PageTransition key={pageKey}>
        <React.Suspense fallback={null}>
          <PageComponent
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
        </React.Suspense>
      </PageTransition>
    </AnimatePresence>
  );

  const content = showSidebar ? <AppLayout>{pageNode}</AppLayout> : pageNode;

  return (
    <ErrorBoundary>
      <ThemeProvider>
        {content}
        <FirstLaunchOverlay shouldReduceMotion={shouldReduceMotion} />
        <Analytics />
        <SpeedInsights />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function FirstLaunchOverlay({ shouldReduceMotion }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let storage = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }

    if (storage?.getItem(FIRST_LAUNCH_STORAGE_KEY) === "1") return undefined;

    storage?.setItem(FIRST_LAUNCH_STORAGE_KEY, "1");

    if (shouldReduceMotion) return undefined;

    setVisible(true);
    const timer = window.setTimeout(() => setVisible(false), 4200);
    return () => window.clearTimeout(timer);
  }, [shouldReduceMotion]);

  if (!visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-[var(--vd-card-bg-solid)]/92 backdrop-blur-sm dark:bg-oai-gray-950/92"
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.24 } }}
        aria-hidden="true"
      >
        <motion.svg
          viewBox="100 170 290 170"
          className="h-40 w-40 text-[var(--brand-500)]"
          initial={{ opacity: 0, scale: 0.7, x: 0, y: 0 }}
          animate={{
            opacity: [0, 1, 1, 1, 0],
            scale: [0.7, 1, 1, 0.24, 0.24],
            x: ["0px", "0px", "0px", "calc(-50vw + 112px)", "calc(-50vw + 112px)"],
            y: ["0px", "0px", "0px", "calc(-50vh + 88px)", "calc(-50vh + 88px)"],
          }}
          transition={{
            times: [0, 0.2, 0.5, 0.78, 1],
            duration: 3.9,
            ease: [0.2, 0, 0.1, 1],
          }}
        >
          <motion.path
            d="M 107 231 L 307 231 L 377 181 L 177 181 Z"
            initial={{ fill: "var(--oai-gray-300)", opacity: 0.55 }}
            animate={{ fill: "var(--brand-300)", opacity: 0.55 }}
            transition={{ delay: 0.8, duration: 0.2 }}
          />
          <motion.path
            d="M 107 281 L 307 281 L 377 231 L 177 231 Z"
            initial={{ fill: "var(--oai-gray-300)", opacity: 0.78 }}
            animate={{ fill: "var(--brand-400)", opacity: 0.78 }}
            transition={{ delay: 1.0, duration: 0.2 }}
          />
          <motion.path
            d="M 107 331 L 307 331 L 377 281 L 177 281 Z"
            initial={{ fill: "var(--oai-gray-300)", opacity: 1 }}
            animate={{ fill: "var(--brand-500)", opacity: 1 }}
            transition={{ delay: 1.2, duration: 0.2 }}
          />
        </motion.svg>
      </motion.div>
    </AnimatePresence>
  );
}
