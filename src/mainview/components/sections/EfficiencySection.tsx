import type {
  DashboardData,
  DailyStat,
  SessionSummary,
} from "@shared/rpc-types";
import { useMemo } from "react";

// ─── Stable Empty Arrays (prevent useMemo dep changes on rerenders) ──────────
const EMPTY_DAILY_USAGE: DailyStat[] = [];
const EMPTY_SESSIONS: SessionSummary[] = [];
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";

import { Section } from "@/components/layout/Section";
import { ChartCard } from "@/components/shared/ChartCard";
import { ChartSkeletonGrid } from "@/components/shared/ChartSkeletonGrid";
import { EmptyChartState } from "@/components/shared/EmptyChartState";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { LoadingBoundary } from "@/components/shared/LoadingBoundary";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import type { ChartConfig } from "@/components/ui/chart";
import { ChartSkeletonGrid } from "@/components/shared/ChartSkeletonGrid";
import { formatDateTick, formatPercentAxisTick } from "@/lib/chart-formatters";
import {
  calculateDailyRate,
  formatRate,
  getDaysInRange,
  getVcsRateVariant,
} from "@/lib/metric-rates";
import { formatPercent } from "@/lib/utils";
import type { FilterOption } from "@/queries/dashboard";

interface EfficiencySectionProps {
  data: DashboardData | null;
  loading?: boolean;
  filter: FilterOption;
}

const cacheConfig = {
  cacheHitRate: {
    color: "var(--chart-2)",
    label: "Cache Hit Rate",
  },
} satisfies ChartConfig;

const sessionConfig = {
  count: {
    color: "var(--chart-1)",
    label: "Sessions",
  },
} satisfies ChartConfig;

