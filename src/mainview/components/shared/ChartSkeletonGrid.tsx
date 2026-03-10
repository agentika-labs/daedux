import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChartSkeletonGridProps {
  columns?: number;
  rows?: number;
  className?: string;
  itemClassName?: string;
}

/**
 * Reusable grid of skeleton placeholders for loading states.
 * Defaults to a 2x2 grid layout.
 */
export function ChartSkeletonGrid({
  columns = 2,
  rows = 2,
  className,
  itemClassName,
}: ChartSkeletonGridProps) {
  const count = columns * rows;

  return (
    <div
      className={cn("grid gap-4", className)}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {/* Skeleton grid - index keys safe for static placeholder arrays that never reorder/filter */}
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className={cn("h-20", itemClassName)} />
      ))}
    </div>
  );
}
