import type {
  AppSettings,
  SessionSchedule,
  AuthStatus,
} from "@shared/rpc-types";
/**
 * TanStack Query hooks for settings-related data.
 *
 * These hooks wrap the API client methods and provide:
 * - Automatic caching and deduplication
 * - Background refetching
 * - Loading/error states
 * - Prefetching on hover via route loaders
 */
import {
  queryOptions,
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import { getApiClient } from "@/hooks/useApi";

const api = getApiClient();

// Dynamic import for rpcRequest to avoid loading electrobun at module parse time
// This allows HTTP/CLI mode to work without Electrobun being available
async function getRpcRequest() {
  const { rpcRequest } = await import("@/hooks/useRPC");
  return rpcRequest;
}

// ─── Query Options ───────────────────────────────────────────────────────────
// These are reusable query definitions that can be used in hooks and route loaders

export const settingsQueryOptions = queryOptions({
  queryKey: ["settings"],
  queryFn: () => api.getSettings(),
});

export const appInfoQueryOptions = queryOptions({
  queryKey: ["appInfo"],
  queryFn: () => api.getAppInfo(),
});

export const anthropicUsageQueryOptions = queryOptions({
  queryKey: ["anthropicUsage"],
  queryFn: () => api.getAnthropicUsage(),
  // Usage data can fail if not authenticated
  retry: false,
});

/**
 * Auth status is cached aggressively since it spawns a subprocess (~50-200ms).
 * Fresh for 1 minute to avoid refetching on every navigation.
 */
export const authStatusQueryOptions = queryOptions({
  queryKey: ["authStatus"],
  queryFn: async (): Promise<AuthStatus> => {
    const rpcRequest = await getRpcRequest();
    return rpcRequest("getAuthStatus", {});
  },
  staleTime: 60_000, // Fresh for 1 minute
  gcTime: 5 * 60_000, // Keep in cache for 5 minutes
  retry: false, // Don't retry failed auth checks
});

export const schedulesQueryOptions = queryOptions({
  queryKey: ["schedules"],
  queryFn: async (): Promise<SessionSchedule[]> => {
    const rpcRequest = await getRpcRequest();
    return rpcRequest("getSchedules", {});
  },
});

// ─── Query Hooks ─────────────────────────────────────────────────────────────

export const useSettingsQuery = () => useQuery(settingsQueryOptions);

export const useAppInfoQuery = () => useQuery(appInfoQueryOptions);

export const useAnthropicUsageQuery = () =>
  useQuery(anthropicUsageQueryOptions);

export const useAuthStatusQuery = () => useQuery(authStatusQueryOptions);

export const useSchedulesQuery = () => useQuery(schedulesQueryOptions);

// ─── Mutation Hooks ──────────────────────────────────────────────────────────

export const useUpdateSettingsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (settings: Partial<AppSettings>) => {
      const rpcRequest = await getRpcRequest();
      return rpcRequest("updateSettings", settings);
    },
    onMutate: async (newSettings) => {
      // Cancel in-flight queries to avoid race conditions
      await queryClient.cancelQueries({ queryKey: ["settings"] });
      // Snapshot previous value for rollback
      const previousSettings = queryClient.getQueryData<AppSettings>([
        "settings",
      ]);
      // Optimistically update cache
      if (previousSettings) {
        queryClient.setQueryData<AppSettings>(["settings"], {
          ...previousSettings,
          ...newSettings,
        });
      }
      return { previousSettings };
    },
    onError: (_err, _newSettings, context) => {
      // Rollback on error
      if (context?.previousSettings) {
        queryClient.setQueryData(["settings"], context.previousSettings);
      }
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });
};

/**
 * @deprecated Use useAnthropicUsageQuery().refetch() instead.
 * The query hook provides refetch() and isFetching for refresh functionality.
 */
export const useRefreshAnthropicUsageMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.getAnthropicUsage(),
    onSuccess: (data) => {
      queryClient.setQueryData(["anthropicUsage"], data);
    },
  });
};
