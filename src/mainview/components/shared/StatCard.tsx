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
  loading = false,
  className,
  tooltip,
}: StatCardProps) {
  if (loading) {
    return (
      <Card size="sm" className={cn("min-h-[100px]", className)}>
        <CardContent className="pt-4">
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="mb-2 h-8 w-24" />
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
    <Card size="sm" className={cn("min-h-[100px]", className)}>
      <CardContent className="pt-4">
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <p className="text-muted-foreground text-sm">{label}</p>
            {tooltip}
          </div>
          {trend && (
            <TrendBadge value={trend.value} direction={trend.direction} />
          )}
        </div>
        <p className={cn("text-2xl font-semibold", valueColorClass)}>{value}</p>
        {subtext && (
          <p className="text-muted-foreground mt-1 text-xs">{subtext}</p>
        )}
      </CardContent>
    </Card>
  );
}
