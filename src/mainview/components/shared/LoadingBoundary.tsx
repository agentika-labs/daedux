import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type SkeletonVariant = "list" | "grid" | "chart" | "card" | "stat";

interface LoadingBoundaryProps {
  loading?: boolean;
  /** Custom fallback to show while loading */
  fallback?: React.ReactNode;
  /** Predefined skeleton pattern to use */
  skeleton?: SkeletonVariant;
  /** Number of skeleton items to show (for list/grid) */
  count?: number;
  /** Height for chart skeletons */
  height?: number;
  className?: string;
  children: React.ReactNode;
}

/**
 * Wraps content with loading skeleton handling.
 * Use predefined skeleton variants or provide a custom fallback.
 */
export function LoadingBoundary({
  loading = false,
  fallback,
  skeleton,
  count = 3,
  height = 200,
  className,
  children,
}: LoadingBoundaryProps) {
  if (!loading) {
    return <>{children}</>;
  }

  // Use custom fallback if provided
  if (fallback) {
    return <>{fallback}</>;
  }

  // Render predefined skeleton variant
  switch (skeleton) {
    case "list": {
      return <ListSkeleton count={count} className={className} />;
    }
    case "grid": {
      return <GridSkeleton count={count} className={className} />;
    }
    case "chart": {
      return <ChartSkeleton height={height} className={className} />;
    }
    case "card": {
      return <CardSkeleton className={className} />;
    }
    case "stat": {
      return <StatSkeleton className={className} />;
    }
    default: {
      // Default to a simple skeleton
      return <Skeleton className={cn("h-20 w-full", className)} />;
    }
  }
}

// ─── Skeleton Variants ───────────────────────────────────────────────────────

interface SkeletonProps {
  className?: string;
}

interface ListSkeletonProps extends SkeletonProps {
  count?: number;
  itemHeight?: string;
}

export function ListSkeleton({
  count = 3,
  itemHeight = "h-10",
  className,
}: ListSkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cn("w-full", itemHeight)} />
      ))}
    </div>
  );
}

interface GridSkeletonProps extends SkeletonProps {
  count?: number;
  cols?: number;
}

export function GridSkeleton({
  count = 3,
  cols = 3,
  className,
}: GridSkeletonProps) {
  return (
    <div className={cn(`grid grid-cols-${cols} gap-4`, className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}

interface ChartSkeletonProps extends SkeletonProps {
  height?: number;
}

export function ChartSkeleton({ height = 200, className }: ChartSkeletonProps) {
  return <Skeleton className={cn("w-full", className)} style={{ height }} />;
}

export function CardSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-8 w-32" />
    </div>
  );
}

export function StatSkeleton({ className }: SkeletonProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="mb-2 h-4 w-20" />
      <Skeleton className="h-6 w-16" />
    </div>
  );
}
