import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { queryClient } from "@/lib/query-client";
import {
  settingsQueryOptions,
  appInfoQueryOptions,
  anthropicUsageQueryOptions,
  schedulesQueryOptions,
  authStatusQueryOptions,
  otelStatusQueryOptions,
} from "@/queries/settings";

// Slow queries are prefetched without blocking - components show skeletons
// until data arrives. Usage data is often already warm from the backend push.
const prefetchSlowQueries = () => {
  queryClient.prefetchQuery(anthropicUsageQueryOptions);
  queryClient.prefetchQuery(schedulesQueryOptions);
  queryClient.prefetchQuery(authStatusQueryOptions);
  queryClient.prefetchQuery(otelStatusQueryOptions);
};

const SettingsScreenLazy = lazy(() =>
  import("@/components/settings/SettingsScreen").then((m) => ({
    default: m.SettingsScreen,
  }))
);

export const Route = createFileRoute("/settings")({
  staticData: { showHeader: false },
  loader: async () => {
    // Fire-and-forget slow queries - components show skeletons until ready
    prefetchSlowQueries();

    // Only block on fast, essential queries
    const [settings, appInfo] = await Promise.all([
      queryClient.ensureQueryData(settingsQueryOptions),
      queryClient.ensureQueryData(appInfoQueryOptions),
    ]);
    return { settings, appInfo };
  },
  pendingComponent: SettingsLoadingFallback,
  component: SettingsRoute,
});

function SettingsLoadingFallback() {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="text-muted-foreground">Loading settings...</div>
    </div>
  );
}

function SettingsRoute() {
  return (
    <Suspense fallback={<SettingsLoadingFallback />}>
      <SettingsScreenLazy />
    </Suspense>
  );
}
