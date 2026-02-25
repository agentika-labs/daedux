import { cn } from "@/lib/utils";
import { SEMANTIC_STYLES, type SemanticVariant } from "@/lib/semantic-styles";
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

// Map InsightType to SemanticVariant (they align 1:1)
function getStyles(type: InsightType) {
  return SEMANTIC_STYLES[type as SemanticVariant];
}

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
  const styles = getStyles(type);

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-3 transition-colors",
        styles.bg,
        styles.border,
        priority === "high" && "ring-1 ring-current/20",
        className
      )}
      role="article"
      aria-label={`${type} insight: ${headline}`}
    >
      <HugeiconsIcon
        icon={Icon}
        className={cn("h-5 w-5 flex-shrink-0 mt-0.5", styles.text)}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium leading-tight">{headline}</p>
          {dollarImpact !== undefined && dollarImpact > 0.5 && (
            <span
              className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded flex-shrink-0",
                styles.badgeBg,
                styles.text
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
              styles.button
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
