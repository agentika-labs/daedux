/**
 * Overview route - hero stats, efficiency score, insights, and weekly comparison.
 *
 * This is the landing page that provides a quick scan of Claude Code usage.
 */
import { createFileRoute } from "@tanstack/react-router";

import { z } from "zod";

import { OverviewSection } from "@/components/sections/OverviewSection";
import { useDesktopRefetch } from "@/hooks/useDesktopRefetch";
import { queryClient } from "@/lib/query-client";
import { useDashboardQuery, dashboardQueryOptions } from "@/queries/dashboard";

// ─── Search Params Schema ────────────────────────────────────────────────────

const overviewSearchSchema = z.object({
  filter: z
    .enum(["today", "7d", "30d", "all"] as const)
    .default("7d")
    .catch("7d"),
  harness: z
    .enum(["claude-code", "opencode", "codex", "all"] as const)
    .default("claude-code")
    .catch("claude-code"),
});

export type OverviewSearch = z.infer<typeof overviewSearchSchema>;

// ─── Route Definition ────────────────────────────────────────────────────────

export const Route = createFileRoute("/")({
  validateSearch: overviewSearchSchema,
  loader: async () => {
    await queryClient.ensureQueryData(
      dashboardQueryOptions("7d", "claude-code")
    );
  },
  component: OverviewRoute,
});

// ─── Component ───────────────────────────────────────────────────────────────

function OverviewRoute() {
  const { filter, harness } = Route.useSearch();
  const { data, isLoading, error, refetch } = useDashboardQuery(
    filter,
    harness
  );

  useDesktopRefetch(refetch);

  if (error && !data) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-destructive mb-2 text-2xl font-semibold">
            Error
          </h1>
          <p className="text-muted-foreground">{error.message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="bg-primary text-primary-foreground mt-4 rounded-lg px-4 py-2"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <OverviewSection data={data ?? null} loading={isLoading} />
      </div>
    </div>
  );
}
