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

// ─── Query Options ───────────────────────────────────────────────────────────

export const dashboardQueryOptions = (filter: FilterOption) =>
  queryOptions({
    queryKey: ["dashboard", filter],
    queryFn: () => api.getDashboardData({ filter }),
    // Dashboard data updates frequently, keep it fresh for 30s
    staleTime: 30_000,
  });

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export const useDashboardQuery = (filter: FilterOption) =>
  useQuery(dashboardQueryOptions(filter));

// ─── Mutation Hooks ──────────────────────────────────────────────────────────

/**
 * Sync mutation that invalidates only the current filter's query.
 * This prevents triggering parallel fetches for all cached filter variants.
 */
export const useSyncMutation = (activeFilter?: FilterOption) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { fullResync?: boolean }) => api.triggerSync(params),
    onSuccess: () => {
      // Only invalidate the active filter's query to avoid parallel fetches
      if (activeFilter) {
        queryClient.invalidateQueries({
          queryKey: ["dashboard", activeFilter],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
};
