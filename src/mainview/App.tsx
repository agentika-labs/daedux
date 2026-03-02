/**
 * App entry point - sets up TanStack Router with theme management.
 *
 * The router handles navigation between dashboard and settings,
 * with automatic preloading on hover for instant navigation.
 */
import {
  RouterProvider,
  createRouter,
  createMemoryHistory,
} from "@tanstack/react-router";
import { useEffect } from "react";

import { RouteErrorComponent } from "./components/RouteErrorComponent";
import { useIsDesktop } from "./hooks/useApi";
import { queryClient } from "./lib/query-client";
import { routeTree } from "./routeTree.gen";

// ─── Router Setup ────────────────────────────────────────────────────────────

// Memory history is required for Electrobun's views:// protocol.
// Browser history reads window.location.pathname which returns "/mainview/index.html"
// instead of "/" causing the router to show "Not Found".
const memoryHistory = createMemoryHistory({
  initialEntries: ["/"],
});

const router = createRouter({
  routeTree,
  history: memoryHistory,
  context: { queryClient },
  // Preload routes on hover - this is the key to fast navigation
  defaultPreload: "intent",
  // Preload after 50ms of hover intent
  defaultPreloadDelay: 50,
  // Unified error component for all routes - can be overridden per-route if needed
  defaultErrorComponent: ({ error, reset }) => (
    <RouteErrorComponent error={error} reset={reset} />
  ),
});

// Register router for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ─── Theme Management ────────────────────────────────────────────────────────

type ThemeMode = "system" | "light" | "dark";

const applyTheme = (theme: ThemeMode) => {
  const root = document.documentElement;

  if (theme === "system") {
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)"
    ).matches;
    root.classList.toggle("dark", prefersDark);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
};

// ─── App Component ───────────────────────────────────────────────────────────

const App = () => {
  const isDesktop = useIsDesktop();

  // Initialize theme and desktop class
  useEffect(() => {
    const root = document.documentElement;

    // Set desktop class based on environment (runs once)
    root.classList.toggle("desktop", isDesktop);

    applyTheme("system");

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [isDesktop]);

  // Listen for theme changes from main process (desktop only)
  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    // Dynamically import RPC for desktop mode
    import("./hooks/useRPC").then(({ electroview }) => {
      const listener = (payload: unknown) => {
        if (!payload || typeof payload !== "object") {
          return;
        }
        const { theme } = payload as { theme?: ThemeMode };
        if (theme === "system" || theme === "light" || theme === "dark") {
          applyTheme(theme);
        }
      };

      electroview.addMessageListener("themeChanged", listener);
      return () => {
        electroview.removeMessageListener("themeChanged", listener);
      };
    });
  }, [isDesktop]);

  return <RouterProvider router={router} />;
};

export default App;
