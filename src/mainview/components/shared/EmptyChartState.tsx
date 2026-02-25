import { EmptyDescription } from "@/components/ui/empty";
import { cn } from "@/lib/utils";

interface EmptyChartStateProps {
  height?: number;
  message?: string;
  className?: string;
}

/**
 * A minimal empty state designed for chart containers.
 * Uses the Shadcn Empty primitive for consistent styling.
 */
export function EmptyChartState({
  height = 200,
  message = "No data available",
  className,
}: EmptyChartStateProps) {
  return (
    <div
      className={cn("flex items-center justify-center", className)}
      style={{ height }}
    >
      <EmptyDescription>{message}</EmptyDescription>
    </div>
  );
}
