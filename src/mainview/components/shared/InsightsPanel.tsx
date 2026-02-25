import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { InsightCard, type InsightType } from "./InsightCard";
import type { Insight, InsightActionTarget } from "@shared/rpc-types";

interface InsightsPanelProps {
  insights: Insight[];
  loading?: boolean;
  onNavigateToSection?: (section: string) => void;
  maxHeight?: string;
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
  maxHeight = "320px",
  maxInsights = 5,
  className,
}: InsightsPanelProps) {
  // Sort by priority (highest first) and limit count
  const sortedInsights = [...insights]
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    .slice(0, maxInsights);

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
        ) : sortedInsights.length > 0 ? (
          <ScrollArea style={{ maxHeight }}>
            <div className="space-y-3 pr-2">
              {sortedInsights.map((insight, i) => (
                <InsightCard
                  key={insight.title + i}
                  headline={insight.title}
                  context={insight.description}
                  type={mapInsightType(insight.type)}
                  priority={insight.priority && insight.priority > 5 ? "high" : "medium"}
                  dollarImpact={insight.dollarImpact}
                  action={buildAction(insight, onNavigateToSection)}
                />
              ))}
            </div>
          </ScrollArea>
        ) : (
          <p className="text-center text-muted-foreground py-8">No insights available</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function mapInsightType(type: Insight["type"]): InsightType {
  switch (type) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "info":
    default:
      return "info";
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
    onClick: () => onNavigateToSection(insight.actionTarget as InsightActionTarget),
  };
}
