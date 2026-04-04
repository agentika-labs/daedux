import type { DashboardData } from "@shared/rpc-types";
import React from "react";

import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { StatCard } from "@/components/shared/StatCard";
import {
  formatCurrency,
  formatTokens,
  formatNumber,
  formatPercent,
} from "@/lib/utils";

interface HeroStatsProps {
  totals: DashboardData["totals"] | undefined;
  efficiencyScore: DashboardData["efficiencyScore"] | undefined;
  weeklyComparison: DashboardData["weeklyComparison"] | undefined;
  loading?: boolean;
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

export const HeroStats = React.memo(function HeroStats({
  totals,
  efficiencyScore,
  weeklyComparison,
  loading,
}: HeroStatsProps) {
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
    <div className="border-border grid grid-cols-2 border-b md:grid-cols-3 lg:grid-cols-5">
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
        variant={(efficiencyScore?.prsCreated ?? 0) > 0 ? "success" : "default"}
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
  );
});
