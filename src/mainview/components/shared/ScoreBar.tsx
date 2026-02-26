import { cn } from "@/lib/utils";

interface ScoreBarProps {
  label: string;
  value: number;
  className?: string;
}

/**
 * A horizontal progress bar for displaying scores/percentages.
 * Color-coded: green (>=75), yellow (>=50), red (<50).
 */
export function ScoreBar({ label, value, className }: ScoreBarProps) {
  const color =
    value >= 75 ? "bg-success" : value >= 50 ? "bg-chart-4" : "bg-destructive";

  return (
    <div className={className}>
      <div className="mb-1 flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(value)}%</span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full transition-all duration-300", color)}
          style={{ width: `${Math.min(100, value)}%` }}
        />
      </div>
    </div>
  );
}
