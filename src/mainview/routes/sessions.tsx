/**
 * Sessions route - full-height table with search, filter, and pagination.
 *
 * Uses URL search params for filter state to enable shareable URLs.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { z } from "zod";

import { SessionsSection } from "@/components/sections/SessionsSection";
import { useIsDesktop } from "@/hooks/useApi";
import { queryClient } from "@/lib/query-client";
import { useDashboardQuery, dashboardQueryOptions } from "@/queries/dashboard";

// ─── Search Params Schema ────────────────────────────────────────────────────

const sessionsSearchSchema = z.object({
  filter: z
    .enum(["today", "7d", "30d", "all"] as const)
    .default("7d")
    .catch("7d"),
  harness: z
    .enum(["claude-code", "opencode", "codex", "all"] as const)
    .default("claude-code")
    .catch("claude-code"),
});

export type SessionsSearch = z.infer<typeof sessionsSearchSchema>;

// ─── Route Definition ────────────────────────────────────────────────────────

export const Route = createFileRoute("/sessions")({
  validateSearch: sessionsSearchSchema,
  loaderDeps: ({ search: { filter, harness } }) => ({ filter, harness }),
  loader: async ({ deps: { filter, harness } }) => {
    await queryClient.ensureQueryData(dashboardQueryOptions(filter, harness));
  },
  component: SessionsRoute,
});

// ─── Component ───────────────────────────────────────────────────────────────

function SessionsRoute() {
  const { filter, harness } = Route.useSearch();
  const isDesktop = useIsDesktop();
  const { data, isLoading, refetch } = useDashboardQuery(filter, harness);

  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;

  // Listen for desktop updates
  useEffect(() => {
    if (!isDesktop) {
      return;
    }

    let cleanup: (() => void) | undefined;

    import("@/hooks/useRPC").then(({ electroview }) => {
      const handleUpdate = () => refetchRef.current();
      electroview.addMessageListener("sessionsUpdated", handleUpdate);
      cleanup = () =>
        electroview.removeMessageListener("sessionsUpdated", handleUpdate);
    });

    return () => cleanup?.();
  }, [isDesktop]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <SessionsSection data={data ?? null} loading={isLoading} />
    </div>
  );
}
