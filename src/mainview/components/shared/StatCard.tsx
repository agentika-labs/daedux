import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { TrendBadge } from "./TrendBadge";
import type { TrendDirection } from "./TrendBadge";

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: { value: number; direction: TrendDirection };
  variant?: "default" | "success" | "warning" | "destructive";
  /** Size variant - "hero" for primary metrics with larger typography */
  size?: "default" | "hero";
  loading?: boolean;
  className?: string;
  /** Optional tooltip element (e.g., InfoTooltip) displayed after the label */
  tooltip?: React.ReactNode;
}

export function StatCard({
  label,
  value,
  subtext,
  trend,
  variant = "default",
  size = "default",
  loading = false,
  className,
  tooltip,
}: StatCardProps) {
  const isHero = size === "hero";

  if (loading) {
    return (
      <div
        className={cn(
          "border-border flex flex-col justify-center gap-2 border-l px-6 py-4 first:border-l-0",
          className
        )}
      >
        <Skeleton className="h-3 w-20" />
        <Skeleton className={cn("h-7 w-24", isHero && "h-8 w-28")} />
        <Skeleton className="h-3 w-16" />
      </div>
    );
  }

  const valueColorClass = {
    default: "",
    destructive: "text-destructive",
    success: "text-success",
    warning: "text-chart-4",
  }[variant];

  return (
    <div
      className={cn(
        "border-border flex flex-col justify-center gap-1 border-l px-6 py-4 first:border-l-0",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground text-[11px]">{label}</span>
          {tooltip}
        </div>
        {trend && (
          <TrendBadge value={trend.value} direction={trend.direction} />
        )}
      </div>
      <span
        className={cn(
          "stat-value font-heading font-normal leading-tight tracking-tight",
          isHero ? "text-[28px]" : "text-2xl",
          valueColorClass
        )}
      >
        {value}
      </span>
      {subtext && (
        <span className="text-muted-foreground text-[11px]">{subtext}</span>
      )}
    </div>
  );
}
