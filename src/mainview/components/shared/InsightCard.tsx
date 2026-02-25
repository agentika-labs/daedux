import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  InformationCircleIcon,
  BulbIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export type InsightPriority = "high" | "medium" | "low";
export type InsightType = "success" | "warning" | "info" | "tip";

export interface InsightCardProps {
  headline: string;
  context?: string;
  priority?: InsightPriority;
  type: InsightType;
  action?: { label: string; onClick: () => void };
  dollarImpact?: number;
  className?: string;
}

const iconMap: Record<InsightType, typeof CheckmarkCircle02Icon> = {
  success: CheckmarkCircle02Icon,
  warning: AlertCircleIcon,
  info: InformationCircleIcon,
  tip: BulbIcon,
};

const colorMap: Record<InsightType, string> = {
  success: "border-success/30 bg-success/5",
  warning: "border-chart-4/30 bg-chart-4/5",
  info: "border-chart-2/30 bg-chart-2/5",
  tip: "border-chart-1/30 bg-chart-1/5",
};

const iconColorMap: Record<InsightType, string> = {
  success: "text-success",
  warning: "text-chart-4",
  info: "text-chart-2",
  tip: "text-chart-1",
};

const buttonColorMap: Record<InsightType, string> = {
  success: "text-success hover:text-success/80",
  warning: "text-chart-4 hover:text-chart-4/80",
  info: "text-chart-2 hover:text-chart-2/80",
  tip: "text-chart-1 hover:text-chart-1/80",
};

export function InsightCard({
  headline,
  context,
  priority = "medium",
  type,
  action,
  dollarImpact,
  className,
}: InsightCardProps) {
  const Icon = iconMap[type];

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-3 transition-colors",
        colorMap[type],
        priority === "high" && "ring-1 ring-current/20",
        className
      )}
      role="article"
      aria-label={`${type} insight: ${headline}`}
    >
      <HugeiconsIcon
        icon={Icon}
        className={cn("h-5 w-5 flex-shrink-0 mt-0.5", iconColorMap[type])}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{headline}</p>
          {dollarImpact !== undefined && dollarImpact > 0.5 && (
            <span
              className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0",
                type === "success"
                  ? "bg-success/20 text-success"
                  : type === "warning"
                    ? "bg-chart-4/20 text-chart-4"
                    : "bg-muted text-muted-foreground"
              )}
            >
              ${dollarImpact.toFixed(2)}
            </span>
          )}
        </div>
        {context && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{context}</p>
        )}
        {action && (
          <button
            onClick={action.onClick}
            className={cn(
              "inline-flex items-center gap-1 text-xs font-medium mt-2 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 rounded-sm",
              buttonColorMap[type]
            )}
            aria-label={`${action.label} for ${headline}`}
          >
            {action.label}
            <HugeiconsIcon icon={ArrowRight01Icon} className="h-3 w-3" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
