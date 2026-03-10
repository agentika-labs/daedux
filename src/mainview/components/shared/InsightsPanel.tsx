import { BulbIcon } from "@hugeicons/core-free-icons";
import type { Insight, InsightActionTarget } from "@shared/rpc-types";
import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { EmptyState } from "./EmptyState";
import { InsightCard } from "./InsightCard";
import type { InsightType } from "./InsightCard";

interface InsightsPanelProps {
  insights: Insight[];
  loading?: boolean;
  onNavigateToSection?: (section: string) => void;
  maxInsights?: number;
  className?: string;
}

/**
 * Displays a scrollable panel of insight cards with priority-based sorting.
 * Handles loading states, empty states, and navigation actions.
 */
export function InsightsPanel({
  insights,
  loading,
  onNavigateToSection,
  maxInsights = 5,
  className,
}: InsightsPanelProps) {
  // Memoize sorted insights with stable action objects to prevent re-renders
  const processedInsights = useMemo(
    () =>
      [...insights]
        .toSorted((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, maxInsights)
        .map((insight) => ({
          action: buildAction(insight, onNavigateToSection),
          insight,
          priority: (insight.priority && insight.priority > 5
            ? "high"
            : "medium") as "high" | "medium",
          type: mapInsightType(insight.type),
        })),
    [insights, maxInsights, onNavigateToSection]
  );

  return (
    <Card className={cn("card-interactive", className)}>
      <CardHeader className="pb-2">
        <CardTitle>Insights</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : processedInsights.length > 0 ? (
          <ScrollArea className="h-[340px]">
            <div className="space-y-3 pr-4">
              {processedInsights.map(({ insight, type, priority, action }) => (
                <InsightCard
                  key={insight.title}
                  headline={insight.title}
                  context={insight.description}
                  type={type}
                  priority={priority}
                  dollarImpact={insight.dollarImpact}
                  action={action}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <EmptyState
            icon={BulbIcon}
            title="No insights yet"
            description="Insights will appear as you use Claude Code and patterns emerge."
          />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function mapInsightType(type: Insight["type"]): InsightType {
  switch (type) {
    case "success": {
      return "success";
    }
    case "warning": {
      return "warning";
    }
    case "info":
    default: {
      return "info";
    }
  }
}

function buildAction(
  insight: Insight,
  onNavigateToSection?: (section: string) => void
): { label: string; onClick: () => void } | undefined {
  if (!insight.actionTarget || !onNavigateToSection) {
    return undefined;
  }

  return {
    label: insight.actionLabel ?? "View Details",
    onClick: () =>
      onNavigateToSection(insight.actionTarget as InsightActionTarget),
  };
}
