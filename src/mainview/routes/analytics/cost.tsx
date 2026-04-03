/**
 * Cost analytics sub-route - spending patterns and optimization opportunities.
 */
import { createFileRoute } from "@tanstack/react-router";

import { CostSection } from "@/components/sections/CostSection";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/cost")({
  component: CostRoute,
});

function CostRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return <CostSection data={data ?? null} loading={isLoading} />;
}
