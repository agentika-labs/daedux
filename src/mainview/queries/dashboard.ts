/**
 * TanStack Query hooks for dashboard data.
 */
import { queryOptions, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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

export const useDashboardQuery = (filter: FilterOption) => {
  return useQuery(dashboardQueryOptions(filter));
};

// ─── Mutation Hooks ──────────────────────────────────────────────────────────

export const useSyncMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { fullResync?: boolean }) => api.triggerSync(params),
    onSuccess: () => {
      // Invalidate all dashboard data to refetch with new data
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
};
