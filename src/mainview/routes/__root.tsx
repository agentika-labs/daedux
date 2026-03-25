/**
 * Root route - wraps all other routes with providers and layout.
 *
 * TanStack Router uses this as the outermost wrapper for all routes.
 * We provide QueryClient context here so all routes can access React Query.
 * QueryErrorResetBoundary + ErrorBoundary catches unhandled errors.
 */
import {
  QueryClientProvider,
  QueryErrorResetBoundary,
} from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Outlet,
  useMatches,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { Header } from "@/components/layout/Header";
import "@/lib/router-types"; // Type augmentation for staticData
import { queryClient } from "../lib/query-client";

// Lazy load devtools - avoids ~50KB combined in production bundle
// Static imports include the code even when conditionally rendered
const ReactQueryDevtools = lazy(() =>
  import("@tanstack/react-query-devtools").then((m) => ({
    default: m.ReactQueryDevtools,
  }))
);
const TanStackRouterDevtools = lazy(() =>
  import("@tanstack/router-devtools").then((m) => ({
    default: m.TanStackRouterDevtools,
  }))
);

// ─── Route Context Type ──────────────────────────────────────────────────────
// This allows routes to access the queryClient in their loaders

interface RouterContext {
  queryClient: typeof queryClient;
}

// ─── Root Route ──────────────────────────────────────────────────────────────

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootComponent,
});

function RootComponent() {
  const showHeader = useMatches({
    select: (matches) =>
      !matches.some((m) => m.staticData?.showHeader === false),
  });

  return (
    <QueryClientProvider client={queryClient}>
      <QueryErrorResetBoundary>
        {({ reset }) => (
          <ErrorBoundary
            onReset={reset}
            fallbackRender={({ error, resetErrorBoundary }) => (
              <div className="bg-background flex h-screen items-center justify-center p-8">
                <div className="max-w-lg text-center">
                  <h1 className="text-destructive mb-4 text-2xl font-bold">
                    Something went wrong
                  </h1>
                  <pre className="bg-muted text-muted-foreground mb-4 max-h-48 overflow-auto rounded p-4 text-left text-xs">
                    {error instanceof Error ? error.message : String(error)}
                  </pre>
                  <button
                    type="button"
                    onClick={resetErrorBoundary}
                    className="bg-primary text-primary-foreground rounded px-4 py-2"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          >
            <div className="bg-background text-foreground flex h-screen flex-col">
              {showHeader && <Header />}
              <main className="flex-1 overflow-auto">
                <Outlet />
              </main>
            </div>
          </ErrorBoundary>
        )}
      </QueryErrorResetBoundary>
      {/* Dev tools - only visible in development, lazy loaded */}
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools buttonPosition="bottom-left" />
          <TanStackRouterDevtools position="bottom-right" />
        </Suspense>
      )}
    </QueryClientProvider>
  );
}
