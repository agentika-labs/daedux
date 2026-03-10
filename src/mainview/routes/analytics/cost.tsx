/**
 * Cost analytics sub-route - spending patterns and optimization opportunities.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

const CostSection = lazy(() =>
  import("@/components/sections/CostSection").then((m) => ({
    default: m.CostSection,
  }))
);

export const Route = createFileRoute("/analytics/cost")({
  component: CostRoute,
});

function CostRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <CostSection data={data ?? null} loading={isLoading} />
    </Suspense>
  );
}
