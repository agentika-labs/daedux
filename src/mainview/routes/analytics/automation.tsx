/**
 * Automation analytics sub-route - agents, skills, and hooks ROI.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

const AutomationSection = lazy(() =>
  import("@/components/sections/AutomationSection").then((m) => ({
    default: m.AutomationSection,
  }))
);

export const Route = createFileRoute("/analytics/automation")({
  component: AutomationRoute,
});

function AutomationRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <AutomationSection data={data ?? null} loading={isLoading} />
    </Suspense>
  );
}
