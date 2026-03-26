/**
 * Projects analytics sub-route - per-project cost and activity breakdown.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

const ProjectsSection = lazy(() =>
  import("@/components/sections/ProjectsSection").then((m) => ({
    default: m.ProjectsSection,
  }))
);

export const Route = createFileRoute("/analytics/projects")({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useDashboardQuery(filter, harness);

  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <ProjectsSection data={data ?? null} loading={isLoading} />
    </Suspense>
  );
}
