/**
 * Analytics layout route - renders sub-tab navigation and Outlet for child routes.
 *
 * This layout provides:
 * - Sub-tab navigation for Cost, Efficiency, Tools, Automation, OTEL, Projects
 * - URL-persisted filter state via search params
 * - Desktop RPC listener for real-time updates
 */
import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { z } from "zod";

import { useDesktopRefetch } from "@/hooks/useDesktopRefetch";
import { queryClient } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import { dashboardQueryOptions } from "@/queries/dashboard";

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

export const Route = createFileRoute("/analytics")({
  validateSearch: analyticsSearchSchema,
  loaderDeps: ({ search: { filter, harness } }) => ({ filter, harness }),
  loader: ({ deps: { filter, harness } }) => {
    queryClient.prefetchQuery(dashboardQueryOptions(filter, harness));
  },
  component: AnalyticsLayout,
});

const SUB_TABS = [
  { path: "/analytics/cost", label: "Cost" },
  { path: "/analytics/efficiency", label: "Efficiency" },
  { path: "/analytics/tools", label: "Tools" },
  { path: "/analytics/automation", label: "Automation" },
  { path: "/analytics/otel", label: "OTEL" },
  { path: "/analytics/projects", label: "Projects" },
] as const;

function AnalyticsLayout() {
  const { filter, harness } = Route.useSearch();

  useDesktopRefetch(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  });

  return (
    <div className="flex h-full flex-col">
      <nav className="border-border border-b px-6 py-2">
        <div className="flex items-center gap-1">
          {SUB_TABS.map(({ path, label }) => (
            <Link
              key={path}
              to={path}
              search={{ filter, harness }}
              activeOptions={{ exact: true }}
              className={cn(
                "px-3 py-1.5 text-sm font-medium transition-colors",
                "text-muted-foreground hover:text-foreground"
              )}
              activeProps={{
                className: "text-foreground border-b-2 border-foreground",
              }}
            >
              {label}
            </Link>
          ))}
        </div>
      </nav>

      {/* Child Route Content */}
      <div className="flex-1 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
