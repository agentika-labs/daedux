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

const SettingsScreenLazy = lazy(() =>
  import("@/components/settings/SettingsScreen").then((m) => ({
    default: m.SettingsScreen,
  })),
);

export const Route = createFileRoute("/settings")({
  loader: async () => {
    const [settings, appInfo, usage, schedules, authStatus] = await Promise.all(
      [
        queryClient.ensureQueryData(settingsQueryOptions),
        queryClient.ensureQueryData(appInfoQueryOptions),
        queryClient
          .ensureQueryData(anthropicUsageQueryOptions)
          .catch(() => null),
        queryClient.ensureQueryData(schedulesQueryOptions),
        queryClient.ensureQueryData(authStatusQueryOptions),
      ],
    );
    return { settings, appInfo, usage, schedules, authStatus };
  },
  pendingComponent: SettingsLoadingFallback,
  component: SettingsRoute,
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
