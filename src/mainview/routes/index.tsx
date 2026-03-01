import { createFileRoute } from "@tanstack/react-router";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useState,
  useRef,
} from "react";

import { Header } from "@/components/layout/Header";
import type { FilterOption } from "@/components/layout/Header";
import { OverviewSection } from "@/components/sections/OverviewSection";
import { SessionsSection } from "@/components/sections/SessionsSection";
import { ToolsSection } from "@/components/sections/ToolsSection";
import { Skeleton } from "@/components/ui/skeleton";
import { useActiveSection, scrollToSection } from "@/hooks/useActiveSection";
import { useIsDesktop } from "@/hooks/useApi";
import { queryClient } from "@/lib/query-client";
import {
  useDashboardQuery,
  useSyncMutation,
  dashboardQueryOptions,
} from "@/queries/dashboard";

// Lazy load chart-heavy sections to reduce initial bundle
const CostSection = lazy(() =>
  import("@/components/sections/CostSection").then((m) => ({
    default: m.CostSection,
  }))
);
const EfficiencySection = lazy(() =>
  import("@/components/sections/EfficiencySection").then((m) => ({
    default: m.EfficiencySection,
  }))
);
const AutomationSection = lazy(() =>
  import("@/components/sections/AutomationSection").then((m) => ({
    default: m.AutomationSection,
  }))
);
const ProjectsSection = lazy(() =>
  import("@/components/sections/ProjectsSection").then((m) => ({
    default: m.ProjectsSection,
  }))
);

export const Route = createFileRoute("/")({
  loader: async () => {
    await queryClient.ensureQueryData(dashboardQueryOptions("7d"));
  },
  component: Dashboard,
});

function Dashboard() {
  const isDesktop = useIsDesktop();
  const activeSection = useActiveSection();
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const [filter, setFilter] = useState<FilterOption>("7d");
  const [isSyncing, setIsSyncing] = useState(false);

  const { data, isLoading, error, refetch } = useDashboardQuery(filter);
  const syncMutation = useSyncMutation(filter);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Listen for data updates from main process (desktop only)
  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cleanup: (() => void) | undefined;

    import("@/hooks/useRPC").then(({ electroview }) => {
      const handleUpdate = () => {
        refetchRef.current();
      };

      electroview.addMessageListener("sessionsUpdated", handleUpdate);
      cleanup = () =>
        electroview.removeMessageListener("sessionsUpdated", handleUpdate);
    });

    return () => cleanup?.();
  }, [isDesktop]);

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      await syncMutation.mutateAsync({ fullResync: false });
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleNavigateToSection = useCallback((section: string) => {
    scrollToSection(
      section as
        | "overview"
        | "cost"
        | "efficiency"
        | "tools"
        | "sessions"
        | "projects"
    );
  }, []);

  if (error && !data) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-destructive mb-2 text-2xl font-semibold">
            Error
          </h1>
          <p className="text-muted-foreground">{error.message}</p>
          <button
            type="button"
            onClick={() => refetch()}
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
      <Header
        ref={settingsButtonRef}
        filter={filter}
        onFilterChange={setFilter}
        activeSection={activeSection}
        onSync={handleSync}
        isSyncing={isSyncing}
      />

      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 pb-12">
          <OverviewSection
            data={data ?? null}
            loading={isLoading}
            onNavigateToSection={handleNavigateToSection}
          />

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <CostSection data={data ?? null} loading={isLoading} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <EfficiencySection data={data ?? null} loading={isLoading} />
          </Suspense>

          <ToolsSection data={data ?? null} loading={isLoading} />

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AutomationSection data={data ?? null} loading={isLoading} />
          </Suspense>

          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ProjectsSection data={data ?? null} loading={isLoading} />
          </Suspense>

          <SessionsSection data={data ?? null} loading={isLoading} />
        </div>
      </main>
    </div>
  );
}
