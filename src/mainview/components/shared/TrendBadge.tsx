import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type TrendDirection = "up" | "down" | "stable";

export interface TrendBadgeProps {
  value: number;
  direction: TrendDirection;
  /** If true, "up" means bad (e.g., costs going up) */
  inverse?: boolean;
  className?: string;
}

export function TrendBadge({
  value,
  direction,
  inverse = false,
  className,
}: TrendBadgeProps) {
  const isPositive = inverse ? direction === "down" : direction === "up";
  const isNegative = inverse ? direction === "up" : direction === "down";

  const displayValue = Math.abs(value);
  const formattedValue =
    displayValue >= 100
      ? `${Math.round(displayValue)}%`
      : `${displayValue.toFixed(1)}%`;

  const icon = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";

  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-medium gap-0.5",
        isPositive && "border-success/30 bg-success/10 text-success",
        isNegative &&
          "border-destructive/30 bg-destructive/10 text-destructive",
        direction === "stable" &&
          "border-muted-foreground/30 bg-muted text-muted-foreground",
        className
      )}
    >
      <span>{icon}</span>
      <span>{formattedValue}</span>
    </Badge>
  );
}
