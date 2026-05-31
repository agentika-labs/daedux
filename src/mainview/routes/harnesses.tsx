import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { queryClient } from "@/lib/query-client";
import { agentHarnessesQueryOptions } from "@/queries/agent-harnesses";

const AgentHarnessesScreenLazy = lazy(async () =>
  import("@/components/agent-harnesses/AgentHarnessesScreen").then((m) => ({
    default: m.AgentHarnessesScreen,
  }))
);

export const Route = createFileRoute("/harnesses")({
  loader: async () => {
    await queryClient.ensureQueryData(agentHarnessesQueryOptions);
  },
  pendingComponent: HarnessesLoadingFallback,
  component: HarnessesRoute,
});

function HarnessesLoadingFallback() {
  return (
    <div className="bg-background flex h-full items-center justify-center">
      <div className="text-muted-foreground">Loading harnesses...</div>
    </div>
  );
}

function HarnessesRoute() {
  return (
    <Suspense fallback={<HarnessesLoadingFallback />}>
      <AgentHarnessesScreenLazy />
    </Suspense>
  );
}
