import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ChartCard } from "@/components/shared/ChartCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatPercent, cn } from "@/lib/utils";
import type { DashboardData } from "@shared/rpc-types";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

interface EfficiencySectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

const cacheConfig = {
  cacheHitRate: {
    label: "Cache Hit Rate",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

const sessionConfig = {
  count: {
    label: "Sessions",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export function EfficiencySection({ data, loading }: EfficiencySectionProps) {
  const dailyUsage = data?.dailyUsage ?? [];
  const sessions = data?.sessions ?? [];

  // Calculate cache hit rate per day
  const cacheEfficiencyData = dailyUsage.map((day) => {
    const totalInput = day.uncachedInput + day.cacheRead;
    const hitRate = totalInput > 0 ? day.cacheRead / totalInput : 0;
    return {
      date: day.date,
      cacheHitRate: hitRate * 100,
    };
  });

  // Session length distribution (queries per session)
  const sessionLengthBuckets = getSessionLengthDistribution(sessions);

  // Context utilization from totals
  const contextUtilization = data?.totals?.avgContextUtilization ?? 0;
  const contextEfficiency = data?.totals?.contextEfficiencyScore ?? 0;

  return (
    <Section id="efficiency">
      <SectionHeader
        id="efficiency-header"
        title="Efficiency Analytics"
        subtitle="Cache performance and context optimization"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard
          label="Cache Hit Rate"
          value={formatPercent(data?.totals?.cacheEfficiencyRatio ?? 0)}
          description="Tokens served from cache"
          loading={loading}
          variant={
            (data?.totals?.cacheEfficiencyRatio ?? 0) >= 0.5
              ? "success"
              : (data?.totals?.cacheEfficiencyRatio ?? 0) >= 0.25
                ? "warning"
                : "default"
          }
        />
        <MetricCard
          label="Context Utilization"
          value={formatPercent(contextUtilization)}
          description="Avg context window fill"
          loading={loading}
        />
        <MetricCard
          label="Context Efficiency"
          value={Math.round(contextEfficiency).toString()}
          description="Score out of 100"
          loading={loading}
          variant={contextEfficiency >= 70 ? "success" : contextEfficiency >= 40 ? "warning" : "default"}
        />
        <MetricCard
          label="Prompt Efficiency"
          value={formatPercent(data?.totals?.promptEfficiencyRatio ?? 0)}
          description="Output vs input ratio"
          loading={loading}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
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
                  <linearGradient id="cacheGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-cacheHitRate)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-cacheHitRate)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) => {
                    const date = new Date(value);
                    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value.toFixed(0)}%`}
                  domain={[0, 100]}
                />
                <ChartTooltip
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
                <YAxis
                  tickLine={false}
                  axisLine={false}
                />
                <ChartTooltip
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
            <div className="grid grid-cols-3 gap-4">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              <CompactionStat
                label="Sessions with Compactions"
                value={sessions.filter((s) => s.compactions > 0).length}
                total={sessions.length}
                description="Hit context limit"
              />
              <CompactionStat
                label="Total Compactions"
                value={sessions.reduce((acc, s) => acc + s.compactions, 0)}
                description="Context overflow events"
              />
              <CompactionStat
                label="Avg Queries Before Compaction"
                value={calculateAvgQueriesBeforeCompaction(sessions)}
                description="How long until limit"
              />
            </div>
          )}
          {!loading && sessions.filter((s) => s.compactions > 0).length > 0 && (
            <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
              Tip: Sessions with compactions indicate the context window was exceeded. Consider breaking large tasks into smaller sessions.
            </p>
          )}
        </CardContent>
      </Card>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string;
  description?: string;
  loading?: boolean;
  variant?: "default" | "success" | "warning";
}

function MetricCard({ label, value, description, loading, variant = "default" }: MetricCardProps) {
  if (loading) {
    return (
      <Card size="sm">
        <CardContent className="pt-4">
          <Skeleton className="h-4 w-20 mb-2" />
          <Skeleton className="h-6 w-16" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardContent className="pt-4">
        <p className="text-sm text-muted-foreground mb-1">{label}</p>
        <p
          className={cn(
            "text-xl font-semibold",
            variant === "success" && "text-success",
            variant === "warning" && "text-chart-4"
          )}
        >
          {value}
        </p>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  );
}

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
      <p className="text-sm text-muted-foreground mb-1">{label}</p>
      <p className="text-2xl font-semibold">
        {value}
        {total !== undefined && (
          <span className="text-sm text-muted-foreground font-normal">
            /{total}
          </span>
        )}
      </p>
      {description && (
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      )}
    </div>
  );
}

function EmptyChartState({ height = 200 }: { height?: number }) {
  return (
    <div
      className="flex items-center justify-center text-muted-foreground"
      style={{ height }}
    >
      No data available
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
    { label: "1-5", min: 1, max: 5, count: 0 },
    { label: "6-10", min: 6, max: 10, count: 0 },
    { label: "11-20", min: 11, max: 20, count: 0 },
    { label: "21-50", min: 21, max: 50, count: 0 },
    { label: "50+", min: 51, max: Infinity, count: 0 },
  ];

  sessions.forEach((session) => {
    const bucket = buckets.find(
      (b) => session.queryCount >= b.min && session.queryCount <= b.max
    );
    if (bucket) bucket.count++;
  });

  return buckets.filter((b) => b.count > 0);
}

function calculateAvgQueriesBeforeCompaction(sessions: SessionForBuckets[]): number {
  const sessionsWithCompactions = sessions.filter((s) => s.compactions > 0);
  if (sessionsWithCompactions.length === 0) return 0;

  const totalQueries = sessionsWithCompactions.reduce(
    (acc, s) => acc + s.queryCount / (s.compactions + 1),
    0
  );
  return Math.round(totalQueries / sessionsWithCompactions.length);
}
