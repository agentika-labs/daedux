/**
 * OTEL analytics sub-route - real-time telemetry from OpenTelemetry.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useOtelAnalyticsQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

const OtelSection = lazy(() =>
  import("@/components/sections/OtelSection").then((m) => ({
    default: m.OtelSection,
  }))
);

export const Route = createFileRoute("/analytics/otel")({
  component: OtelRoute,
});

function OtelRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useOtelAnalyticsQuery(filter, harness);

  return (
    <Suspense fallback={<Skeleton className="h-[600px] w-full" />}>
      <OtelSection data={data ?? null} loading={isLoading} />
    </Suspense>
  );
}
