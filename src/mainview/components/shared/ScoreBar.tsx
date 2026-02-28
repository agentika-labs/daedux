import { cn } from "@/lib/utils";

interface ScoreBarProps {
  label: string;
  value: number | null;
  className?: string;
  /** Text to show when value is null (no data). Defaults to "No data" */
  emptyText?: string;
}

/**
 * A horizontal progress bar for displaying scores/percentages.
 * Color-coded: green (>=75), yellow (>=50), red (<50).
 * Shows gray bar with emptyText when value is null.
 */
export function ScoreBar({
  label,
  value,
  className,
  emptyText = "No data",
}: ScoreBarProps) {
  const hasData = value !== null;
  const color = hasData
    ? value >= 75
      ? "bg-success"
      : value >= 50
        ? "bg-chart-4"
        : "bg-destructive"
    : "bg-muted";

  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn("font-medium", !hasData && "text-muted-foreground")}
        >
          {hasData ? `${Math.round(value)}%` : emptyText}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full transition-all duration-300", color)}
          style={{ width: hasData ? `${Math.min(100, value)}%` : "0%" }}
        />
      </div>
    </div>
  );
}
