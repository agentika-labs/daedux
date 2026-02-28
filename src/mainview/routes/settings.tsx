/**
 * Settings route - prefetches all settings data on navigation.
 *
 * The loader runs on hover (via preload="intent") so data is ready
 * before the user even clicks. This eliminates the waterfall loading
 * pattern that caused the slow settings screen.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, lazy } from "react";

import { queryClient } from "@/lib/query-client";
import {
  settingsQueryOptions,
  appInfoQueryOptions,
  anthropicUsageQueryOptions,
  schedulesQueryOptions,
  authStatusQueryOptions,
} from "@/queries/settings";

// Lazy-load SettingsScreen since it's only needed on /settings
const SettingsScreenLazy = lazy(() =>
  import("@/components/settings/SettingsScreen").then((m) => ({
    default: m.SettingsScreen,
  }))
);

export const Route = createFileRoute("/settings")({
  // Prefetch all settings data in parallel and return for type-safe access
  loader: async () => {
    // Use ensureQueryData to either return cached data or fetch it
    // These all run in parallel, not sequentially
    const [settings, appInfo, usage, schedules, authStatus] = await Promise.all([
      queryClient.ensureQueryData(settingsQueryOptions),
      queryClient.ensureQueryData(appInfoQueryOptions),
      queryClient.ensureQueryData(anthropicUsageQueryOptions).catch(() => null),
      queryClient.ensureQueryData(schedulesQueryOptions),
      queryClient.ensureQueryData(authStatusQueryOptions),
    ]);
    // Return data for type-safe Route.useLoaderData() access in components
    return { settings, appInfo, usage, schedules, authStatus };
  },
  // Show this while the component chunk loads
  pendingComponent: SettingsLoadingFallback,
  // Use lazy component loading
  component: SettingsRoute,
  // Uses defaultErrorComponent from router config
});

function SettingsLoadingFallback() {
  return (
    <div className="bg-background flex h-screen items-center justify-center">
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
