import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendBadge, type TrendDirection } from "./TrendBadge";

export interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  trend?: { value: number; direction: TrendDirection };
  comparison?: { label: string; value: string };
  variant?: "default" | "success" | "warning" | "destructive";
  loading?: boolean;
  className?: string;
}

export function StatCard({
  label,
  value,
  subtext,
  trend,
  comparison,
  variant = "default",
  loading = false,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <Card size="sm" className={cn("min-h-[100px]", className)}>
        <CardContent className="pt-4">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-8 w-24 mb-2" />
          <Skeleton className="h-3 w-16" />
        </CardContent>
      </Card>
    );
  }

  const valueColorClass = {
    default: "",
    success: "text-success",
    warning: "text-chart-4",
    destructive: "text-destructive",
  }[variant];

  return (
    <Card size="sm" className={cn("min-h-[100px]", className)}>
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm text-muted-foreground">{label}</p>
          {trend && <TrendBadge value={trend.value} direction={trend.direction} />}
        </div>
        <p className={cn("text-2xl font-semibold", valueColorClass)}>{value}</p>
        {subtext && (
          <p className="text-xs text-muted-foreground mt-1">{subtext}</p>
        )}
        {comparison && (
          <p className="text-xs text-muted-foreground mt-1">
            {comparison.label}: {comparison.value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
