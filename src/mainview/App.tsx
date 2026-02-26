import type { DashboardData } from "@shared/rpc-types";
import { useEffect, useState, useCallback } from "react";

import { Header } from "./components/layout/Header";
import type { FilterOption } from "./components/layout/Header";
import { AutomationSection } from "./components/sections/AutomationSection";
import { CostSection } from "./components/sections/CostSection";
import { EfficiencySection } from "./components/sections/EfficiencySection";
import { OverviewSection } from "./components/sections/OverviewSection";
import { ProjectsSection } from "./components/sections/ProjectsSection";
import { SessionsSection } from "./components/sections/SessionsSection";
import { ToolsSection } from "./components/sections/ToolsSection";
import { useActiveSection, scrollToSection } from "./hooks/useActiveSection";
import { useApi, useIsDesktop } from "./hooks/useApi";

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

const App = () => {
  const api = useApi();
  const isDesktop = useIsDesktop();
  const activeSection = useActiveSection();
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [filter, setFilter] = useState<FilterOption>("7d");

  // Initialize theme
  useEffect(() => {
    applyTheme("system");

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => applyTheme("system");
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Listen for theme changes from main process (desktop only)
  useEffect(() => {
    if (!isDesktop) return;

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

  // Load dashboard data
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const dashboardData = await api.getDashboardData({ filter });
      setData(dashboardData);
    } catch (err) {
      console.error("Failed to load dashboard data:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [api, filter]);

  // Initial load and filter changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for data updates from main process (desktop only)
  useEffect(() => {
    if (!isDesktop) return;

    let cleanup: (() => void) | undefined;

    import("./hooks/useRPC").then(({ electroview }) => {
      const handleUpdate = () => {
        loadData();
      };

      electroview.addMessageListener("sessionsUpdated", handleUpdate);
      cleanup = () =>
        electroview.removeMessageListener("sessionsUpdated", handleUpdate);
    });

    return () => cleanup?.();
  }, [isDesktop, loadData]);

  // Trigger sync
  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await api.triggerSync({ fullResync: false });
      await loadData();
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Navigate to section handler for insights
  const handleNavigateToSection = (section: string) => {
    scrollToSection(
      section as
        | "overview"
        | "cost"
        | "efficiency"
        | "tools"
        | "sessions"
        | "projects"
    );
  };

  if (error && !data) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-destructive mb-2 text-2xl font-semibold">
            Error
          </h1>
          <p className="text-muted-foreground">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="bg-primary text-primary-foreground mt-4 rounded-lg px-4 py-2"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background text-foreground flex h-screen flex-col">
      {/* Sticky Header */}
      <Header
        filter={filter}
        onFilterChange={setFilter}
        activeSection={activeSection}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      {/* Scrollable Content */}
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 pb-12">
          <OverviewSection
            data={data}
            loading={isLoading}
            onNavigateToSection={handleNavigateToSection}
          />

          <CostSection data={data} loading={isLoading} />

          <EfficiencySection data={data} loading={isLoading} />

          <ToolsSection data={data} loading={isLoading} />

          <AutomationSection data={data} loading={isLoading} />

          <ProjectsSection data={data} loading={isLoading} />

          <SessionsSection data={data} loading={isLoading} />
        </div>
      </main>
    </div>
  );
};

export default App;