export function EfficiencySection({
  data,
  loading,
  filter,
}: EfficiencySectionProps) {
  const dailyUsage = data?.dailyUsage ?? EMPTY_DAILY_USAGE;
  const sessions = data?.sessions ?? EMPTY_SESSIONS;

  // Memoize cache efficiency calculation (only recalculates when dailyUsage changes)
  const cacheEfficiencyData = useMemo(
    () =>
      dailyUsage.map((day) => {
        const totalInput =
          day.uncachedInput + day.cacheRead + day.cacheCreation;
        const hitRate = totalInput > 0 ? day.cacheRead / totalInput : 0;
        return {
          cacheHitRate: hitRate * 100,
          date: day.date,
        };
      }),
    [dailyUsage]
  );

  // Memoize session length distribution
  const sessionLengthBuckets = useMemo(
    () => getSessionLengthDistribution(sessions),
    [sessions]
  );

  // Memoize compaction stats - avoids 4 inline iterations on every render
  const compactionStats = useMemo(() => {
    const withCompactions = sessions.filter((s) => s.compactions > 0);
    return {
      avgQueriesBefore: calculateAvgQueriesBeforeCompaction(sessions),
      hasAny: withCompactions.length > 0,
      sessionsWithCompactions: withCompactions.length,
      totalCompactions: sessions.reduce((acc, s) => acc + s.compactions, 0),
    };
  }, [sessions]);

  // Efficiency metrics from efficiencyScore (distinct from cache hit rate)
  const toolSuccessRate = data?.efficiencyScore?.toolSuccess ?? null;
  const vcsActivityCount = data?.efficiencyScore?.vcsActivityCount ?? 0;
  const prsCreated = data?.efficiencyScore?.prsCreated ?? 0;
  const prEfficiency = data?.efficiencyScore?.prEfficiency;

  // VCS Activity rate calculation
  const days = getDaysInRange(filter, data?.totals?.dateRange);
  const vcsRate = calculateDailyRate(vcsActivityCount, days);

  return (
    <Section id="efficiency">
      <SectionHeader
        id="efficiency-header"
        title="Efficiency Analytics"
        subtitle="Cache performance and context optimization"
      />

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Cache Hit Rate"
          value={formatPercent(data?.totals?.cacheEfficiencyRatio ?? 0)}
          subtext="Tokens served from cache"
          loading={loading}
          variant={
            (data?.totals?.cacheEfficiencyRatio ?? 0) >= 0.5
              ? "success"
              : (data?.totals?.cacheEfficiencyRatio ?? 0) >= 0.25
                ? "warning"
                : "default"
          }
        />
        <StatCard
          label="Tool Success Rate"
          value={
            toolSuccessRate !== null ? `${Math.round(toolSuccessRate)}%` : "—"
          }
          subtext={
            toolSuccessRate !== null
              ? "Tools completing without errors"
              : "No tool calls yet"
          }
          loading={loading}
          variant={
            toolSuccessRate !== null
              ? toolSuccessRate >= 95
                ? "success"
                : toolSuccessRate >= 85
                  ? "warning"
                  : "default"
              : "default"
          }
        />
        <StatCard
          label="VCS Activity"
          value={`${formatRate(vcsRate)}/day`}
          subtext={`${vcsActivityCount} actions over ${days} day${days !== 1 ? "s" : ""}`}
          loading={loading}
          variant={getVcsRateVariant(vcsRate)}
          tooltip={
            <InfoTooltip
              title="What does this measure?"
              description="Commits, pushes, merges, and rebases across Git and JJ. Excludes read-only commands like status and log."
              scale={[
                { quality: "Low", range: "< 15/day" },
                { quality: "Moderate", range: "15-40/day" },
                { quality: "Active", range: "> 40/day" },
              ]}
            />
          }
        />
        <StatCard
          label="PR Efficiency"
          value={
            prEfficiency !== null && prEfficiency !== undefined
              ? `$${prEfficiency.toFixed(2)}/PR`
              : "—"
          }
          subtext={prsCreated > 0 ? `${prsCreated} PRs shipped` : "No PRs yet"}
          loading={loading}
          variant={
            prEfficiency !== null && prEfficiency !== undefined
              ? prEfficiency < 5
                ? "success"
                : prEfficiency < 15
                  ? "warning"
                  : "default"
              : "default"
          }
          tooltip={
            <InfoTooltip
              title="What does this measure?"
              description="Cost of sessions where PRs were created, divided by PR count. Sessions without PRs aren't included."
              scale={[
                { quality: "Excellent", range: "< $5/PR" },
                { quality: "Good", range: "$5-15/PR" },
                { quality: "Review workflow", range: "> $15/PR" },
              ]}
            />
          }
        />
      </div>

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cache Efficiency Over Time */}
        <ChartCard
          title="Cache Efficiency Curve"
          subtitle="Cache hit rate trend over time"
          loading={loading}
        >
          {cacheEfficiencyData.length > 0 ? (
            <ChartContainer config={cacheConfig} className="h-[250px] w-full">
              <AreaChart data={cacheEfficiencyData} accessibilityLayer>
                <defs>
                  <linearGradient
                    id="cacheGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--color-cacheHitRate)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--color-cacheHitRate)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={formatDateTick}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={formatPercentAxisTick}
                  domain={[0, 100]}
                />
                <ChartTooltip
                  cursor={{ strokeDasharray: "3 3" }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      formatter={(value) => `${(value as number).toFixed(1)}%`}
                    />
                  }
                />
                <Area
                  type="monotone"
                  dataKey="cacheHitRate"
                  stroke="var(--color-cacheHitRate)"
                  fill="url(#cacheGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>

        {/* Session Length Distribution */}
        <ChartCard
          title="Session Length Distribution"
          subtitle="Number of queries per session"
          loading={loading}
        >
          {sessionLengthBuckets.length > 0 ? (
            <ChartContainer config={sessionConfig} className="h-[250px] w-full">
              <BarChart data={sessionLengthBuckets} accessibilityLayer>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis tickLine={false} axisLine={false} />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.3 }}
                  animationDuration={150}
                  content={
                    <ChartTooltipContent
                      formatter={(value) => `${value} sessions`}
                    />
                  }
                />
                <Bar
                  dataKey="count"
                  fill="var(--color-count)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>
      </div>

      {/* Compaction Analysis */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Context Compaction Analysis</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <ChartSkeletonGrid columns={3} rows={1} />
          ) : (
            <div className="grid grid-cols-3 gap-6">
              <CompactionStat
                label="Sessions with Compactions"
                value={compactionStats.sessionsWithCompactions}
                total={sessions.length}
                description="Hit context limit"
              />
              <CompactionStat
                label="Total Compactions"
                value={compactionStats.totalCompactions}
                description="Context overflow events"
              />
              <CompactionStat
                label="Avg Queries Before Compaction"
                value={compactionStats.avgQueriesBefore}
                description="How long until limit"
              />
            </div>
          </LoadingBoundary>
          {!loading && compactionStats.hasAny && (
            <p className="text-muted-foreground border-border mt-4 border-t pt-4 text-xs">
              Tip: Sessions with compactions indicate the context window was
              exceeded. Consider breaking large tasks into smaller sessions.
            </p>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function CompactionStat({
  label,
  value,
  total,
  description,
}: {
  label: string;
  value: number;
  total?: number;
  description?: string;
}) {
  return (
    <div className="text-center">
      <p className="text-muted-foreground mb-1 text-sm">{label}</p>
      <p className="text-2xl font-semibold">
        {value}
        {total !== undefined && (
          <span className="text-muted-foreground text-sm font-normal">
            /{total}
          </span>
        )}
      </p>
      {description && (
        <p className="text-muted-foreground mt-1 text-xs">{description}</p>
      )}
    </div>
  );
}

// ─── Helper Functions ─────────────────────────────────────────────────────────

interface SessionForBuckets {
  queryCount: number;
  compactions: number;
}

function getSessionLengthDistribution(sessions: SessionForBuckets[]) {
  const buckets = [
    { count: 0, label: "1-5", max: 5, min: 1 },
    { count: 0, label: "6-10", max: 10, min: 6 },
    { count: 0, label: "11-20", max: 20, min: 11 },
    { count: 0, label: "21-50", max: 50, min: 21 },
    { count: 0, label: "50+", max: Infinity, min: 51 },
  ];

  sessions.forEach((session) => {
    const bucket = buckets.find(
      (b) => session.queryCount >= b.min && session.queryCount <= b.max
    );
    if (bucket) {
      bucket.count++;
    }
  });

  return buckets.filter((b) => b.count > 0);
}

function calculateAvgQueriesBeforeCompaction(
  sessions: SessionForBuckets[]
): number {
  const sessionsWithCompactions = sessions.filter((s) => s.compactions > 0);
  if (sessionsWithCompactions.length === 0) {
    return 0;
  }

  const totalQueries = sessionsWithCompactions.reduce(
    (acc, s) => acc + s.queryCount / (s.compactions + 1),
    0
  );
  return Math.round(totalQueries / sessionsWithCompactions.length);
}
