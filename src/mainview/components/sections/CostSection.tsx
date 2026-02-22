import { Section } from "@/components/layout/Section";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { ChartCard } from "@/components/shared/ChartCard";
import { StatCard } from "@/components/shared/StatCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatCurrency, formatTokens } from "@/lib/utils";
import type { DashboardData, DailyStat } from "@shared/rpc-types";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, ComposedChart, Line, Cell } from "recharts";

interface CostSectionProps {
  data: DashboardData | null;
  loading?: boolean;
}

const dailyCostConfig = {
  cost: {
    label: "Cost",
    color: "hsl(var(--chart-1))",
  },
  cumulativeCost: {
    label: "Cumulative",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

const modelConfig = {
  cost: {
    label: "Cost",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

const tokenConfig = {
  uncachedInput: {
    label: "Uncached Input",
    color: "hsl(var(--chart-1))",
  },
  cacheRead: {
    label: "Cache Read",
    color: "hsl(var(--chart-2))",
  },
  cacheCreation: {
    label: "Cache Creation",
    color: "hsl(var(--chart-3))",
  },
  output: {
    label: "Output",
    color: "hsl(var(--chart-4))",
  },
} satisfies ChartConfig;

export function CostSection({ data, loading }: CostSectionProps) {
  const totals = data?.totals;
  const dailyUsage = data?.dailyUsage ?? [];
  const modelBreakdown = data?.modelBreakdown ?? [];

  // Calculate cumulative cost for the chart
  const dailyWithCumulative = dailyUsage.reduce<(DailyStat & { cumulativeCost: number })[]>(
    (acc, day) => {
      const lastItem = acc[acc.length - 1];
      const prev = lastItem?.cumulativeCost ?? 0;
      return [...acc, { ...day, cumulativeCost: prev + day.totalCost }];
    },
    []
  );

  // Token breakdown for stacked bar
  const tokenBreakdown = totals ? [
    {
      name: "Tokens",
      uncachedInput: totals.uncachedInput,
      cacheRead: totals.cacheRead,
      cacheCreation: totals.cacheCreation,
      output: totals.output,
    },
  ] : [];

  return (
    <Section id="cost">
      <SectionHeader
        id="cost-header"
        title="Cost Analytics"
        subtitle="Track spending patterns and identify optimization opportunities"
      />

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard
          label="Total Cost"
          value={formatCurrency(totals?.totalCost ?? 0)}
          loading={loading}
        />
        <StatCard
          label="Avg per Session"
          value={formatCurrency(totals?.avgCostPerSession ?? 0)}
          loading={loading}
        />
        <StatCard
          label="Avg per Query"
          value={formatCurrency(totals?.avgCostPerQuery ?? 0)}
          loading={loading}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Daily Cost Trend */}
        <ChartCard
          title="Daily Cost Trend"
          subtitle="Cost per day with cumulative line"
          loading={loading}
        >
          {dailyWithCumulative.length > 0 ? (
            <ChartContainer config={dailyCostConfig} className="h-[250px] w-full">
              <ComposedChart data={dailyWithCumulative} accessibilityLayer>
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
                  yAxisId="left"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value.toFixed(0)}`}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, name) => (
                        <span>{name === "cost" ? "Daily" : "Cumulative"}: {formatCurrency(value as number)}</span>
                      )}
                    />
                  }
                />
                <Bar
                  yAxisId="left"
                  dataKey="totalCost"
                  name="cost"
                  fill="var(--color-cost)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cumulativeCost"
                  name="cumulativeCost"
                  stroke="var(--color-cumulativeCost)"
                  strokeWidth={2}
                  dot={false}
                />
              </ComposedChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>

        {/* Model Breakdown */}
        <ChartCard
          title="Cost by Model"
          subtitle="Which models are costing the most"
          loading={loading}
        >
          {modelBreakdown.length > 0 ? (
            <ChartContainer config={modelConfig} className="h-[250px] w-full">
              <BarChart
                data={modelBreakdown.sort((a, b) => b.totalCost - a.totalCost).slice(0, 6)}
                layout="vertical"
                accessibilityLayer
              >
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${value.toFixed(2)}`}
                />
                <YAxis
                  type="category"
                  dataKey="modelShort"
                  tickLine={false}
                  axisLine={false}
                  width={100}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatCurrency(value as number)}
                    />
                  }
                />
                <Bar dataKey="totalCost" name="cost" radius={[0, 4, 4, 0]}>
                  {modelBreakdown.map((_, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={`hsl(var(--chart-${(index % 5) + 1}))`}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyChartState />
          )}
        </ChartCard>
      </div>

      {/* Token Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard
          title="Token Breakdown"
          subtitle="Distribution of token types"
          loading={loading}
        >
          {tokenBreakdown.length > 0 ? (
            <ChartContainer config={tokenConfig} className="h-[100px] w-full">
              <BarChart data={tokenBreakdown} layout="vertical" accessibilityLayer>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" hide />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => formatTokens(value as number)}
                    />
                  }
                />
                <Bar dataKey="uncachedInput" stackId="a" fill="var(--color-uncachedInput)" radius={[4, 0, 0, 4]} />
                <Bar dataKey="cacheRead" stackId="a" fill="var(--color-cacheRead)" />
                <Bar dataKey="cacheCreation" stackId="a" fill="var(--color-cacheCreation)" />
                <Bar dataKey="output" stackId="a" fill="var(--color-output)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ChartContainer>
          ) : (
            <EmptyChartState height={100} />
          )}
          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4 text-xs">
            <LegendItem color="var(--chart-1)" label="Uncached Input" value={formatTokens(totals?.uncachedInput ?? 0)} />
            <LegendItem color="var(--chart-2)" label="Cache Read" value={formatTokens(totals?.cacheRead ?? 0)} />
            <LegendItem color="var(--chart-3)" label="Cache Creation" value={formatTokens(totals?.cacheCreation ?? 0)} />
            <LegendItem color="var(--chart-4)" label="Output" value={formatTokens(totals?.output ?? 0)} />
          </div>
        </ChartCard>

        {/* Expensive Prompts */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle>Top Expensive Prompts</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : data?.topPrompts && data.topPrompts.length > 0 ? (
              <div className="space-y-2 max-h-[200px] overflow-y-auto">
                {data.topPrompts.slice(0, 5).map((prompt, i) => (
                  <div
                    key={i}
                    className="flex items-start justify-between gap-4 py-2 border-b border-border last:border-0"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate">{prompt.prompt.slice(0, 80)}...</p>
                      <p className="text-xs text-muted-foreground">
                        {prompt.model} · {prompt.date}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{formatCurrency(prompt.cost)}</p>
                      <p className="text-xs text-muted-foreground">{formatTokens(prompt.totalTokens)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">No prompts found</p>
            )}
          </CardContent>
        </Card>
      </div>
    </Section>
  );
}

// ─── Helper Components ────────────────────────────────────────────────────────

function LegendItem({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="h-3 w-3 rounded-sm"
        style={{ backgroundColor: `hsl(${color.replace("var(--", "").replace(")", "")})` }}
      />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium">{value}</span>
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
