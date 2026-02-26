import { cn } from "@/lib/utils";

interface ComparisonCardProps {
  label: string;
  thisWeek: string;
  lastWeek: string;
  change: number;
  /** If true, negative change is good (e.g., cost decrease) */
  isInverse?: boolean;
  className?: string;
}

/**
 * Displays a metric comparison between two time periods (e.g., this week vs last week).
 * Shows current value, previous value, and percentage change with color coding.
 */
export function ComparisonCard({
  label,
  thisWeek,
  lastWeek,
  change,
  isInverse = false,
  className,
}: ComparisonCardProps) {
  const isPositive = isInverse ? change < 0 : change > 0;
  const displayChange = Math.abs(change);

  return (
    <div className={cn("text-center", className)}>
      <p className="text-muted-foreground mb-1 text-sm">{label}</p>
      <p className="text-xl font-semibold">{thisWeek}</p>
      <div className="mt-1 flex items-center justify-center gap-1">
        <span className="text-muted-foreground text-xs">vs {lastWeek}</span>
        {change !== 0 && (
          <span
            className={cn(
              "text-xs font-medium",
              isPositive ? "text-success" : "text-destructive"
            )}
          >
            {isPositive ? "+" : "-"}
            {displayChange.toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
