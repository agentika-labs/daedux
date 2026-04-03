/**
 * Efficiency analytics sub-route - cache rates, session efficiency, and VCS metrics.
 */
import { createFileRoute } from "@tanstack/react-router";

import { EfficiencySection } from "@/components/sections/EfficiencySection";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/efficiency")({
  component: EfficiencyRoute,
});

function EfficiencyRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return (
    <EfficiencySection
      data={data ?? null}
      loading={isLoading}
      filter={filter}
    />
  );
}
