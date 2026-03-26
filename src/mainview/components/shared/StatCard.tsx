import { Card, CardContent } from "@/components/ui/card";
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

  // Gradient background for hero cards
  const gradientClass = isHero
    ? variant === "success"
      ? "hero-gradient-success"
      : "hero-gradient-primary"
    : "";

  if (loading) {
    return (
      <Card
        size="sm"
        className={cn("min-h-[100px]", isHero && "min-h-[120px]", className)}
      >
        <CardContent className={cn("pt-4", isHero && "pt-5")}>
          <Skeleton className={cn("mb-2 h-4 w-20", isHero && "h-5 w-24")} />
          <Skeleton className={cn("mb-2 h-8 w-24", isHero && "h-10 w-32")} />
          <Skeleton className="h-3 w-16" />
        </CardContent>
      </Card>
    );
  }

  const valueColorClass = {
    default: "",
    destructive: "text-destructive",
    success: "text-success",
    warning: "text-chart-4",
  }[variant];

  return (
    <Card
      size="sm"
      className={cn(
        "card-interactive min-h-[100px]",
        isHero && "min-h-[120px]",
        gradientClass,
        className
      )}
    >
      <CardContent className={cn("pt-4", isHero && "pt-5")}>
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <p
              className={cn(
                "text-muted-foreground text-sm",
                isHero && "font-medium"
              )}
            >
              {label}
            </p>
            {tooltip}
          </div>
          {trend && (
            <TrendBadge value={trend.value} direction={trend.direction} />
          )}
        </div>
        <p
          className={cn(
            "stat-value font-bold tracking-tight",
            isHero ? "text-3xl" : "text-2xl",
            valueColorClass
          )}
        >
          {value}
        </p>
        {subtext && (
          <p className="text-muted-foreground mt-1 text-xs">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}
