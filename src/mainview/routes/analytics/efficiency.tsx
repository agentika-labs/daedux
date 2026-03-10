/**
 * Efficiency analytics sub-route - cache rates, session efficiency, and VCS metrics.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

const EfficiencySection = lazy(() =>
  import("@/components/sections/EfficiencySection").then((m) => ({
    default: m.EfficiencySection,
  }))
);

export const Route = createFileRoute("/analytics/efficiency")({
  component: EfficiencyRoute,
});

function EfficiencyRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <EfficiencySection
        data={data ?? null}
        loading={isLoading}
        filter={filter}
      />
    </Suspense>
  );
}
