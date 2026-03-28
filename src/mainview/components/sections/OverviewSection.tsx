import type { DashboardData } from "@shared/rpc-types";

import { Section } from "@/components/layout/Section";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { InsightsPanel } from "@/components/shared/InsightsPanel";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { ScoreBar } from "@/components/shared/ScoreBar";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

  // Build comparison subtexts when weekly data is available
  const costSubtext = weeklyComparison
    ? `vs ${formatCurrency(weeklyComparison.lastWeek.cost)} last week`
    : `${formatCurrency(totals?.avgCostPerSession ?? 0)} avg/session`;

  const sessionSubtext = weeklyComparison
    ? `vs ${formatNumber(weeklyComparison.lastWeek.sessions)} last week`
    : `${formatNumber(totals?.totalSubagents ?? 0)} subagents`;

  const cacheSubtext = weeklyComparison
    ? `vs ${formatPercent(weeklyComparison.lastWeek.cacheHitRate)} last week`
    : `${formatPercent(totals?.cacheEfficiencyRatio ?? 0)} hit rate`;

  return (
    <Section id="overview">
      {/* Hero Stats Row */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label="API Value"
          value={formatCurrency(totals?.totalCost ?? 0)}
          subtext={costSubtext}
          trend={costTrend}
          size="hero"
          loading={loading}
          tooltip={
            <InfoTooltip
              title="API Value"
              description="What this usage would cost at Anthropic's published API rates. Includes uncached input, cached reads (at 10% rate), cache writes (at 125% rate), and output tokens."
            />
          }
        />
        <StatCard
          label="Sessions"
          value={formatNumber(totals?.totalSessions ?? 0)}
          subtext={sessionSubtext}
          trend={sessionTrend}
          loading={loading}
        />
        <StatCard
          label="Total Tokens"
          value={formatTokens(totals?.totalTokens ?? 0)}
          subtext={`${formatTokens(totals?.totalInputTokens ?? 0)} input, ${formatTokens(totals?.totalOutputTokens ?? 0)} output`}
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
          subtext={cacheSubtext}
          variant="success"
          size="hero"
          loading={loading}
          tooltip={
            <InfoTooltip
              title="Cache Savings"
              description="Saved by paying $0.50/MTok for cached context instead of the full input price (e.g., $5/MTok for Opus). Without prompt caching, every turn would re-send full context at full price."
            />
          }
        />
      </div>

      {/* Efficiency Score + Insights Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
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
                <p className="text-muted-foreground py-8 text-center">
                  No data
                </p>
              )}
            </LoadingBoundary>
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
    </Section>
  );
}
