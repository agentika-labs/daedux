/**
 * Tools analytics sub-route - tool usage patterns and success rates.
 */
import { createFileRoute } from "@tanstack/react-router";

import { ToolsSection } from "@/components/sections/ToolsSection";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/tools")({
  component: ToolsRoute,
});

function ToolsRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return <ToolsSection data={data ?? null} loading={isLoading} />;
}
