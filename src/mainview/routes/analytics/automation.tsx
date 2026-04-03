/**
 * Automation analytics sub-route - agents, skills, and hooks ROI.
 */
import { createFileRoute } from "@tanstack/react-router";

import { AutomationSection } from "@/components/sections/AutomationSection";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/automation")({
  component: AutomationRoute,
});

function AutomationRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return <AutomationSection data={data ?? null} loading={isLoading} />;
}
