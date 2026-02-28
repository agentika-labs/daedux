/**
 * TanStack Query client configuration.
 *
 * This provides caching, deduplication, and background refetching
 * for all server state in the application.
 */
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Log query errors globally for debugging
      console.error(`[Query Error] ${query.queryKey.join("/")}:`, error.message);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      // Log mutation errors globally
      console.error("[Mutation Error]:", error.message);
    },
  }),
  defaultOptions: {
    queries: {
      // Data is fresh for 30 seconds - no refetch on navigation
      staleTime: 30_000,
      // Keep unused cache entries for 5 minutes
      gcTime: 5 * 60_000,
      // Retry once on failure
      retry: 1,
      // Don't refetch on window focus by default
      refetchOnWindowFocus: false,
    },
  },
});
