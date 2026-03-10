/**
 * Analytics layout route - renders sub-tab navigation and Outlet for child routes.
 *
 * This layout provides:
 * - Sub-tab navigation for Cost, Efficiency, Tools, Automation, OTEL, Projects
 * - URL-persisted filter state via search params
 * - Desktop RPC listener for real-time updates
 */
import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";

import { useIsDesktop } from "@/hooks/useApi";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { dashboardQueryOptions } from "@/queries/dashboard";

// ─── Search Params Schema ────────────────────────────────────────────────────

const analyticsSearchSchema = z.object({
  filter: z
    .enum(["today", "7d", "30d", "all"] as const)
    .default("7d")
    .catch("7d"),
  harness: z
    .enum(["claude-code", "opencode", "codex", "all"] as const)
    .default("claude-code")
    .catch("claude-code"),
});

export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>;

// ─── Route Definition ────────────────────────────────────────────────────────

export const Route = createFileRoute("/analytics")({
  validateSearch: analyticsSearchSchema,
  loader: async () => {
    // Prefetch dashboard data with default filters
    await queryClient.ensureQueryData(
      dashboardQueryOptions("7d", "claude-code")
    );
  },
  component: AnalyticsLayout,
});

// ─── Sub-Tab Configuration ───────────────────────────────────────────────────

const SUB_TABS = [
  { path: "/analytics/cost", label: "Cost" },
  { path: "/analytics/efficiency", label: "Efficiency" },
  { path: "/analytics/tools", label: "Tools" },
  { path: "/analytics/automation", label: "Automation" },
  { path: "/analytics/otel", label: "OTEL" },
  { path: "/analytics/projects", label: "Projects" },
] as const;

// ─── Layout Component ────────────────────────────────────────────────────────

function AnalyticsLayout() {
  const { filter, harness } = Route.useSearch();
  const isDesktop = useIsDesktop();

  // Refetch data when desktop receives update notification
  const refetchRef = useRef(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  });

  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cleanup: (() => void) | undefined;

    import("@/hooks/useRPC").then(({ electroview }) => {
      const handleUpdate = () => refetchRef.current();
      electroview.addMessageListener("sessionsUpdated", handleUpdate);
      cleanup = () =>
        electroview.removeMessageListener("sessionsUpdated", handleUpdate);
    });

    return () => cleanup?.();
  }, [isDesktop]);

  return (
    <div className="flex h-full flex-col">
      {/* Sub-Tab Navigation */}
      <nav className="border-border bg-muted/30 border-b px-6 py-2">
        <div className="mx-auto flex max-w-7xl items-center gap-1">
          {SUB_TABS.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              search={{ filter, harness }}
              activeOptions={{ exact: true }}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200",
                "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              activeProps={{
                className: "bg-background text-foreground shadow-sm",
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Child Route Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
