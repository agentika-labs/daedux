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

const SettingsScreenLazy = lazy(() =>
  import("@/components/settings/SettingsScreen").then((m) => ({
    default: m.SettingsScreen,
  }))
);

export const Route = createFileRoute("/settings")({
  staticData: { showHeader: false },
  loader: async () => {
    const [settings, appInfo, usage, schedules, authStatus, otelStatus] =
      await Promise.all([
        queryClient.ensureQueryData(settingsQueryOptions),
        queryClient.ensureQueryData(appInfoQueryOptions),
        queryClient
          .ensureQueryData(anthropicUsageQueryOptions)
          .catch(() => null),
        queryClient.ensureQueryData(schedulesQueryOptions),
        queryClient.ensureQueryData(authStatusQueryOptions),
        queryClient.ensureQueryData(otelStatusQueryOptions).catch(() => null),
      ]);
    return { settings, appInfo, usage, schedules, authStatus, otelStatus };
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
