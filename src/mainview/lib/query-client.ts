/**
 * TanStack Query client configuration with localStorage persistence.
 *
 * Provides caching, deduplication, background refetching, and cross-session
 * persistence for all server state. On cold start, persisted queries are
 * restored instantly from localStorage while fresh data loads in the background.
 */
import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { persistQueryClient } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

/** Bump this when persisted query data shapes change to invalidate stale caches. */
const CACHE_SCHEMA_VERSION = "v1";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      // Log query errors globally for debugging
      console.error(
        `[Query Error] ${query.queryKey.join("/")}:`,
        error.message
      );
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
      // Keep cache entries for 24 hours (required for persistence — must be >= maxAge)
      gcTime: 24 * 60 * 60_000,
      // Retry once on failure
      retry: 1,
      // Don't refetch on window focus by default
      refetchOnWindowFocus: false,
    },
  },
});

// ─── Persistence Setup ──────────────────────────────────────────────────────
//
// WKWebView with custom URL schemes (views://) may expose a localStorage
// object that silently fails or doesn't persist. Probe with a roundtrip test.

const isLocalStorageAvailable = (): boolean => {
  try {
    const key = "__daedux_ls_test__";
    window.localStorage.setItem(key, "1");
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

if (typeof window !== "undefined" && isLocalStorageAvailable()) {
  const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: "daedux-query-cache",
    throttleTime: 2000,
  });

  persistQueryClient({
    queryClient,
    persister,
    maxAge: 24 * 60 * 60_000,
    buster: CACHE_SCHEMA_VERSION,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) => {
        // Exclude large parameterized queries — persist everything else.
        const excludeKeys = ["dashboard", "otelAnalytics"];
        const key = query.queryKey[0];
        return !(typeof key === "string" && excludeKeys.includes(key));
      },
    },
  });
}
