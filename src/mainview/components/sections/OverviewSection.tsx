import type { DashboardData } from "@shared/rpc-types";

import { Section } from "@/components/layout/Section";
import { ComparisonCard } from "@/components/shared/ComparisonCard";
import { InsightsPanel } from "@/components/shared/InsightsPanel";
import { ScoreBar } from "@/components/shared/ScoreBar";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCurrency,
  formatTokens,
  formatNumber,
  formatPercent,
  cn,
} from "@/lib/utils";

interface OverviewSectionProps {
  data: DashboardData | null;
  loading?: boolean;
  onNavigateToSection?: (section: string) => void;
}

// Hoisted pure function - avoids recreation on every render
const getTrendDirection = (change: number): "up" | "down" | "stable" => {
  if (change > 0) {
    return "up";
  }
  if (change < 0) {
    return "down";
  }
  return "stable";
};

export function OverviewSection({
  data,
  loading,
  onNavigateToSection,
}: OverviewSectionProps) {
  const totals = data?.totals;
  const efficiencyScore = data?.efficiencyScore;
  const weeklyComparison = data?.weeklyComparison;

  const costTrend = weeklyComparison?.changes?.cost
    ? {
        direction: getTrendDirection(weeklyComparison.changes.cost),
        value: Math.abs(weeklyComparison.changes.cost),
      }
    : undefined;

  const sessionTrend = weeklyComparison?.changes?.sessions
    ? {
        direction: getTrendDirection(weeklyComparison.changes.sessions),
        value: Math.abs(weeklyComparison.changes.sessions),
      }
    : undefined;

  return (
    <Section id="overview">
      <SectionHeader
        id="overview-header"
        title="Overview"
        subtitle="Your Claude Code usage at a glance"
      />

      {/* Hero Stats Row */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="Total Cost"
          value={formatCurrency(totals?.totalCost ?? 0)}
          subtext={`${formatCurrency(totals?.avgCostPerSession ?? 0)} avg/session`}
          trend={costTrend}
          loading={loading}
        />
        <StatCard
          label="Sessions"
          value={formatNumber(totals?.totalSessions ?? 0)}
          subtext={`${formatNumber(totals?.totalSubagents ?? 0)} subagents`}
          trend={sessionTrend}
          loading={loading}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(totals?.totalTokens ?? 0)}
          subtext={`${formatTokens(totals?.totalInputTokens ?? 0)} input`}
          loading={loading}
        />
        <StatCard
          label="PRs Created"
          value={formatNumber(efficiencyScore?.prsCreated ?? 0)}
          subtext={
            efficiencyScore?.prEfficiency !== null &&
            efficiencyScore?.prEfficiency !== undefined
              ? `$${efficiencyScore.prEfficiency.toFixed(2)}/PR`
              : "Track your shipped work"
          }
          loading={loading}
          variant={
            (efficiencyScore?.prsCreated ?? 0) > 0 ? "success" : "default"
          }
        />
        <StatCard
          label="Cache Savings"
          value={formatCurrency(totals?.savedByCaching ?? 0)}
          subtext={`${formatPercent(totals?.cacheEfficiencyRatio ?? 0)} hit rate`}
          variant="success"
          loading={loading}
        />
      </div>

      {/* Efficiency Score + Insights Row */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Efficiency Gauge */}
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
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="mx-auto h-24 w-24 rounded-full" />
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ) : efficiencyScore ? (
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
                          efficiencyScore.overall >= 75
                            ? "text-success"
                            : efficiencyScore.overall >= 50
                              ? "text-chart-4"
                              : "text-destructive"
                        )}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl font-bold">
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
          </CardContent>
        </Card>

        {/* Insights Panel */}
        <InsightsPanel
          insights={data?.insights ?? []}
          loading={loading}
          onNavigateToSection={onNavigateToSection}
          className="lg:col-span-2"
        />
      </div>

      {/* Weekly Comparison */}
      {weeklyComparison && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>This Week vs Last Week</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-3 gap-4">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-3 gap-4">
                  <ComparisonCard
                    label="Cost"
                    thisWeek={formatCurrency(weeklyComparison.thisWeek.cost)}
                    lastWeek={formatCurrency(weeklyComparison.lastWeek.cost)}
                    change={weeklyComparison.changes.cost}
                    isInverse
                  />
                  <ComparisonCard
                    label="Sessions"
                    thisWeek={weeklyComparison.thisWeek.sessions.toString()}
                    lastWeek={weeklyComparison.lastWeek.sessions.toString()}
                    change={weeklyComparison.changes.sessions}
                  />
                  <ComparisonCard
                    label="Cache Hit Rate"
                    thisWeek={formatPercent(
                      weeklyComparison.thisWeek.cacheHitRate
                    )}
                    lastWeek={formatPercent(
                      weeklyComparison.lastWeek.cacheHitRate
                    )}
                    change={weeklyComparison.changes.cacheHitRate * 100}
                  />
                </div>

                {(weeklyComparison.improvements.length > 0 ||
                  weeklyComparison.concerns.length > 0) && (
                  <div className="border-border flex gap-4 border-t pt-4">
                    {weeklyComparison.improvements.length > 0 && (
                      <div className="flex-1">
                        <p className="text-success mb-1 text-sm font-medium">
                          Improvements
                        </p>
                        <ul className="text-muted-foreground space-y-1 text-sm">
                          {weeklyComparison.improvements.map((item, i) => (
                            <li key={i}>+ {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {weeklyComparison.concerns.length > 0 && (
                      <div className="flex-1">
                        <p className="text-destructive mb-1 text-sm font-medium">
                          Concerns
                        </p>
                        <ul className="text-muted-foreground space-y-1 text-sm">
                          {weeklyComparison.concerns.map((item, i) => (
                            <li key={i}>- {item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </Section>
  );
}
