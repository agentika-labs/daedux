/**
 * Projects analytics sub-route - per-project cost and activity breakdown.
 */
import { createFileRoute } from "@tanstack/react-router";

import { ProjectsSection } from "@/components/sections/ProjectsSection";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return <ProjectsSection data={data ?? null} loading={isLoading} />;
}
