import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  AlertCircleIcon,
  InformationCircleIcon,
  BulbIcon
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

export function InsightCard({
  headline,
  context,
  priority = "medium",
  type,
  action,
  className,
}: InsightCardProps) {
  const Icon = iconMap[type];

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-3",
        colorMap[type],
        priority === "high" && "ring-1 ring-current/20",
        className
      )}
    >
      <HugeiconsIcon
        icon={Icon}
        className={cn("h-5 w-5 flex-shrink-0 mt-0.5", iconColorMap[type])}
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{headline}</p>
        {context && (
          <p className="text-xs text-muted-foreground mt-0.5">{context}</p>
        )}
        {action && (
          <button
            onClick={action.onClick}
            className="text-xs text-primary hover:underline mt-1"
          >
            {action.label} →
          </button>
        )}
      </div>
    </div>
  );
}
