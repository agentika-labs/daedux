import type { Insight, InsightActionTarget } from "@shared/rpc-types";
import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";

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
    <Card className={className}>
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
              {processedInsights.map(
                ({ insight, type, priority, action }, i) => (
                  <InsightCard
                    key={insight.title + i}
                    headline={insight.title}
                    context={insight.description}
                    type={type}
                    priority={priority}
                    dollarImpact={insight.dollarImpact}
                    action={action}
                  />
                )
              )}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-muted-foreground py-8 text-center">
            No insights available
          </p>
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
