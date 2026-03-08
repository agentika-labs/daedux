import type { HarnessId } from "@shared/rpc-types";
/**
 * TanStack Query hooks for dashboard data.
 */
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { getApiClient } from "@/hooks/useApi";

const api = getApiClient();

// ─── Types ───────────────────────────────────────────────────────────────────

export type FilterOption = "today" | "7d" | "30d" | "all";
export type HarnessFilterOption = HarnessId | "all";

// ─── Query Options ───────────────────────────────────────────────────────────

export const dashboardQueryOptions = (
  filter: FilterOption,
  harness: HarnessFilterOption = "claude-code"
) =>
  queryOptions({
    queryKey: ["dashboard", filter, harness],
    queryFn: () =>
      api.getDashboardData({
        filter,
        harness: harness === "all" ? undefined : harness,
      }),
    // Dashboard data updates frequently, keep it fresh for 30s
    staleTime: 30_000,
  });

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export const useDashboardQuery = (
  filter: FilterOption,
  harness: HarnessFilterOption = "claude-code"
) => useQuery(dashboardQueryOptions(filter, harness));

// ─── OTEL Analytics Query ─────────────────────────────────────────────────────

export const otelAnalyticsQueryOptions = (filter: FilterOption) =>
  queryOptions({
    queryKey: ["otelAnalytics", filter],
    queryFn: () => api.getOtelAnalytics(filter),
    staleTime: 30_000,
    retry: false,
  });

export const useOtelAnalyticsQuery = (filter: FilterOption) =>
  useQuery(otelAnalyticsQueryOptions(filter));

// ─── Mutation Hooks ──────────────────────────────────────────────────────────

/**
 * Sync mutation that invalidates only the current filter's query.
 * This prevents triggering parallel fetches for all cached filter variants.
 */
export const useSyncMutation = (
  activeFilter?: FilterOption,
  activeHarness: HarnessFilterOption = "claude-code"
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { fullResync?: boolean }) => api.triggerSync(params),
    onSuccess: () => {
      // Only invalidate the active filter's query to avoid parallel fetches
      if (activeFilter) {
        queryClient.invalidateQueries({
          queryKey: ["dashboard", activeFilter, activeHarness],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
};
