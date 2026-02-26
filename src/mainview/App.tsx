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
import { useRPC, rpcRequest } from "./hooks/useRPC";

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
  const rpc = useRPC();
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

  // Listen for theme changes from main process
  useEffect(() => {
    const listener = (payload: unknown) => {
      if (!payload || typeof payload !== "object") {
        return;
      }
      const { theme } = payload as { theme?: ThemeMode };
      if (theme === "system" || theme === "light" || theme === "dark") {
        applyTheme(theme);
      }
    };

    rpc.addMessageListener("themeChanged", listener);
    return () => {
      rpc.removeMessageListener("themeChanged", listener);
    };
  }, []);

  // Load dashboard data
  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const dashboardData = await rpcRequest("getDashboardData", { filter });
      setData(dashboardData);
    } catch (error) {
      console.error("Failed to load dashboard data:", error);
      setError(error instanceof Error ? error.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  // Initial load and filter changes
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Listen for data updates from main process
  useEffect(() => {
    const handleUpdate = () => {
      loadData();
    };

    rpc.addMessageListener("sessionsUpdated", handleUpdate);
    return () => rpc.removeMessageListener("sessionsUpdated", handleUpdate);
  }, [loadData]);

  // Trigger sync
  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await rpcRequest("triggerSync", { fullResync: false });
      await loadData();
    } catch (error) {
      console.error("Sync failed:", error);
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
