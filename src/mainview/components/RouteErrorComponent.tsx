/**
 * Route-level error component for graceful error display.
 *
 * Shows the error message with options to retry or navigate home.
 * Used as errorComponent in route definitions to catch component errors.
 */
import { useRouter } from "@tanstack/react-router";

interface RouteErrorComponentProps {
  error: Error;
  reset?: () => void;
}

export function RouteErrorComponent({
  error,
  reset,
}: RouteErrorComponentProps) {
  const router = useRouter();

  return (
    <div className="bg-background flex h-screen items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-destructive mb-2 text-xl font-bold">
          Error loading this page
        </h1>
        <pre className="bg-muted text-muted-foreground mb-4 max-h-32 overflow-auto rounded p-3 text-left text-xs">
          {error.message}
        </pre>
        <div className="flex justify-center gap-3">
          {reset && (
            <button
              type="button"
              onClick={() => {
                reset();
                router.invalidate();
              }}
              className="bg-primary text-primary-foreground rounded px-4 py-2 text-sm"
            >
              Try Again
            </button>
          )}
          <button
            type="button"
            onClick={() => router.navigate({ to: "/" })}
            className="bg-muted text-muted-foreground rounded px-4 py-2 text-sm"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
