/**
 * OTEL analytics sub-route - real-time telemetry from OpenTelemetry.
 */
import { createFileRoute } from "@tanstack/react-router";

import { OtelSection } from "@/components/sections/OtelSection";
import { useOtelAnalyticsQuery } from "@/queries/dashboard";

import type { AnalyticsSearch } from "../analytics";

export const Route = createFileRoute("/analytics/otel")({
  component: OtelRoute,
});

function OtelRoute() {
  const { filter, harness } = Route.useSearch() as AnalyticsSearch;
  const { data, isLoading } = useOtelAnalyticsQuery(filter, harness);

  return <OtelSection data={data ?? null} loading={isLoading} />;
}
