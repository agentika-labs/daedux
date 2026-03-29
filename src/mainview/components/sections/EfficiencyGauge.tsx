import type { DashboardData } from "@shared/rpc-types";
import React from "react";

import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { ScoreBar } from "@/components/shared/ScoreBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EfficiencyGaugeProps {
  efficiencyScore: DashboardData["efficiencyScore"] | undefined;
  loading?: boolean;
}

export const EfficiencyGauge = React.memo(function EfficiencyGauge({
  efficiencyScore,
  loading,
}: EfficiencyGaugeProps) {
  return (
    <Card className="lg:col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span>Efficiency Score</span>
          {efficiencyScore && (
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                efficiencyScore.trend === "improving"
                  ? "bg-success/10 text-success"
                  : efficiencyScore.trend === "declining"
                    ? "bg-destructive/10 text-destructive"
                    : "bg-muted text-muted-foreground"
              )}
            >
              {efficiencyScore.trend === "improving"
                ? "Improving"
                : efficiencyScore.trend === "declining"
                  ? "Declining"
                  : "Stable"}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <LoadingBoundary
          loading={loading}
          fallback={
            <div className="space-y-4">
              <div className="bg-muted mx-auto h-24 w-24 animate-pulse rounded-full" />
              <div className="space-y-2">
                <div className="bg-muted h-4 w-full animate-pulse rounded" />
                <div className="bg-muted h-4 w-full animate-pulse rounded" />
                <div className="bg-muted h-4 w-full animate-pulse rounded" />
              </div>
            </div>
          }
        >
          {efficiencyScore ? (
            <div className="space-y-4">
              {/* Circular gauge */}
              <div className="flex items-center justify-center py-4">
                <div className="relative h-28 w-28">
                  <svg
                    className="h-full w-full -rotate-90"
                    viewBox="0 0 100 100"
                  >
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      className="text-muted"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="8"
                      strokeLinecap="round"
                      strokeDasharray={`${(efficiencyScore.overall / 100) * 251.2} 251.2`}
                      className={cn(
                        "transition-all duration-700 ease-out",
                        efficiencyScore.overall >= 75
                          ? "text-success"
                          : efficiencyScore.overall >= 50
                            ? "text-chart-4"
                            : "text-destructive"
                      )}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="stat-value text-2xl font-bold">
                      {Math.round(efficiencyScore.overall)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Sub-scores */}
              <div className="space-y-3">
                <ScoreBar
                  label="Cache"
                  value={efficiencyScore.cacheEfficiency}
                />
                <ScoreBar
                  label="Tool Success"
                  value={efficiencyScore.toolSuccess}
                  emptyText="No tool calls"
                />
                <ScoreBar
                  label="Session"
                  value={efficiencyScore.sessionEfficiency}
                />
              </div>

              {efficiencyScore.topOpportunity && (
                <p className="text-muted-foreground border-border border-t pt-2 text-xs">
                  Tip: {efficiencyScore.topOpportunity}
                </p>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground py-8 text-center">No data</p>
          )}
        </LoadingBoundary>
      </CardContent>
    </Card>
  );
});
